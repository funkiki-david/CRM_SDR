"""
AI API routes — Research reports, email drafting, and smart search
All AI features powered by a single Anthropic API key (Haiku 4.5).
"""

import json
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.deps import get_current_user, require_role
from app.core.config import (
    CLAUDE_MODEL,
    CLAUDE_MAX_TOKENS_RESEARCH,
    CLAUDE_MAX_TOKENS_EMAIL,
    AI_REPORT_CACHE_DAYS,
)
from app.models.user import User, UserRole
from app.models.contact import Contact
from app.models.activity import Activity
from app.models.ai_usage_log import AIUsageLog
from app.services.ai import (
    ai_service,
    SYSTEM_PROMPT_RESEARCH_PERSON,
    SYSTEM_PROMPT_RESEARCH_COMPANY,
    SYSTEM_PROMPT_DRAFT_EMAIL,
    SYSTEM_PROMPT_SUGGEST_TODOS,
    SYSTEM_PROMPT_SUGGEST_KEYWORDS,
)
from app.services.ai_budget import (
    call_ai_with_limit,
    get_user_spend_today,
    get_per_user_daily_limit,
    set_per_user_daily_limit,
)

# DISABLED: Using Claude direct search instead of pgvector embeddings
# from app.models.embedding import Embedding

router = APIRouter(prefix="/api/ai", tags=["AI"])


def _build_person_prompt(contact: Contact) -> str:
    """Dynamic portion only — static instructions live in SYSTEM_PROMPT_RESEARCH_PERSON (cached)"""
    return f"""Person to research:
- Name: {contact.first_name} {contact.last_name}
- Title: {contact.title or 'Unknown'}
- Company: {contact.company_name or 'Unknown'}
- Industry: {contact.industry or 'Unknown'}
- LinkedIn: {contact.linkedin_url or 'Not available'}"""


def _build_company_prompt(contact: Contact) -> str:
    """Dynamic portion only — static instructions live in SYSTEM_PROMPT_RESEARCH_COMPANY (cached)"""
    return f"""Company to research:
- Name: {contact.company_name or 'Unknown'}
- Website: {contact.company_domain or 'Unknown'}
- Industry: {contact.industry or 'Unknown'}
- Size: {contact.company_size or 'Unknown'} employees"""


# === Per-User Usage + Limits ===

def _budget_color(spent: float, limit: float) -> str:
    """$0-60%=green, 60-80%=yellow, 80-100%=red"""
    if limit <= 0:
        return "green"
    pct = spent / limit
    if pct < 0.6:
        return "green"
    if pct < 0.8:
        return "yellow"
    return "red"


