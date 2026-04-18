"""
AI 使用日志 — 记录每一次 Claude API 调用的 token 消耗和成本
AI Usage Log — tracks every Claude API call for cost guardrails

用途 Purpose:
  - 每日/月度预算熔断
  - 缓存命中率统计
  - 按功能/用户审计 AI 花费
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Integer, Numeric, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AIUsageLog(Base):
    __tablename__ = "ai_usage_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # 谁用的 / 什么模型 / 什么功能
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), index=True, nullable=True
    )
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    feature: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # feature 取值 values: research_person | research_company | draft_email | smart_search | tags | validate_key

    # Token 统计 Token accounting
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Prompt caching（任务 6 会用到）
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # 成本 USD，保留 6 位小数（精确到 $0.000001）
    cost_usd: Mapped[float] = mapped_column(Numeric(10, 6), nullable=False, default=0)

    # 结果状态：ok | blocked_budget | error
    status: Mapped[str] = mapped_column(String(20), default="ok", nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    __table_args__ = (
        Index("ix_ai_usage_day", "created_at"),
    )
