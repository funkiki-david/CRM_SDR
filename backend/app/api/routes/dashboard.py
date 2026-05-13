"""
Dashboard API — Today's follow-up action list
Returns leads that need follow-up today, sorted by urgency
"""

from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.config import AI_DAILY_BUDGET_USD, AI_MONTHLY_BUDGET_USD
from app.models.user import User, UserRole
from app.models.lead import Lead, LeadStatus
from app.models.contact import Contact
from app.models.activity import Activity, ActivityType
from app.models.activity_comment import ActivityComment
from app.models.activity_comment_read import ActivityCommentRead
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

    # Team-shared: all users see all follow-ups regardless of owner.

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

        # 计算上次联系多少天前 days since last contact
        days_since_last = None
        if last_activity:
            delta = datetime.now(timezone.utc) - last_activity.created_at
            days_since_last = delta.days

        follow_ups.append({
            "lead_id": lead.id,
            "contact_id": lead.contact_id,
            "contact_name": f"{lead.contact.first_name} {lead.contact.last_name}",
            "contact_email": lead.contact.email,
            "contact_phone": lead.contact.mobile_phone or lead.contact.office_phone,
            "company": lead.contact.company_name,
            "title": lead.contact.title,
            "lead_status": lead.status.value,
            "follow_up_date": str(lead.next_follow_up),
            "follow_up_reason": lead.follow_up_reason,
            "urgency": urgency,
            "last_activity_date": str(last_activity.created_at) if last_activity else None,
            "last_activity_type": last_activity.activity_type.value if last_activity else None,
            "last_activity_summary": last_activity.subject or last_activity.ai_summary if last_activity else None,
            "last_activity_content": (last_activity.content or "")[:200] if last_activity else None,
            "days_since_last_contact": days_since_last,
            "owner_name": lead.owner.full_name,
        })

    # Mix in pending Tasks (Problem 5: AI "Create Task" + future manual tasks)
    from app.models.task import Task as _Task
    from datetime import date as _date
    today = _date.today()
    tasks_q = await db.execute(
        select(_Task).where(_Task.status == "pending").order_by(_Task.due_date.asc().nullslast())
    )
    contact_ids = set()
    raw_tasks = list(tasks_q.scalars().all())
    for t in raw_tasks:
        if t.contact_id:
            contact_ids.add(t.contact_id)
    contact_map: dict[int, Contact] = {}
    if contact_ids:
        cres = await db.execute(select(Contact).where(Contact.id.in_(contact_ids)))
        for c in cres.scalars().all():
            contact_map[c.id] = c
    for t in raw_tasks:
        c = contact_map.get(t.contact_id) if t.contact_id else None
        if t.due_date and t.due_date < today:
            urgency = "overdue"
        elif t.due_date and t.due_date == today:
            urgency = "today"
        else:
            urgency = "upcoming"
        follow_ups.append({
            "lead_id": f"task-{t.id}",  # prefix so frontend can tell tasks from lead-follow-ups
            "task_id": t.id,
            "contact_id": t.contact_id,
            "contact_name": f"{c.first_name} {c.last_name}".strip() if c else "(no contact)",
            "contact_email": c.email if c else None,
            "contact_phone": (c.mobile_phone or c.office_phone) if c else None,
            "company": c.company_name if c else None,
            "title": c.title if c else None,
            "lead_status": "task",
            "follow_up_date": t.due_date.isoformat() if t.due_date else None,
            "follow_up_reason": t.description,
            "urgency": urgency,
            "last_activity_date": None,
            "last_activity_type": None,
            "last_activity_summary": None,
            "last_activity_content": t.description[:200],
            "days_since_last_contact": None,
            "owner_name": None,
            "source": t.source,
        })

    # 按紧急程度分组 Group by urgency for easier frontend rendering
    grouped = {"overdue": [], "today": [], "upcoming": []}
    for f in follow_ups:
        grouped[f["urgency"]].append(f)

    return {
        "follow_ups": follow_ups,  # 保留扁平数组向后兼容
        "grouped": grouped,
        "counts": {k: len(v) for k, v in grouped.items()},
        "total": len(follow_ups),
    }


# === Snooze / Done / Reschedule ===

class SnoozeRequest(BaseModel):
    days: int  # 延后多少天 (1 / 3 / 7 常见)


