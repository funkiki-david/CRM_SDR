"""
Activities API — Record and retrieve SDR interactions with contacts
Provides:
  - Create activity (call, email, linkedin, meeting, note)
  - List activities for a contact (timeline)
  - Team activity feed (for dashboard)
"""

import csv
import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, or_, func
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


# === CSV columns for backup/sync ===
# 用 email (not id) 做 contact/user 关联 —— 跨 DB 可移植（不同环境 id 可能不同）
# Use email for contact/user reference so CSV round-trips across DBs.
ACTIVITY_CSV_COLUMNS = [
    "activity_type",
    "subject",
    "content",
    "ai_summary",
    "contact_email",
    "user_email",
    "created_at",
]


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
        # Audit step B: mockup fields surfaced in API responses too
        "outcome": activity.outcome,
        "temperature": activity.temperature,
        "duration_minutes": activity.duration_minutes,
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

    # Team-shared: any logged-in user can log activity against any contact.

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
        # Audit step B: optional mockup fields
        outcome=data.outcome,
        temperature=data.temperature,
        duration_minutes=data.duration_minutes,
    )
    db.add(activity)
    await db.flush()

    # v1.3 § 11.3: Direct lead.status update via Log Activity dropdown.
    # Silently skips when contact has no lead, picks the most recently
    # updated lead when multiple exist, no history kept (overwrite).
    await _maybe_update_lead_status(db, data.contact_id, data.lead_status_update)

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


# === Edit + Delete (Problem 3) ===

from pydantic import BaseModel as _BM


async def _maybe_update_lead_status(
    db: AsyncSession,
    contact_id: int,
    new_status: Optional[str],
) -> None:
    """v1.3 § 11.3 helper: optionally bump the contact's lead status.

    Behaviour:
    - new_status is None       → no-op (most common case, don't touch the lead)
    - contact has no lead      → silent skip (don't error — many contacts are
                                 leadless during early CRM use)
    - contact has multiple leads → update the most recently updated one
    - invalid enum value       → raise HTTPException 400
    """
    if new_status is None:
        return
    try:
        target = LeadStatus(new_status)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid lead_status_update. Options: {[s.value for s in LeadStatus]}",
        )
    res = await db.execute(
        select(Lead)
        .where(Lead.contact_id == contact_id)
        .order_by(Lead.updated_at.desc())
        .limit(1)
    )
    lead = res.scalar_one_or_none()
    if lead is None:
        return  # silent skip — leadless contacts are valid
    lead.status = target
    await db.flush()


class ActivityPatch(_BM):
    activity_type: Optional[str] = None
    subject: Optional[str] = None
    content: Optional[str] = None
    contact_id: Optional[int] = None
    # Allow editing the original timestamp (e.g. user logged a call yesterday
    # but only got around to entering it today). ISO format with timezone.
    created_at: Optional[datetime] = None
    # v1.3 § 11.3: same status-update lever as POST.
    lead_status_update: Optional[str] = None
    # Audit step B: editable mockup fields
    outcome: Optional[str] = None
    temperature: Optional[str] = None
    duration_minutes: Optional[int] = None


