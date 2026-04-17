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
from app.core.config import CLAUDE_MODEL, AI_SEARCH_ACTIVITY_LIMIT
from app.models.user import User, UserRole
from app.models.contact import Contact
from app.models.activity import Activity
from app.services.ai import ai_service

# DISABLED: Using Claude direct search instead of pgvector embeddings
# from app.models.embedding import Embedding

router = APIRouter(prefix="/api/ai", tags=["AI"])


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

    report = await ai_service.generate_person_report(
        first_name=contact.first_name,
        last_name=contact.last_name,
        title=contact.title,
        company_name=contact.company_name,
        industry=contact.industry,
        linkedin_url=contact.linkedin_url,
    )

    contact.ai_person_report = report

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

    report = await ai_service.generate_company_report(
        company_name=contact.company_name,
        company_domain=contact.company_domain,
        industry=contact.industry,
        company_size=contact.company_size,
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

    draft = await ai_service.draft_email(
        contact_first_name=contact.first_name,
        contact_last_name=contact.last_name,
        contact_title=contact.title,
        company_name=contact.company_name,
        person_report=contact.ai_person_report,
        company_report=contact.ai_company_report,
        activity_history=activity_history,
        sender_name=current_user.full_name,
    )

    return draft


# === Smart Search (Claude reads activities directly) ===

class SearchRequest(BaseModel):
    query: str
    limit: int = 10


@router.post("/search")
async def smart_search(
    data: SearchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Smart search — Claude reads all activities and finds relevant ones.
    No embeddings needed. Works immediately with just an Anthropic key.
    """
    if not ai_service.ai_ready:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured. Add it in Settings.")

    # Load activities with contact info
    query = (
        select(Activity)
        .options(joinedload(Activity.contact), joinedload(Activity.user))
        .order_by(Activity.created_at.desc())
        .limit(AI_SEARCH_ACTIVITY_LIMIT)
    )

    # Apply role-based filtering
    if current_user.role == UserRole.SDR:
        query = query.where(Activity.user_id == current_user.id)

    result = await db.execute(query)
    activities = result.unique().scalars().all()

    if not activities:
        return {"results": [], "query": data.query}

    # Build activities text for Claude to read
    lines = []
    for a in activities:
        contact_name = f"{a.contact.first_name} {a.contact.last_name}" if a.contact else "Unknown"
        company = a.contact.company_name if a.contact else ""
        user_name = a.user.full_name if a.user else "Unknown"
        lines.append(
            f"[ID:{a.id}] [{a.activity_type.value.upper()}] "
            f"Contact: {contact_name} ({company}) | "
            f"By: {user_name} | "
            f"Date: {a.created_at.strftime('%Y-%m-%d')} | "
            f"Subject: {a.subject or 'N/A'} | "
            f"Content: {(a.content or '')[:300]}"
        )

    activities_text = "\n".join(lines)

    # Ask Claude to find relevant activities
    raw_result = await ai_service.smart_search(data.query, activities_text)

    # Parse Claude's JSON response
    import json as json_lib
    try:
        cleaned = raw_result.strip().strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:].strip()
        results = json_lib.loads(cleaned)
        if not isinstance(results, list):
            results = []
    except (json_lib.JSONDecodeError, ValueError):
        results = []

    return {"results": results[:data.limit], "query": data.query}


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
