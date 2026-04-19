"""
AI Budget Service — 两层成本保护中间件

Layer 1: 全局（系统总） — 每日 AI_DAILY_BUDGET_USD · 每月 AI_MONTHLY_BUDGET_USD
Layer 2: 每用户（每日） — 可配置，默认 PER_USER_DAILY_LIMIT_USD；Admin 无上限

任一 layer 触发都会抛 HTTPException(402/403)。

用法 Usage:
    from app.services.ai_budget import call_ai_with_limit

    text, log = await call_ai_with_limit(
        db=db,
        user=current_user,  # 改成传 User 对象以获取 role
        feature="research_person",
        call_fn=lambda: ai_service._call_claude_raw(prompt, max_tokens),
    )
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Awaitable, Callable, Optional

from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import (
    CLAUDE_MODEL,
    AI_PRICE_INPUT_PER_M,
    AI_PRICE_OUTPUT_PER_M,
    AI_PRICE_CACHE_READ_PER_M,
    AI_PRICE_CACHE_WRITE_PER_M,
    AI_DAILY_BUDGET_USD,
    AI_MONTHLY_BUDGET_USD,
)
from app.models.ai_usage_log import AIUsageLog
from app.models.app_setting import AppSetting
from app.models.user import User, UserRole

# 每用户每日默认上限（Admin 可调整）
# Default per-user daily limit (Admin can override via PATCH /api/ai/limits)
DEFAULT_PER_USER_DAILY_LIMIT_USD = 3.0
APP_SETTING_KEY_USER_LIMIT = "ai_per_user_daily_limit_usd"


class ClaudeUsage:
    """Minimal container for token counts returned from Anthropic SDK"""
    def __init__(
        self,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
    ):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.cache_read_tokens = cache_read_tokens
        self.cache_write_tokens = cache_write_tokens


def compute_cost(usage: ClaudeUsage) -> float:
    """按 Haiku 4.5 价格计算花费 USD"""
    cost = (
        (usage.input_tokens / 1_000_000) * AI_PRICE_INPUT_PER_M
        + (usage.output_tokens / 1_000_000) * AI_PRICE_OUTPUT_PER_M
        + (usage.cache_read_tokens / 1_000_000) * AI_PRICE_CACHE_READ_PER_M
        + (usage.cache_write_tokens / 1_000_000) * AI_PRICE_CACHE_WRITE_PER_M
    )
    return round(cost, 6)


async def get_spend_today(db: AsyncSession) -> float:
    """今日累计花费 USD"""
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(func.coalesce(func.sum(AIUsageLog.cost_usd), 0))
        .where(AIUsageLog.created_at >= start)
        .where(AIUsageLog.status == "ok")
    )
    return float(result.scalar() or 0)


async def get_spend_month(db: AsyncSession) -> float:
    """本月累计花费 USD"""
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(func.coalesce(func.sum(AIUsageLog.cost_usd), 0))
        .where(AIUsageLog.created_at >= start)
        .where(AIUsageLog.status == "ok")
    )
    return float(result.scalar() or 0)


async def get_user_spend_today(db: AsyncSession, user_id: int) -> float:
    """Single user's today spend"""
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(func.coalesce(func.sum(AIUsageLog.cost_usd), 0))
        .where(AIUsageLog.created_at >= start)
        .where(AIUsageLog.user_id == user_id)
        .where(AIUsageLog.status == "ok")
    )
    return float(result.scalar() or 0)


async def get_per_user_daily_limit(db: AsyncSession) -> float:
    """读取 Admin 配置的每用户每日上限（默认 $3）"""
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == APP_SETTING_KEY_USER_LIMIT)
    )
    row = result.scalar_one_or_none()
    if row is None:
        return DEFAULT_PER_USER_DAILY_LIMIT_USD
    try:
        return float(row.value)
    except (ValueError, TypeError):
        return DEFAULT_PER_USER_DAILY_LIMIT_USD