@router.patch("/{activity_id}")
async def update_activity(
    activity_id: int,
    data: ActivityPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Edit an activity. Owners can edit their own; Admin can edit any."""
    a = await db.get(Activity, activity_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    if a.user_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="You can only edit your own activities")

    if data.activity_type is not None:
        try:
            a.activity_type = ActivityType(data.activity_type.lower())
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid activity_type")
    if data.subject is not None:
        a.subject = data.subject
    if data.content is not None:
        a.content = data.content
    if data.contact_id is not None:
        # Validate target contact exists
        target = await db.get(Contact, data.contact_id)
        if target is None:
            raise HTTPException(status_code=400, detail="contact_id not found")
        a.contact_id = data.contact_id
    if data.created_at is not None:
        a.created_at = data.created_at
    # Audit step B: mockup fields editable too. None = leave alone; explicit
    # empty string would still mean "set to empty", which is fine.
    if data.outcome is not None:
        a.outcome = data.outcome or None
    if data.temperature is not None:
        a.temperature = data.temperature or None
    if data.duration_minutes is not None:
        a.duration_minutes = data.duration_minutes

    # v1.3 § 11.3: also accept lead_status_update during edits.
    await _maybe_update_lead_status(db, a.contact_id, data.lead_status_update)

    await db.flush()
    result = await db.execute(
        select(Activity)
        .options(joinedload(Activity.contact), joinedload(Activity.user))
        .where(Activity.id == a.id)
    )
    return _build_activity_response(result.scalar_one())


@router.delete("/{activity_id}", status_code=204)
async def delete_activity(
    activity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete an activity. Owners can delete their own; Admin can delete any."""
    a = await db.get(Activity, activity_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    if a.user_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="You can only delete your own activities")
    await db.delete(a)


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

    # Team-shared: any user can view any contact's activity timeline.

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
    limit: int = Query(15, ge=1, le=100),
    offset: int = Query(0, ge=0),
    activity_type: Optional[str] = Query(None, description="Filter: call/email/linkedin/meeting/note"),
    time_range: str = Query("all", description="today | week | month | all"),
    search: Optional[str] = Query(None, description="Search contact or user name"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Team activity feed for the dashboard.
    Supports pagination + filters (type / time range / search).
    Response: {items, total, has_more}
    """
    from datetime import datetime, timedelta, timezone as tz

    base_query = (
        select(Activity)
        .options(joinedload(Activity.contact), joinedload(Activity.user))
    )
    # Team-shared feed: everyone sees everyone's activities.

    # Type filter
    if activity_type:
        try:
            at = ActivityType(activity_type)
            base_query = base_query.where(Activity.activity_type == at)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid activity_type: {activity_type}")

    # Time range filter
    now = datetime.now(tz.utc)
    if time_range == "today":
        base_query = base_query.where(
            Activity.created_at >= now.replace(hour=0, minute=0, second=0, microsecond=0)
        )
    elif time_range == "week":
        base_query = base_query.where(Activity.created_at >= now - timedelta(days=7))
    elif time_range == "month":
        base_query = base_query.where(Activity.created_at >= now - timedelta(days=30))

    # Search — contact name (first+last) OR user name
    if search:
        term = f"%{search.strip()}%"
        base_query = base_query.join(Activity.contact).outerjoin(Activity.user).where(
            or_(
                Contact.first_name.ilike(term),
                Contact.last_name.ilike(term),
                Contact.company_name.ilike(term),
                User.full_name.ilike(term),
            )
        )

    # Total count（for pagination UI）
    count_q = select(func.count()).select_from(base_query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # Paginated results
    paged_query = base_query.order_by(Activity.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(paged_query)
    activities = result.unique().scalars().all()

    return {
        "items": [_build_activity_response(a) for a in activities],
        "total": total,
        "has_more": (offset + len(activities)) < total,
    }


# === CSV export / import for backup + sync ===

@router.get("/export")
async def export_activities(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    导出所有 activities 为 UTF-8 BOM CSV。用于每日 cloud backup。
    字段用 email 关联 contact/user —— 可跨 DB 导入。
    """
    result = await db.execute(
        select(Activity)
        .options(joinedload(Activity.contact), joinedload(Activity.user))
        .order_by(Activity.id)
    )
    activities = result.unique().scalars().all()

    buffer = io.StringIO()
    buffer.write("\ufeff")  # BOM for Excel
    writer = csv.writer(buffer)
    writer.writerow(ACTIVITY_CSV_COLUMNS)

    for a in activities:
        writer.writerow([
            a.activity_type.value,
            a.subject or "",
            (a.content or "").replace("\r\n", " ").replace("\n", " "),
            a.ai_summary or "",
            a.contact.email if a.contact and a.contact.email else "",
            a.user.email if a.user else "",
            a.created_at.isoformat() if a.created_at else "",
        ])

    buffer.seek(0)
    filename = f"activities_export_{len(activities)}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_activities(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    批量导入 activities CSV。Admin only.
    按 contact_email 找目标联系人；找不到的行计入 failed。
    按 user_email 找 user；找不到就归属当前 Admin。
    完全重复的 activity 不检测（可能产生副本 —— 纯追加模式）。
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only Admin can bulk-import activities")
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="File is empty")

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = raw.decode("gbk")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="File encoding not supported (UTF-8 or GBK required)")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV missing header row")

    # 预加载邮箱 → contact_id / user_id 映射（减少 N+1 query）
    contact_map = {}
    for c in (await db.execute(select(Contact.id, Contact.email))).all():
        if c.email:
            contact_map[c.email.lower()] = c.id

    user_map = {}
    for u in (await db.execute(select(User.id, User.email))).all():
        user_map[u.email.lower()] = u.id

    created = 0
    failed = []
    for row_num, row in enumerate(reader, start=2):
        ce = (row.get("contact_email") or "").strip().lower()
        if not ce:
            failed.append({"row": row_num, "reason": "missing contact_email"})
            continue
        cid = contact_map.get(ce)
        if cid is None:
            failed.append({"row": row_num, "reason": f"no contact with email {ce}"})
            continue

        try:
            at_enum = ActivityType((row.get("activity_type") or "note").strip().lower())
        except ValueError:
            failed.append({"row": row_num, "reason": f"invalid activity_type: {row.get('activity_type')}"})
            continue

        ue = (row.get("user_email") or "").strip().lower()
        uid = user_map.get(ue, current_user.id)  # fall back to Admin if user not found

        created_at = None
        if row.get("created_at"):
            try:
                created_at = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
            except ValueError:
                created_at = None

        act = Activity(
            activity_type=at_enum,
            subject=(row.get("subject") or None),
            content=(row.get("content") or None),
            ai_summary=(row.get("ai_summary") or None),
            contact_id=cid,
            user_id=uid,
        )
        if created_at:
            act.created_at = created_at

        db.add(act)
        created += 1

    await db.flush()
    return {
        "created": created,
        "failed": len(failed),
        "errors": failed[:50],
    }
