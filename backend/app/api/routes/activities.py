"""
Activities API — Record and retrieve SDR interactions with contacts
Provides:
  - Create activity (call, email, linkedin, meeting, note)
  - List activities for a contact (timeline)
  - Team activity feed (for dashboard)
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.contact import Contact
from app.models.lead import Lead, LeadStatus
from app.models.activity import Activity, ActivityType
from app.schemas.activity import ActivityCreate, ActivityResponse

router = APIRouter(prefix="/api/activities", tags=["Activities"])


def _build_activity_response(activity: Activity) -> dict:
    """Build response dict with joined contact/user names"""
    return {
        "id": activity.id,
        "activity_type": activity.activity_type.value,
        "subject": activity.subject,
        "content": activity.content,
        "ai_summary": activity.ai_summary,
        "contact_id": activity.contact_id,
        "user_id": activity.user_id,
        "created_at": activity.created_at,
        "contact_name": f"{activity.contact.first_name} {activity.contact.last_name}" if activity.contact else None,
        "user_name": activity.user.full_name if activity.user else None,
    }


@router.post("", response_model=ActivityResponse, status_code=status.HTTP_201_CREATED)
async def create_activity(
    data: ActivityCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Record a new activity (call, email, meeting, etc.)
    The contact must be owned by the current user (or accessible by role)
    """
    # Verify the contact exists and user has access
    contact = await db.get(Contact, data.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    # Check ownership (SDR can only log for their own contacts)
    if current_user.role == UserRole.SDR and contact.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Validate activity type
    try:
        activity_type = ActivityType(data.activity_type)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid activity type. Options: {[t.value for t in ActivityType]}",
        )

    activity = Activity(
        activity_type=activity_type,
        subject=data.subject,
        content=data.content,
        contact_id=data.contact_id,
        user_id=current_user.id,
    )
    db.add(activity)
    await db.flush()

    # If a follow-up date was provided, update or create the lead record
    if data.next_follow_up:
        result = await db.execute(
            select(Lead).where(
                Lead.contact_id == data.contact_id,
                Lead.owner_id == current_user.id,
                Lead.status.notin_([LeadStatus.CLOSED_WON, LeadStatus.CLOSED_LOST]),
            )
        )
        lead = result.scalar_one_or_none()
        if lead:
            lead.next_follow_up = data.next_follow_up
            lead.follow_up_reason = data.follow_up_reason
        else:
            # Create a new lead if none exists
            lead = Lead(
                contact_id=data.contact_id,
                owner_id=current_user.id,
                status=LeadStatus.CONTACTED,
                next_follow_up=data.next_follow_up,
                follow_up_reason=data.follow_up_reason,
            )
            db.add(lead)
        await db.flush()

    # Reload with relationships for response
    result = await db.execute(
        select(Activity)
        .options(joinedload(Activity.contact), joinedload(Activity.user))
        .where(Activity.id == activity.id)
    )
    activity = result.scalar_one()
    return _build_activity_response(activity)


@router.get("/contact/{contact_id}")
async def list_contact_activities(
    contact_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all activities for a specific contact (timeline view)"""
    # Verify contact access
    contact = await db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    if current_user.role == UserRole.SDR and contact.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(Activity)
        .options(joinedload(Activity.contact), joinedload(Activity.user))
        .where(Activity.contact_id == contact_id)
        .order_by(Activity.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    activities = result.unique().scalars().all()
    return [_build_activity_response(a) for a in activities]


@router.get("/feed")
async def team_activity_feed(
    limit: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Team activity feed for the dashboard
    Shows recent activities across the team, like a social feed:
    "David sent a cold email to John Smith"
    "Lisa had a call with Sarah Lee"
    """
    query = (
        select(Activity)
        .options(joinedload(Activity.contact), joinedload(Activity.user))
    )

    # Role-based filtering: Admin & Manager see all, SDR sees only their own
    if current_user.role == UserRole.SDR:
        query = query.where(Activity.user_id == current_user.id)

    query = query.order_by(Activity.created_at.desc()).limit(limit)
    result = await db.execute(query)
    activities = result.unique().scalars().all()
    return [_build_activity_response(a) for a in activities]
