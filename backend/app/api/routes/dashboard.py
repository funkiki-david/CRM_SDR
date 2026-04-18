"""
Dashboard API — Today's follow-up action list
Returns leads that need follow-up today, sorted by urgency
"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, or_, case
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.config import AI_DAILY_BUDGET_USD, AI_MONTHLY_BUDGET_USD
from app.models.user import User, UserRole
from app.models.lead import Lead, LeadStatus
from app.models.contact import Contact
from app.models.activity import Activity
from app.services.ai_budget import (
    get_spend_today,
    get_spend_month,
    budget_status_color,
    get_cache_stats_month,
)

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("/follow-ups")
async def get_follow_ups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Today's follow-up action list — the first thing an SDR sees when they log in.
    Returns leads sorted by urgency:
      1. Overdue (past follow-up date) — most urgent
      2. Due today
      3. Due tomorrow / this week
    Each item includes: contact name, last contact time, summary, suggested next action
    """
    today = date.today()
    end_of_week = today + timedelta(days=7)

    # Base query: leads with upcoming follow-ups, joined with contact info
    query = (
        select(Lead)
        .options(joinedload(Lead.contact), joinedload(Lead.owner))
        .where(
            Lead.status.notin_([LeadStatus.CLOSED_WON, LeadStatus.CLOSED_LOST]),
            Lead.next_follow_up <= end_of_week,
        )
    )

    # Role-based filtering: Admin & Manager see all, SDR sees only their own
    if current_user.role == UserRole.SDR:
        query = query.where(Lead.owner_id == current_user.id)

    # Sort by urgency: overdue first, then today, then future
    query = query.order_by(Lead.next_follow_up.asc())

    result = await db.execute(query)
    leads = result.unique().scalars().all()

    # For each lead, get the most recent activity
    follow_ups = []
    for lead in leads:
        # Get last activity for this contact
        last_activity_result = await db.execute(
            select(Activity)
            .where(Activity.contact_id == lead.contact_id)
            .order_by(Activity.created_at.desc())
            .limit(1)
        )
        last_activity = last_activity_result.scalar_one_or_none()

        # Determine urgency level
        if lead.next_follow_up < today:
            urgency = "overdue"
        elif lead.next_follow_up == today:
            urgency = "today"
        else:
            urgency = "upcoming"

        follow_ups.append({
            "lead_id": lead.id,
            "contact_id": lead.contact_id,
            "contact_name": f"{lead.contact.first_name} {lead.contact.last_name}",
            "company": lead.contact.company_name,
            "title": lead.contact.title,
            "lead_status": lead.status.value,
            "follow_up_date": str(lead.next_follow_up),
            "follow_up_reason": lead.follow_up_reason,
            "urgency": urgency,
            "last_activity_date": str(last_activity.created_at) if last_activity else None,
            "last_activity_type": last_activity.activity_type.value if last_activity else None,
            "last_activity_summary": last_activity.subject or last_activity.ai_summary if last_activity else None,
            "owner_name": lead.owner.full_name,
        })

    return {"follow_ups": follow_ups, "total": len(follow_ups)}


@router.get("/pipeline-summary")
async def get_pipeline_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Pipeline overview — count of leads in each stage.
    Returns counts grouped by LeadStatus.
    """
    query = select(Lead.status, func.count(Lead.id)).group_by(Lead.status)

    # Role-based filtering
    if current_user.role == UserRole.SDR:
        query = query.where(Lead.owner_id == current_user.id)

    result = await db.execute(query)
    rows = result.all()

    # Build counts dict with all statuses defaulting to 0
    counts = {s.value: 0 for s in LeadStatus}
    for status, count in rows:
        counts[status.value] = count

    return counts


@router.get("/ai-budget")
async def get_ai_budget_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    AI 预算状态 — Dashboard 右上角显示用
    Returns today's spend, month's spend, limits, and status color.
    """
    today = await get_spend_today(db)
    month = await get_spend_month(db)
    cache_stats = await get_cache_stats_month(db)
    return {
        "spent_today": round(today, 4),
        "spent_month": round(month, 4),
        "daily_limit": AI_DAILY_BUDGET_USD,
        "monthly_limit": AI_MONTHLY_BUDGET_USD,
        "status": budget_status_color(today),
        "daily_percent": round((today / AI_DAILY_BUDGET_USD) * 100, 1) if AI_DAILY_BUDGET_USD else 0,
        "monthly_percent": round((month / AI_MONTHLY_BUDGET_USD) * 100, 1) if AI_MONTHLY_BUDGET_USD else 0,
        "cache": cache_stats,
    }
