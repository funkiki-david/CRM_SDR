"""
Dashboard API — Today's follow-up action list
Returns leads that need follow-up today, sorted by urgency
"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, or_, case
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.lead import Lead, LeadStatus
from app.models.contact import Contact
from app.models.activity import Activity

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

    # Role-based filtering
    if current_user.role == UserRole.SDR:
        query = query.where(Lead.owner_id == current_user.id)
    elif current_user.role == UserRole.MANAGER:
        query = query.where(
            or_(
                Lead.owner_id == current_user.id,
                Lead.owner_id.in_(
                    select(User.id).where(User.manager_id == current_user.id)
                ),
            )
        )

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
