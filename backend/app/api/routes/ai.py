"""
AI API routes — Research reports, email drafting, and smart search
All AI features powered by a single Anthropic API key (Haiku 4.5).
"""

import json
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.config import (
    CLAUDE_MODEL,
    AI_SEARCH_ACTIVITY_LIMIT,
    CLAUDE_MAX_TOKENS_RESEARCH,
    CLAUDE_MAX_TOKENS_EMAIL,
    AI_REPORT_CACHE_DAYS,
)
from app.models.user import User, UserRole
from app.models.contact import Contact
from app.models.activity import Activity
from app.services.ai import (
    ai_service,
    SYSTEM_PROMPT_RESEARCH_PERSON,
    SYSTEM_PROMPT_RESEARCH_COMPANY,
    SYSTEM_PROMPT_DRAFT_EMAIL,
    SYSTEM_PROMPT_SUGGEST_TODOS,
)
from app.services.ai_budget import call_ai_with_limit

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
        user_id=current_user.id,
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
    """Generate an AI research report about a contact's company"""
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
        }

    if not ai_service.ai_ready:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured. Add it in Settings.")

    prompt = _build_company_prompt(contact)
    report, _log = await call_ai_with_limit(
        db=db,
        user_id=current_user.id,
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
    }


# === AI Email Drafting ===

class DraftRequest(BaseModel):
    contact_id: int


@router.post("/draft-email")
async def draft_email(
    data: DraftRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a personalized email draft using all available context"""
    if not ai_service.ai_ready:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured. Add it in Settings.")

    contact = await db.get(Contact, data.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

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
    prompt = f"""CONTACT:
- Name: {contact.first_name} {contact.last_name}
- Title: {contact.title or 'Unknown'}
- Company: {contact.company_name or 'Unknown'}

{person_block}

{company_block}

{history_block}

Sender name: {current_user.full_name}"""

    result, _log = await call_ai_with_limit(
        db=db,
        user_id=current_user.id,
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

@router.get("/suggest-todos")
async def suggest_todos(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    基于用户最近 30 天的活动，让 Claude 生成 3 条具体可执行的待办建议。
    返回格式: [{category, title, reason, action}, ...]
      - HIGH: 高优先级再联系
      - OPPORTUNITY: 批量操作机会
      - INSIGHT: 行为观察 / coaching
    """
    if not ai_service.ai_ready:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured.")

    # 收集最近 30 天活动 — SDR 只看自己的
    since = datetime.now(timezone.utc) - timedelta(days=30)
    q = (
        select(Activity)
        .options(joinedload(Activity.contact), joinedload(Activity.user))
        .where(Activity.created_at >= since)
    )
    if current_user.role == UserRole.SDR:
        q = q.where(Activity.user_id == current_user.id)
    q = q.order_by(Activity.created_at.desc()).limit(200)

    result = await db.execute(q)
    activities = result.unique().scalars().all()

    if not activities:
        return {"suggestions": [], "reason": "Not enough activity yet — log some calls/emails first."}

    # 汇总成紧凑文本喂给 Claude
    lines = []
    for a in activities:
        c_name = f"{a.contact.first_name} {a.contact.last_name}" if a.contact else "Unknown"
        company = a.contact.company_name if a.contact and a.contact.company_name else ""
        subj = (a.subject or "").strip()[:80]
        content_snip = (a.content or "").strip()[:100].replace("\n", " ")
        days_ago = (datetime.now(timezone.utc) - a.created_at).days
        lines.append(
            f"- [{a.activity_type.value}] {days_ago}d ago: {c_name}"
            + (f" @ {company}" if company else "")
            + (f" | {subj}" if subj else "")
            + (f" — {content_snip}" if content_snip else "")
        )
    activity_text = "\n".join(lines)

    prompt = f"""Below are the last 30 days of SDR activity (most recent first). Analyze this data and output exactly 3 to-do suggestions per the schema.

ACTIVITY LOG ({len(activities)} entries):
{activity_text}"""

    try:
        raw, _log = await call_ai_with_limit(
            db=db,
            user_id=current_user.id,
            feature="suggest_todos",
            call_fn=lambda: ai_service._call_claude_raw(
                prompt, 1500, system=SYSTEM_PROMPT_SUGGEST_TODOS,
            ),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI call failed: {e}")

    # 解析 JSON 响应
    cleaned = raw.strip().strip("`").strip()
    if cleaned.startswith("json"):
        cleaned = cleaned[4:].strip()
    try:
        suggestions = json.loads(cleaned)
    except json.JSONDecodeError:
        return {"suggestions": [], "error": "AI returned invalid JSON", "raw": raw[:500]}

    return {"suggestions": suggestions}


# PAUSED: Smart Search — AI Search page removed from frontend
# Keeping code for future re-enablement
#
# @router.post("/search")
# async def smart_search(...):
#     """Smart search — Claude reads all activities and finds relevant ones."""
#     pass


# DISABLED: Embedding-based search endpoints
# Keeping pgvector schema and indexes intact for future use (>1000 contacts)
#
# @router.post("/embed-activity")
# async def embed_single_activity(...):
#     """DISABLED: Using Claude direct search instead"""
#     pass
#
# @router.post("/embed-all")
# async def embed_all_activities(...):
#     """DISABLED: Using Claude direct search instead"""
#     pass
