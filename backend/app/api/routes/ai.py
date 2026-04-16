"""
AI API routes — Research reports, email drafting, and semantic search
All AI features are triggered explicitly by the user (not automatic)
so API key costs are predictable.
"""

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.contact import Contact
from app.models.activity import Activity
from app.models.embedding import Embedding
from app.services.ai import ai_service

router = APIRouter(prefix="/api/ai", tags=["AI"])


# === Status ===

@router.get("/status")
async def ai_status(current_user: User = Depends(get_current_user)):
    """Check which AI services are configured"""
    return {
        "claude_ready": ai_service.claude_ready,
        "embeddings_ready": ai_service.embeddings_ready,
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
    if not ai_service.claude_ready:
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

    # Save to contact
    contact.ai_person_report = report

    # Also generate tags
    try:
        tags = await ai_service.generate_tags(
            title=contact.title,
            company_name=contact.company_name,
            industry=contact.industry,
        )
        contact.ai_tags = json.dumps(tags)
    except Exception:
        pass  # Tags are optional, don't fail the whole request

    await db.flush()
    return {"report": report, "tags": contact.ai_tags}


@router.post("/report/company")
async def generate_company_report(
    data: ReportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate an AI research report about a contact's company"""
    if not ai_service.claude_ready:
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
    """
    Generate a personalized email draft using all available context:
    - Contact info
    - AI person report
    - AI company report
    - Activity history
    """
    if not ai_service.claude_ready:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured. Add it in Settings.")

    contact = await db.get(Contact, data.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    # Get activity history for context
    result = await db.execute(
        select(Activity)
        .where(Activity.contact_id == contact.id)
        .order_by(Activity.created_at.desc())
        .limit(10)
    )
    activities = result.scalars().all()

    # Build activity history text
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


# === Semantic Search ===

class EmbedRequest(BaseModel):
    activity_id: int


@router.post("/embed-activity")
async def embed_single_activity(
    data: EmbedRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate and store an embedding for a single activity"""
    if not ai_service.embeddings_ready:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured.")

    activity = await db.get(Activity, data.activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Build text for embedding
    source_text = f"{activity.activity_type.value}: {activity.subject or ''} {activity.content or ''}"

    vector = await ai_service.create_embedding(source_text)

    # Check if embedding already exists
    result = await db.execute(
        select(Embedding).where(Embedding.activity_id == activity.id)
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.source_text = source_text
        existing.vector = vector
    else:
        emb = Embedding(
            activity_id=activity.id,
            source_text=source_text,
            vector=vector,
        )
        db.add(emb)

    await db.flush()
    return {"status": "ok", "activity_id": activity.id}


@router.post("/embed-all")
async def embed_all_activities(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate embeddings for all activities that don't have one yet"""
    if not ai_service.embeddings_ready:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured.")

    # Find activities without embeddings
    result = await db.execute(
        select(Activity).where(
            ~Activity.id.in_(select(Embedding.activity_id))
        )
    )
    activities = result.scalars().all()

    if not activities:
        return {"message": "All activities already have embeddings", "count": 0}

    # Batch embed (max 20 at a time to avoid API limits)
    count = 0
    batch_size = 20
    for i in range(0, len(activities), batch_size):
        batch = activities[i : i + batch_size]
        texts = [
            f"{a.activity_type.value}: {a.subject or ''} {a.content or ''}"
            for a in batch
        ]
        vectors = await ai_service.create_embeddings_batch(texts)

        for activity, text, vector in zip(batch, texts, vectors):
            emb = Embedding(
                activity_id=activity.id,
                source_text=text,
                vector=vector,
            )
            db.add(emb)
            count += 1

    await db.flush()
    return {"message": f"Created embeddings for {count} activities", "count": count}


class SearchRequest(BaseModel):
    query: str
    limit: int = 10


@router.post("/search")
async def semantic_search(
    data: SearchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Semantic search — find activities by meaning, not exact keywords.
    Example: "who mentioned budget problems" → finds all related conversations
    """
    if not ai_service.embeddings_ready:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured.")

    # Convert search query to vector
    query_vector = await ai_service.create_embedding(data.query)
    vector_str = "[" + ",".join(str(v) for v in query_vector) + "]"

    # Search using cosine distance in pgvector
    result = await db.execute(
        text("""
            SELECT
                e.activity_id,
                e.source_text,
                1 - (e.vector <=> :query_vec::vector) AS similarity,
                a.activity_type,
                a.subject,
                a.content,
                a.created_at,
                a.contact_id,
                c.first_name,
                c.last_name,
                c.company_name,
                u.full_name AS user_name
            FROM embeddings e
            JOIN activities a ON a.id = e.activity_id
            JOIN contacts c ON c.id = a.contact_id
            JOIN users u ON u.id = a.user_id
            ORDER BY e.vector <=> :query_vec::vector
            LIMIT :lim
        """),
        {"query_vec": vector_str, "lim": data.limit},
    )
    rows = result.fetchall()

    results = []
    for row in rows:
        results.append({
            "activity_id": row.activity_id,
            "similarity": round(float(row.similarity), 3),
            "activity_type": row.activity_type,
            "subject": row.subject,
            "content": row.content,
            "created_at": str(row.created_at),
            "contact_id": row.contact_id,
            "contact_name": f"{row.first_name} {row.last_name}",
            "company_name": row.company_name,
            "user_name": row.user_name,
        })

    return {"results": results, "query": data.query}