@router.get("/usage")
async def get_my_ai_usage(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """当前用户今日 AI 花费 + 剩余额度"""
    spent = await get_user_spend_today(db, current_user.id)
    is_admin = current_user.role == UserRole.ADMIN
    limit = None if is_admin else await get_per_user_daily_limit(db)

    result = {
        "user_id": current_user.id,
        "role": current_user.role.value,
        "spent_today": round(spent, 4),
        "unlimited": is_admin,
    }
    if limit is not None:
        result["daily_limit"] = limit
        result["remaining"] = max(0, round(limit - spent, 4))
        result["percent"] = round((spent / limit) * 100, 1) if limit > 0 else 0
        result["color"] = _budget_color(spent, limit)
        result["at_limit"] = spent >= limit
    else:
        result["color"] = "green"
        result["at_limit"] = False
    return result


@router.get("/usage/all")
async def get_all_users_usage(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    """Admin: 所有用户今日用量 + 本月总计"""
    limit = await get_per_user_daily_limit(db)

    # 所有用户
    users_result = await db.execute(select(User).order_by(User.id))
    users = users_result.scalars().all()

    # 一次性算每个用户的今日花费
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    from sqlalchemy import func as _f
    agg = await db.execute(
        select(
            AIUsageLog.user_id,
            _f.coalesce(_f.sum(AIUsageLog.cost_usd), 0),
        )
        .where(AIUsageLog.created_at >= start)
        .where(AIUsageLog.status == "ok")
        .group_by(AIUsageLog.user_id)
    )
    spend_map = {row[0]: float(row[1]) for row in agg.all()}

    # 本月总计
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_agg = await db.execute(
        select(_f.coalesce(_f.sum(AIUsageLog.cost_usd), 0))
        .where(AIUsageLog.created_at >= month_start)
        .where(AIUsageLog.status == "ok")
    )
    month_total = float(month_agg.scalar() or 0)

    rows = []
    for u in users:
        spent = spend_map.get(u.id, 0.0)
        is_admin = u.role == UserRole.ADMIN
        row = {
            "user_id": u.id,
            "full_name": u.full_name,
            "email": u.email,
            "role": u.role.value,
            "spent_today": round(spent, 4),
            "unlimited": is_admin,
        }
        if is_admin:
            row["daily_limit"] = None
            row["percent"] = None
            row["color"] = "green"
        else:
            row["daily_limit"] = limit
            row["percent"] = round((spent / limit) * 100, 1) if limit > 0 else 0
            row["color"] = _budget_color(spent, limit)
        rows.append(row)

    return {
        "users": rows,
        "daily_limit_usd": limit,
        "month_total_usd": round(month_total, 4),
    }


class UpdateLimitRequest(BaseModel):
    daily_limit_usd: float


@router.patch("/limits")
async def update_ai_limit(
    data: UpdateLimitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    """Admin: 修改每用户每日上限（Admin 无上限，此设置不影响 Admin）"""
    new_limit = await set_per_user_daily_limit(db, data.daily_limit_usd)
    return {"daily_limit_usd": new_limit}


# === Status ===

@router.get("/status")
async def ai_status(current_user: User = Depends(get_current_user)):
    """Check AI service status — single provider (Anthropic)"""
    return {
        "ai_ready": ai_service.ai_ready,
        "model": CLAUDE_MODEL.replace("-20251001", ""),
        "features": {
            "research_reports": ai_service.ai_ready,
            "email_drafting": ai_service.ai_ready,
            "smart_search": ai_service.ai_ready,
        },
        "provider": "anthropic",
        "note": "All AI features powered by a single Anthropic API Key",
    }


# === Research Reports ===

class ReportRequest(BaseModel):
    contact_id: int
    force_refresh: bool = False  # True 时忽略缓存强制重新生成（Regenerate 按钮）


def _cache_is_fresh(generated_at: Optional[datetime]) -> bool:
    """Report is fresh if generated within AI_REPORT_CACHE_DAYS"""
    if generated_at is None:
        return False
    # Database returns aware datetime for TIMESTAMPTZ
    age = datetime.now(timezone.utc) - generated_at
    return age < timedelta(days=AI_REPORT_CACHE_DAYS)


def _report_meta(generated_at: Optional[datetime], model: Optional[str]) -> dict:
    """UI 元数据 — 生成时间 + 多少天前 + 是否过期"""
    if generated_at is None:
        return {"generated_at": None, "days_ago": None, "model": None, "stale": False}
    age = datetime.now(timezone.utc) - generated_at
    return {
        "generated_at": generated_at.isoformat(),
        "days_ago": age.days,
        "model": model,
        "stale": age.days >= AI_REPORT_CACHE_DAYS,
    }


@router.post("/report/person")
async def generate_person_report(
    data: ReportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate an AI research report about a person.
    Cache: 30 天内不重复调 API，除非 force_refresh=true。
    """
    contact = await db.get(Contact, data.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    # 先查缓存 Check cache first
    if (
        not data.force_refresh
        and contact.ai_person_report
        and _cache_is_fresh(contact.ai_person_generated_at)
    ):
        return {
            "report": contact.ai_person_report,
            "tags": contact.ai_tags,
            "cached": True,
            "meta": _report_meta(contact.ai_person_generated_at, contact.ai_report_model),
        }

    # 缓存不命中 → 调用 AI（走预算中间件）
    if not ai_service.ai_ready:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured. Add it in Settings.")

    prompt = _build_person_prompt(contact)
    report, _log = await call_ai_with_limit(
        db=db,
        user=current_user,
        feature="research_person",
        call_fn=lambda: ai_service._call_claude_raw(
            prompt, CLAUDE_MAX_TOKENS_RESEARCH, system=SYSTEM_PROMPT_RESEARCH_PERSON,
        ),
    )

    contact.ai_person_report = report
    contact.ai_person_generated_at = datetime.now(timezone.utc)
    contact.ai_report_model = CLAUDE_MODEL

    # Tag 生成是次要功能，失败不影响主流程
    try:
        tags = await ai_service.generate_tags(
            title=contact.title,
            company_name=contact.company_name,
            industry=contact.industry,
        )
        contact.ai_tags = json.dumps(tags)
    except Exception:
        pass

    await db.flush()
    return {
        "report": report,
        "tags": contact.ai_tags,
        "cached": False,
        "meta": _report_meta(contact.ai_person_generated_at, contact.ai_report_model),
    }


@router.post("/report/company")
async def generate_company_report(
    data: ReportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate an AI research report about a contact's company.
    Now grounded in real website content when available — homepage + about
    page text are scraped and injected into the prompt so Claude reports facts
    instead of guessing from the company name.
    """
    if not ai_service.ai_ready:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured. Add it in Settings.")

    contact = await db.get(Contact, data.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    # 先查缓存 Check cache first
    if (
        not data.force_refresh
        and contact.ai_company_report
        and _cache_is_fresh(contact.ai_company_generated_at)
    ):
        return {
            "report": contact.ai_company_report,
            "cached": True,
            "meta": _report_meta(contact.ai_company_generated_at, contact.ai_report_model),
            "data_source": _extract_data_source(contact.ai_company_report),
        }

    # Try to scrape the company website first
    from app.services.website_scraper import fetch_company_pages
    domain, homepage_text, about_text = await fetch_company_pages(
        contact.company_name or "",
        contact.website or contact.company_domain,
    )

    has_web_data = bool(homepage_text or about_text)
    if has_web_data:
        prompt = f"""Write a company research report based on the REAL website data below.
Only include facts directly supported by the content. If something isn't covered, write "Not found on website."
Do not invent products, customers, or numbers.

Company: {contact.company_name or 'Unknown'}
Website: https://{domain}
Contact at this company: {contact.first_name} {contact.last_name} ({contact.title or 'role unknown'})

--- Homepage content ---
{homepage_text or '(homepage not reachable)'}

--- About page content ---
{about_text or '(about page not found)'}

Report sections:
1. Company Overview — 2-3 sentences on what they do
2. Products / Services
3. Company Size & Location (only if mentioned)
4. Recent News or Updates (only if mentioned)
5. Talking Points for SDR outreach

Begin with this exact line so the UI can show a source badge:
DATA_SOURCE: website ({domain})

Then output the 5 sections in order, no preamble."""
    else:
        prompt = _build_company_prompt(contact) + (
            "\n\nNo website content available — base the report only on the company name and any "
            "common knowledge. Begin with this exact line so the UI can show a warning:\n"
            "DATA_SOURCE: ai_only"
        )

    report, _log = await call_ai_with_limit(
        db=db,
        user=current_user,
        feature="research_company",
        call_fn=lambda: ai_service._call_claude_raw(
            prompt, CLAUDE_MAX_TOKENS_RESEARCH, system=SYSTEM_PROMPT_RESEARCH_COMPANY,
        ),
    )

    contact.ai_company_report = report
    contact.ai_company_generated_at = datetime.now(timezone.utc)
    contact.ai_report_model = CLAUDE_MODEL
    await db.flush()
    return {
        "report": report,
        "cached": False,
        "meta": _report_meta(contact.ai_company_generated_at, contact.ai_report_model),
        "data_source": _extract_data_source(report),
    }


def _extract_data_source(report: Optional[str]) -> dict:
    """Parse the 'DATA_SOURCE: ...' header line we asked Claude to emit."""
    if not report:
        return {"kind": "unknown"}
    first_line = report.split("\n", 1)[0].strip()
    if first_line.startswith("DATA_SOURCE: website"):
        m = re.search(r"\(([^)]+)\)", first_line)
        return {"kind": "website", "domain": m.group(1) if m else None}
    if first_line.startswith("DATA_SOURCE: ai_only"):
        return {"kind": "ai_only"}
    return {"kind": "unknown"}


# === Delete reports ===

@router.delete("/report/{contact_id}/person", status_code=204)
async def delete_person_report(
    contact_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    contact = await db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    contact.ai_person_report = None
    contact.ai_person_generated_at = None
    contact.ai_tags = None
    await db.flush()


@router.delete("/report/{contact_id}/company", status_code=204)
async def delete_company_report(
    contact_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    contact = await db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    contact.ai_company_report = None
    contact.ai_company_generated_at = None
    await db.flush()


# === AI Email Drafting ===

class DraftRequest(BaseModel):
    contact_id: int
    # 可选：指定从哪个邮箱账号发，影响 AI 签名落款
    # Optional: selected From-account id — shapes AI signature
    email_account_id: Optional[int] = None


def _infer_company_from_domain(email: str) -> str:
    """
    info@amazonsolutions.us → Amazon Solutions
    marketing@graphictac.biz → Graphictac
    john@acme-corp.com → Acme Corp
    """
    if "@" not in email:
        return ""
    domain = email.split("@", 1)[1].split(".")[0]
    # camel/kebab → space-separated Title Case
    parts = domain.replace("-", " ").replace("_", " ").split()
    if not parts:
        return ""
    return " ".join(p.capitalize() for p in parts)


@router.post("/draft-email")
async def draft_email(
    data: DraftRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate a personalized email draft — TEMPORARILY FROZEN.
    Body logic kept intact below; unfreeze by removing the 501 return.
    """
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=501,
        content={"error": "Email module is temporarily frozen", "code": "EMAIL_FROZEN"},
    )
    # --- frozen: original logic retained for restoration ---
    if not ai_service.ai_ready:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured. Add it in Settings.")

    contact = await db.get(Contact, data.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    # 解析落款 —— 若指定了 email_account_id，用账号的 display_name + 域名推断的公司
    # Resolve sender signature — if email_account selected, use account's display_name + company
    sender_name = current_user.full_name
    sender_company = ""
    sender_email = ""
    if data.email_account_id:
        from app.models.email_account import EmailAccount
        account = await db.get(EmailAccount, data.email_account_id)
        if account and account.user_id == current_user.id:
            sender_name = account.display_name or current_user.full_name
            sender_email = account.email_address
            sender_company = _infer_company_from_domain(account.email_address)

    result = await db.execute(
        select(Activity)
        .where(Activity.contact_id == contact.id)
        .order_by(Activity.created_at.desc())
        .limit(10)
    )
    activities = result.scalars().all()

    history_lines = []
    for act in activities:
        history_lines.append(
            f"- [{act.activity_type.value.upper()}] {act.subject or ''}: {act.content or ''}"
        )
    activity_history = "\n".join(history_lines) if history_lines else ""

    # Dynamic context only — static SDR persona lives in SYSTEM_PROMPT_DRAFT_EMAIL (cached)
    person_block = f"PERSON RESEARCH:\n{contact.ai_person_report}" if contact.ai_person_report else ""
    company_block = f"COMPANY RESEARCH:\n{contact.ai_company_report}" if contact.ai_company_report else ""
    history_block = f"INTERACTION HISTORY:\n{activity_history}" if activity_history else "No prior interactions."

    # 签名格式：Name, Company（若有 company）
    signature_line = f"{sender_name}, {sender_company}" if sender_company else sender_name

    prompt = f"""CONTACT:
- Name: {contact.first_name} {contact.last_name}
- Title: {contact.title or 'Unknown'}
- Company: {contact.company_name or 'Unknown'}

{person_block}

{company_block}

{history_block}

Sender name: {sender_name}
Sender company: {sender_company or 'Unknown'}
Sender email: {sender_email or 'Unknown'}
Sign-off line: {signature_line}"""

    result, _log = await call_ai_with_limit(
        db=db,
        user=current_user,
        feature="draft_email",
        call_fn=lambda: ai_service._call_claude_raw(
            prompt, CLAUDE_MAX_TOKENS_EMAIL, system=SYSTEM_PROMPT_DRAFT_EMAIL,
        ),
    )

    subject = ""
    body = result
    if "SUBJECT:" in result and "BODY:" in result:
        parts = result.split("BODY:", 1)
        subject_part = parts[0].replace("SUBJECT:", "").strip()
        subject = subject_part.split("\n")[0].strip()
        body = parts[1].strip()

    return {"subject": subject, "body": body}


# === AI Suggested To-Do ===

# In-memory per-user cache — 2h TTL
# suggestions_cache[user_id] = {"data": {...}, "generated_at": datetime}
_SUGGEST_CACHE: dict[int, dict] = {}
_SUGGEST_CACHE_TTL = timedelta(hours=2)


@router.get("/suggest-todos")
async def suggest_todos(
    force: bool = Query(False, description="Bypass cache and regenerate"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Team-wide AI to-do suggestions, now driven by the rule engine
    (backend/app/services/ai_todo_engine.py).

    Behaviour change vs. CP2 / earlier Claude impl:
      * Pure rule output — no Claude call, no token spend
      * Cap = 7 per user per call (engine-enforced)
      * Snoozes filtered inside the engine
      * Sort: urgency high < medium < low, tiebreak contact_id

    The `force` query param is accepted for backward compat but no longer
    has effect — rules are deterministic, not cached.
    """
    _ = force  # kept for API compat with old frontend
    from app.services.ai_todo_engine import generate_todos_for_user

    suggestions = await generate_todos_for_user(db, current_user, max_count=7)
    return {
        "suggestions": [s.model_dump() for s in suggestions],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
    }


# Legacy Claude-driven path retained below for reference / quick rollback.
# Will be removed in CP4 once the rule engine is proven in real use.
async def _legacy_suggest_todos_claude(
    force: bool, db: AsyncSession, current_user: User
):  # pragma: no cover — not called any more
    if not force:
        cached = _SUGGEST_CACHE.get(current_user.id)
        if cached:
            age = datetime.now(timezone.utc) - cached["generated_at"]
            if age < _SUGGEST_CACHE_TTL:
                resp = dict(cached["data"])
                resp["generated_at"] = cached["generated_at"].isoformat()
                resp["cached"] = True
                return resp
    if not ai_service.ai_ready:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured.")

    # 收集最近 30 天活动 — SDR 只看自己的
    since = datetime.now(timezone.utc) - timedelta(days=30)
    q = (
        select(Activity)
        .options(joinedload(Activity.contact), joinedload(Activity.user))
        .where(Activity.created_at >= since)
    )
    # Team-shared: AI suggestions use all team members' activity.
    q = q.order_by(Activity.created_at.desc()).limit(200)

    result = await db.execute(q)
    activities = result.unique().scalars().all()

    # 空活动：不调 AI，直接返回空建议 + 用户友好的 message
    # Empty DB (fresh deploy): skip AI, return empty + actionable message
    if not activities:
        return {
            "suggestions": [],
            "message": "No activity data yet. Start logging activities to get AI suggestions.",
        }

    # 汇总活动，附带 contact_id=N 让 AI 能引用
    # Compact activity log — include contact_id=N so the model can cite it
    lines = []
    for a in activities:
        c_name = f"{a.contact.first_name} {a.contact.last_name}" if a.contact else "Unknown"
        company = a.contact.company_name if a.contact and a.contact.company_name else ""
        cid = a.contact_id if a.contact_id else "null"
        subj = (a.subject or "").strip()[:80]
        content_snip = (a.content or "").strip()[:100].replace("\n", " ")
        days_ago = (datetime.now(timezone.utc) - a.created_at).days
        lines.append(
            f"- [{a.activity_type.value}] {days_ago}d ago: contact_id={cid} {c_name}"
            + (f" @ {company}" if company else "")
            + (f" | {subj}" if subj else "")
            + (f" — {content_snip}" if content_snip else "")
        )
    activity_text = "\n".join(lines)

    prompt = f"""Below are the last 30 days of SDR activity (most recent first). Analyze this data and output exactly 3 to-do suggestions per the schema.

ACTIVITY LOG ({len(activities)} entries):
{activity_text}

Remember: respond ONLY with valid JSON. No markdown. No backticks. No preamble."""

    try:
        raw, _log = await call_ai_with_limit(
            db=db,
            user=current_user,
            feature="suggest_todos",
            call_fn=lambda: ai_service._call_claude_raw(
                prompt, 1500, system=SYSTEM_PROMPT_SUGGEST_TODOS,
            ),
        )
    except HTTPException:
        raise
    except Exception as e:
        # AI 调用失败（网络 / 熔断 / 上游 500）→ 返回空建议，不抛 500 给前端
        return {
            "suggestions": [],
            "message": f"AI temporarily unavailable: {str(e)[:120]}. Please try again later.",
        }

    parsed = _parse_suggestions_json(raw)
    if parsed is None:
        # 再兜底一层 —— AI 输出不是合法 JSON，降级为空建议
        return {
            "suggestions": [],
            "message": "AI returned unexpected format. Please refresh to try again.",
        }

    now = datetime.now(timezone.utc)
    # Filter out snoozed suggestions for this user (Problem 5)
    from app.models.task import AISuggestionSnooze
    from app.api.routes.tasks import hash_suggestion as _hash
    snz_q = await db.execute(
        select(AISuggestionSnooze.suggestion_hash).where(
            AISuggestionSnooze.user_id == current_user.id,
            AISuggestionSnooze.snooze_until > now,
        )
    )
    snoozed = {row[0] for row in snz_q.all()}
    if snoozed and isinstance(parsed, list):
        parsed = [
            s for s in parsed
            if isinstance(s, dict)
            and _hash(s.get("title", ""), s.get("action", "")) not in snoozed
        ]
    data = {"suggestions": parsed}
    # Cache successful generation
    _SUGGEST_CACHE[current_user.id] = {"data": data, "generated_at": now}
    return {**data, "generated_at": now.isoformat(), "cached": False}


def _parse_suggestions_json(raw: str):
    """
    鲁棒 JSON 解析：
    1. strip markdown code fence (``` / ```json)
    2. 提取第一个 {...} 对象块
    3. json.loads
    4. 检查 suggestions 字段 —— 对象无 suggestions 时兜底到数组包装

    成功返回 suggestions 数组；失败返回 None。
    """
    if not raw:
        return None
    s = raw.strip()

    # Strip markdown code fence variants
    # ```json ... ``` or ``` ... ```
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s[3:]
        if s.endswith("```"):
            s = s[:-3]
        s = s.strip()
        # 若首行是 "json" 裸字符（Claude 偶尔这么做）
        if s.startswith("json\n") or s.startswith("json\r"):
            s = s.split("\n", 1)[1]

    # 抓第一个 {...}（如果有 preamble 文字），退化到整个 s
    # Find outermost {...} block if there's any preamble/commentary
    first = s.find("{")
    last = s.rfind("}")
    if first != -1 and last > first:
        s = s[first:last + 1]
    else:
        # 也可能是 bare array
        first_a = s.find("[")
        last_a = s.rfind("]")
        if first_a != -1 and last_a > first_a:
            s = s[first_a:last_a + 1]
        else:
            return None

    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        return None

    # 支持 3 种返回形态：{"suggestions": [...]} / [...] / {单个建议}
    if isinstance(data, dict) and "suggestions" in data and isinstance(data["suggestions"], list):
        return data["suggestions"]
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "priority" in data:
        # 单个建议对象，包装成数组
        return [data]
    return None


class SuggestKeywordsBody(BaseModel):
    input: str


@router.post("/suggest-keywords")
async def suggest_keywords(
    body: SuggestKeywordsBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    AI Keyword Finder — Claude Haiku generates industries + keywords from a
    free-text description for use as Apollo search filters.
    Returns {"industries": [...], "keywords": [...]} — both empty on failure.
    """
    text = (body.input or "").strip()
    if not text:
        return {"industries": [], "keywords": []}
    if len(text) > 300:
        text = text[:300]

    if not ai_service.claude_ready:
        raise HTTPException(
            status_code=503,
            detail="AI keyword suggestion is unavailable. Please try again.",
        )

    prompt = f"""User input: {text}

Generate the industries and keywords arrays per the schema. Respond with JSON only."""

    try:
        raw, _log = await call_ai_with_limit(
            db=db,
            user=current_user,
            feature="suggest_keywords",
            call_fn=lambda: ai_service._call_claude_raw(
                prompt, 800, system=SYSTEM_PROMPT_SUGGEST_KEYWORDS,
            ),
        )
    except HTTPException:
        raise
    except Exception:
        return {
            "industries": [],
            "keywords": [],
            "message": "AI keyword suggestion is unavailable. Please try again.",
        }

    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s[3:]
        if s.endswith("```"):
            s = s[:-3]
        s = s.strip()
        if s.startswith("json\n") or s.startswith("json\r"):
            s = s.split("\n", 1)[1]
    first, last = s.find("{"), s.rfind("}")
    if first != -1 and last > first:
        s = s[first:last + 1]

    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        return {
            "industries": [],
            "keywords": [],
            "message": "AI returned unexpected format. Please try again.",
        }

    industries = data.get("industries") or []
    keywords = data.get("keywords") or []
    if not isinstance(industries, list):
        industries = []
    if not isinstance(keywords, list):
        keywords = []

    def _clean(items):
        seen = set()
        out = []
        for it in items:
            if not isinstance(it, str):
                continue
            v = it.strip()
            if not v or v.lower() in seen:
                continue
            seen.add(v.lower())
            out.append(v)
        return out[:40]

    return {
        "industries": _clean(industries),
        "keywords": _clean(keywords),
    }
