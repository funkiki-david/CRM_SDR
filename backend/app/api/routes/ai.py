"""
AI API routes — Research reports, email drafting, and smart search
All AI features powered by a single Anthropic API key (Haiku 4.5).
"""

import json
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
)
from app.models.user import User, UserRole
from app.models.contact import Contact
from app.models.activity import Activity
from app.services.ai import ai_service
from app.services.ai_budget import call_ai_with_limit

# DISABLED: Using Claude direct search instead of pgvector embeddings
# from app.models.embedding import Embedding

router = APIRouter(prefix="/api/ai", tags=["AI"])


def _build_person_prompt(contact: Contact) -> str:
    """Build person research prompt (matches ai_service.generate_person_report)"""
    return f"""You are a sales research analyst. Write a concise research brief about this person to help an SDR prepare for outreach.

Person:
- Name: {contact.first_name} {contact.last_name}
- Title: {contact.title or 'Unknown'}
- Company: {contact.company_name or 'Unknown'}
- Industry: {contact.industry or 'Unknown'}
- LinkedIn: {contact.linkedin_url or 'Not available'}

Write a 3-4 paragraph report covering:
1. Professional background and likely responsibilities based on their title
2. What they probably care about in their role (pain points, priorities)
3. Conversation starters and angles for a cold outreach

Be specific and actionable. No fluff. Write in a direct, professional tone."""


def _build_company_prompt(contact: Contact) -> str:
    return f"""You are a sales research analyst. Write a concise company research brief to help an SDR understand this prospect's company.

Company:
- Name: {contact.company_name or 'Unknown'}
- Website: {contact.company_domain or 'Unknown'}
- Industry: {contact.industry or 'Unknown'}
- Size: {contact.company_size or 'Unknown'} employees

Write a 3-4 paragraph report covering:
1. What the company likely does based on available info
2. Potential pain points and challenges for a company of this size and industry
3. How our solution might be relevant to them
4. Key talking points for outreach

Be specific and actionable. No fluff. Write in a direct, professional tone."""


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


@router.post("/report/person")
async def generate_person_report(
    data: ReportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate an AI research report about a person and save it to their profile"""
    if not ai_service.ai_ready:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured. Add it in Settings.")

    contact = await db.get(Contact, data.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    prompt = _build_person_prompt(contact)
    report, _log = await call_ai_with_limit(
        db=db,
        user_id=current_user.id,
        feature="research_person",
        call_fn=lambda: ai_service._call_claude_raw(prompt, CLAUDE_MAX_TOKENS_RESEARCH),
    )

    contact.ai_person_report = report

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
    return {"report": report, "tags": contact.ai_tags}


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

    prompt = _build_company_prompt(contact)
    report, _log = await call_ai_with_limit(
        db=db,
        user_id=current_user.id,
        feature="research_company",
        call_fn=lambda: ai_service._call_claude_raw(prompt, CLAUDE_MAX_TOKENS_RESEARCH),
    )

    contact.ai_company_report = report
    await db.flush()
    return {"report": report}


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

    # Inline prompt build so we can route through call_ai_with_limit
    person_block = f"PERSON RESEARCH:\n{contact.ai_person_report}" if contact.ai_person_report else ""
    company_block = f"COMPANY RESEARCH:\n{contact.ai_company_report}" if contact.ai_company_report else ""
    history_block = f"INTERACTION HISTORY:\n{activity_history}" if activity_history else "No prior interactions."
    prompt = f"""You are a top-performing SDR writing a personalized cold email. Use ALL the context below to write a highly relevant, personalized email.

CONTACT:
- Name: {contact.first_name} {contact.last_name}
- Title: {contact.title or 'Unknown'}
- Company: {contact.company_name or 'Unknown'}

{person_block}

{company_block}

{history_block}

Write a cold email with:
1. A compelling, short subject line (under 50 characters)
2. A personalized opening that shows you did your research
3. A clear value proposition in 1-2 sentences
4. A soft call to action

Keep it under 150 words. Be conversational, not salesy. Sign off as {current_user.full_name}.

Return the result in this exact format:
SUBJECT: [subject line here]
BODY:
[email body here]"""

    result, _log = await call_ai_with_limit(
        db=db,
        user_id=current_user.id,
        feature="draft_email",
        call_fn=lambda: ai_service._call_claude_raw(prompt, CLAUDE_MAX_TOKENS_EMAIL),
    )

    subject = ""
    body = result
    if "SUBJECT:" in result and "BODY:" in result:
        parts = result.split("BODY:", 1)
        subject_part = parts[0].replace("SUBJECT:", "").strip()
        subject = subject_part.split("\n")[0].strip()
        body = parts[1].strip()

    return {"subject": subject, "body": body}


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