async def set_per_user_daily_limit(db: AsyncSession, limit_usd: float) -> float:
    """Admin 更新每用户每日上限，写入 app_settings 表"""
    if limit_usd < 0 or limit_usd > 1000:
        raise HTTPException(status_code=400, detail="Limit must be between 0 and 1000 USD")

    result = await db.execute(
        select(AppSetting).where(AppSetting.key == APP_SETTING_KEY_USER_LIMIT)
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = AppSetting(key=APP_SETTING_KEY_USER_LIMIT, value=str(limit_usd))
        db.add(row)
    else:
        row.value = str(limit_usd)
    await db.flush()
    return limit_usd


async def check_budget(db: AsyncSession, user: Optional[User] = None) -> None:
    """
    双层预算检查。Admin 跳过 per-user 检查，但仍受全局约束。

    顺序：先 per-user（更严格），再全局。
    任一层超出即抛异常。
    """
    # === Layer 1: per-user daily limit (non-Admin only) ===
    if user is not None and user.role != UserRole.ADMIN:
        user_today = await get_user_spend_today(db, user.id)
        user_limit = await get_per_user_daily_limit(db)
        if user_today >= user_limit:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "reason": "user_daily_limit_exceeded",
                    "message": f"You've used ${user_today:.2f} / ${user_limit:.2f} of your daily AI budget. Resets tomorrow at 12:00 AM. Contact Admin to upgrade.",
                    "spent_today": user_today,
                    "daily_limit": user_limit,
                },
            )

    # === Layer 2: global daily + monthly ===
    today = await get_spend_today(db)
    if today >= AI_DAILY_BUDGET_USD:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "reason": "global_daily_budget_exceeded",
                "message": f"Global AI budget reached (${today:.2f} / ${AI_DAILY_BUDGET_USD:.2f}). Resets at midnight UTC.",
                "spent_today": today,
                "daily_limit": AI_DAILY_BUDGET_USD,
            },
        )

    month = await get_spend_month(db)
    if month >= AI_MONTHLY_BUDGET_USD:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "reason": "global_monthly_budget_exceeded",
                "message": f"Global monthly AI budget reached (${month:.2f} / ${AI_MONTHLY_BUDGET_USD:.2f}). Resets on the 1st.",
                "spent_month": month,
                "monthly_limit": AI_MONTHLY_BUDGET_USD,
            },
        )


async def log_usage(
    db: AsyncSession,
    *,
    user_id: Optional[int],
    feature: str,
    model: str,
    usage: ClaudeUsage,
    status_value: str = "ok",
) -> AIUsageLog:
    """Write one AIUsageLog row"""
    cost = compute_cost(usage)
    row = AIUsageLog(
        user_id=user_id,
        model=model,
        feature=feature,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cache_read_tokens=usage.cache_read_tokens,
        cache_write_tokens=usage.cache_write_tokens,
        cost_usd=cost,
        status=status_value,
    )
    db.add(row)
    await db.flush()
    return row


async def call_ai_with_limit(
    db: AsyncSession,
    *,
    user: User,
    feature: str,
    call_fn: Callable[[], Awaitable[tuple[str, ClaudeUsage]]],
    model: str = CLAUDE_MODEL,
) -> tuple[str, AIUsageLog]:
    """
    Budget-aware Claude call wrapper.
    1. 检查用户+全局预算（超 → 抛 402/403）
    2. 调 Claude API
    3. 记录实际 token 消耗 + 花费到 ai_usage_log（带 user_id）
    返回 (text, log_row)
    """
    await check_budget(db, user=user)

    text, usage = await call_fn()
    log_row = await log_usage(
        db, user_id=user.id, feature=feature, model=model, usage=usage
    )
    return text, log_row


def budget_status_color(spent_today: float) -> str:
    """Dashboard 颜色指示 — green / yellow / red"""
    ratio = spent_today / AI_DAILY_BUDGET_USD if AI_DAILY_BUDGET_USD > 0 else 0
    if ratio < 0.5:
        return "green"
    if ratio < 0.8:
        return "yellow"
    return "red"


async def get_cache_stats_month(db: AsyncSession) -> dict:
    """
    本月 Prompt Cache 命中统计 — 用于 Admin 面板
    Returns: {cache_read_tokens, cache_write_tokens, input_tokens,
              hit_rate, estimated_savings_usd}
    """
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(
            func.coalesce(func.sum(AIUsageLog.cache_read_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.cache_write_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.input_tokens), 0),
        )
        .where(AIUsageLog.created_at >= start)
        .where(AIUsageLog.status == "ok")
    )
    cache_read, cache_write, raw_input = result.one()
    total_input_equiv = raw_input + cache_read + cache_write

    # 命中率：缓存读占"本该是输入"的比例
    hit_rate = (
        (cache_read / total_input_equiv * 100) if total_input_equiv > 0 else 0
    )

    # 节省估算：如果这些 cache_read 原价付费会多花多少
    # Savings = cache_read_tokens * (input_price - cache_read_price) / 1M
    savings = (cache_read / 1_000_000) * (
        AI_PRICE_INPUT_PER_M - AI_PRICE_CACHE_READ_PER_M
    )

    return {
        "cache_read_tokens": int(cache_read),
        "cache_write_tokens": int(cache_write),
        "input_tokens": int(raw_input),
        "hit_rate_percent": round(hit_rate, 2),
        "estimated_savings_usd": round(savings, 4),
    }