@router.patch("/follow-ups/{lead_id}/snooze")
async def snooze_follow_up(
    lead_id: int,
    data: SnoozeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Snooze a follow-up by N days (推迟跟进日期)"""
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    if data.days < 1 or data.days > 90:
        raise HTTPException(status_code=400, detail="Days must be between 1 and 90")

    base = lead.next_follow_up or date.today()
    lead.next_follow_up = base + timedelta(days=data.days)
    await db.flush()
    return {"lead_id": lead.id, "next_follow_up": str(lead.next_follow_up)}


class RescheduleRequest(BaseModel):
    next_follow_up: str  # ISO date YYYY-MM-DD
    follow_up_reason: Optional[str] = None


@router.patch("/follow-ups/{lead_id}/reschedule")
async def reschedule_follow_up(
    lead_id: int,
    data: RescheduleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reschedule follow-up to a specific date"""
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    try:
        lead.next_follow_up = date.fromisoformat(data.next_follow_up)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format (expected YYYY-MM-DD)")
    if data.follow_up_reason is not None:
        lead.follow_up_reason = data.follow_up_reason
    await db.flush()
    return {"lead_id": lead.id, "next_follow_up": str(lead.next_follow_up)}


@router.patch("/follow-ups/{lead_id}/done")
async def mark_follow_up_done(
    lead_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark follow-up as completed (clear next_follow_up)"""
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    lead.next_follow_up = None
    lead.follow_up_reason = None
    await db.flush()
    return {"lead_id": lead.id, "status": "done"}


@router.patch("/follow-ups/{lead_id}/close")
async def close_follow_up(
    lead_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Close a follow-up — clear next_follow_up + stamp follow_up_closed_at.

    Distinct from /done: "done" means "I followed up this round, schedule
    next round later." "close" means "I'm done chasing this one for now —
    don't show it on the dashboard." The Lead/Contact remains Active.
    """
    _ = current_user  # auth required, team-shared, no per-owner gating
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    lead.next_follow_up = None
    lead.follow_up_reason = None
    lead.follow_up_closed_at = datetime.now(timezone.utc)
    await db.flush()
    return {
        "lead_id": lead.id,
        "status": "closed",
        "follow_up_closed_at": lead.follow_up_closed_at.isoformat(),
    }


@router.get("/quick-stats")
async def get_quick_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Quick Stats 模组 —— Dashboard 顶部 4 个数字
      - total_contacts: 当前用户可见的联系人总数
      - emails_today / calls_today / meetings_this_week: 按活动类型 + 时间过滤
    """
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)

    # Team-shared totals — all users see the full team numbers.
    total_contacts = (await db.execute(select(func.count(Contact.id)))).scalar() or 0

    def _act_count(activity_type: ActivityType, since: datetime):
        return select(func.count(Activity.id)).where(
            Activity.activity_type == activity_type,
            Activity.created_at >= since,
        )

    emails_today = (await db.execute(_act_count(ActivityType.EMAIL, today_start))).scalar() or 0
    calls_today = (await db.execute(_act_count(ActivityType.CALL, today_start))).scalar() or 0
    meetings_week = (await db.execute(_act_count(ActivityType.MEETING, week_start))).scalar() or 0

    return {
        "total_contacts": total_contacts,
        "emails_today": emails_today,
        "calls_today": calls_today,
        "meetings_this_week": meetings_week,
    }


@router.get("/pipeline-summary")
async def get_pipeline_summary(
    scope: Literal["mine", "team"] = Query("mine"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Pipeline overview — count of leads in each stage.

    scope=mine (default): only leads on contacts where assigned_to = me.
    scope=team:           all leads (admin-only — SDR/Manager get downgraded
                          to "mine" silently).

    Returns:
      {
        "scope": "mine" | "team",
        "pipeline": { "new": N, "contacted": N, ..., "closed_lost": N }
      }
    """
    # Permission downgrade: non-admin requesting team scope falls back to mine.
    effective_scope = scope if current_user.role == UserRole.ADMIN else "mine"

    query = select(Lead.status, func.count(Lead.id))
    if effective_scope == "mine":
        query = query.join(Contact, Lead.contact_id == Contact.id).where(
            Contact.assigned_to == current_user.id
        )
    query = query.group_by(Lead.status)

    result = await db.execute(query)
    rows = result.all()

    counts = {s.value: 0 for s in LeadStatus}
    for status, count in rows:
        counts[status.value] = count

    return {"scope": effective_scope, "pipeline": counts}


# ============================================================================
# Mentions inbox (Dashboard V1 — "What's new for you" section)
# ============================================================================


@router.get("/mentions")
async def get_mentions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Unread mentions for the current user.

    A mention exists iff:
      - activity_comment.mentioned_user_ids contains current_user.id
      - AND no row in activity_comment_reads matches (user_id, comment_id)

    Returns the 20 most-recent unread mentions plus a count for the badge.
    Each row carries enough context to render without a follow-up fetch:
    comment text + author name + activity type + contact name.
    """
    # Read receipts for this user — subquery used in the NOT IN filter.
    read_subq = select(ActivityCommentRead.comment_id).where(
        ActivityCommentRead.user_id == current_user.id
    )

    stmt = (
        select(ActivityComment)
        .options(
            selectinload(ActivityComment.user),
            selectinload(ActivityComment.activity).selectinload(Activity.contact),
        )
        .where(
            and_(
                ActivityComment.mentioned_user_ids.any(current_user.id),
                ActivityComment.id.notin_(read_subq),
            )
        )
        .order_by(ActivityComment.created_at.desc())
        .limit(20)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    mentions = []
    for c in rows:
        author_name = c.user.full_name if c.user else None
        contact = c.activity.contact if c.activity else None
        contact_name = (
            f"{contact.first_name or ''} {contact.last_name or ''}".strip()
            if contact else None
        )
        mentions.append({
            "id": c.id,
            "comment_text": c.text,
            "author": {
                "id": c.user_id,
                "name": author_name,
            },
            "activity_id": c.activity_id,
            "activity_type": c.activity.activity_type.value if c.activity else None,
            "contact_id": contact.id if contact else None,
            "contact_name": contact_name,
            "created_at": c.created_at.isoformat(),
        })

    return {"mentions": mentions, "unread_count": len(mentions)}


@router.patch("/mentions/{comment_id}/dismiss")
async def dismiss_mention(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a single mention as read. Idempotent — second call is a no-op."""
    existing = await db.execute(
        select(ActivityCommentRead).where(
            ActivityCommentRead.user_id == current_user.id,
            ActivityCommentRead.comment_id == comment_id,
        )
    )
    if existing.scalar_one_or_none() is None:
        db.add(ActivityCommentRead(
            user_id=current_user.id,
            comment_id=comment_id,
        ))
        await db.flush()
    return {"comment_id": comment_id, "status": "dismissed"}


# ============================================================================
# AI Budget (legacy — still exposed but no longer surfaced on V1 dashboard)
# ============================================================================


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
