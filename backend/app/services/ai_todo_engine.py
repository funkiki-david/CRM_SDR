"""
AI Suggested To-Do — rule engine scaffold (Checkpoint 1).

Architecture:
- Each rule is a standalone async function that takes (db, user) and returns
  list[TodoSuggestion]. Rules are registered via the @register_rule decorator
  and live in TODO_RULES.
- generate_todos_for_user(db, user, max_count) runs all enabled rules,
  filters out (rule_id, contact_id) combos the user has snoozed, sorts by
  urgency then contact_id (stable), and truncates to max_count.

Snooze hash format (matches spec § 5.3):
    sha256(f"{rule_id}|{contact_id or ''}").hexdigest()[:32]

Checkpoint 1 deliverables:
- Engine + decorator + Pydantic model
- One dummy rule that always returns []
- Snooze filtering logic
- 4 unit tests (see backend/tests/test_ai_todo_engine.py)

NO API or frontend changes — /api/ai/suggest-todos remains untouched.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Literal, Optional

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity, ActivityType
from app.models.contact import Contact
from app.models.lead import Lead, LeadStatus
from app.models.sent_email import SentEmail
from app.models.task import AISuggestionSnooze
from app.models.user import User


# --- Public types ---


Urgency = Literal["high", "medium", "low"]
Category = Literal["pacing", "stage", "data_health", "relationship", "discipline"]
SuggestedAction = Literal["call", "email", "linkedin", "review"]


class TodoSuggestion(BaseModel):
    """One actionable to-do surfaced to a Manager on the dashboard."""

    rule_id: str
    urgency: Urgency
    category: Category
    suggested_action: SuggestedAction
    rationale: str  # Short Chinese explanation, ideally < 30 chars per spec
    contact_id: Optional[int] = None  # None for global rules (eg weekly_volume)


# --- Rule registry ---


RuleFn = Callable[[AsyncSession, User], Awaitable[list[TodoSuggestion]]]


class _RuleEntry(BaseModel):
    id: str
    category: Category
    fn: RuleFn

    model_config = {"arbitrary_types_allowed": True}


TODO_RULES: list[_RuleEntry] = []


def register_rule(rule_id: str, category: Category) -> Callable[[RuleFn], RuleFn]:
    """Decorator to register a to-do rule.

    Usage:
        @register_rule("pacing_hot_48h", "pacing")
        async def rule_pacing_hot_48h(db, user) -> list[TodoSuggestion]:
            ...
    """

    def decorator(fn: RuleFn) -> RuleFn:
        TODO_RULES.append(_RuleEntry(id=rule_id, category=category, fn=fn))
        return fn

    return decorator


# --- Snooze hashing + lookup ---


def suggestion_hash(rule_id: str, contact_id: Optional[int]) -> str:
    """Stable hash for (rule, contact) tuple — used as snooze key.

    Format mandated by spec § 5.3: first 32 hex chars of sha256 over
    "<rule_id>|<contact_id or empty>".
    """
    payload = f"{rule_id}|{contact_id if contact_id is not None else ''}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


async def fetch_active_snoozes(db: AsyncSession, user_id: int) -> set[str]:
    """Return the set of suggestion_hash values currently snoozed for `user_id`.

    Snoozes whose `snooze_until` has passed are ignored.
    """
    now = datetime.now(timezone.utc)
    res = await db.execute(
        select(AISuggestionSnooze.suggestion_hash).where(
            AISuggestionSnooze.user_id == user_id,
            AISuggestionSnooze.snooze_until > now,
        )
    )
    return {row[0] for row in res.all()}


# --- Engine ---


_URGENCY_RANK: dict[str, int] = {"high": 0, "medium": 1, "low": 2}


async def generate_todos_for_user(
    db: AsyncSession,
    user: User,
    max_count: int = 7,
) -> list[TodoSuggestion]:
    """Run all registered rules, filter snoozed, sort, truncate."""
    snoozed = await fetch_active_snoozes(db, user.id)

    aggregated: list[TodoSuggestion] = []
    for entry in TODO_RULES:
        # Defensive: a single misbehaving rule must not break the whole engine.
        try:
            results = await entry.fn(db, user)
        except Exception:
            continue
        for s in results or []:
            if suggestion_hash(s.rule_id, s.contact_id) in snoozed:
                continue
            aggregated.append(s)

    # Sort: high < medium < low; tiebreak by contact_id (stable, deterministic).
    aggregated.sort(
        key=lambda s: (
            _URGENCY_RANK.get(s.urgency, 99),
            s.contact_id if s.contact_id is not None else 10**9,
        )
    )
    return aggregated[:max_count]


# --- Pacing rule constants (Checkpoint 2) ---

# Keyword sets for content-based pacing rules. Top-level constants so they
# can be tuned without editing rule logic. Case-insensitive matching.
NO_ANSWER_KEYWORDS = ["未接通", "voicemail", "no answer", "left message"]
INBOUND_KEYWORDS = ["客户来电", "inbound", "incoming call", "called in"]

# Activity types that "count" as the latest interaction. All five count.
_INTERACTION_TYPES = {
    ActivityType.CALL,
    ActivityType.EMAIL,
    ActivityType.LINKEDIN,
    ActivityType.MEETING,
    ActivityType.NOTE,
}


# --- Helpers ---


def _contact_label(contact: Optional[Contact]) -> str:
    """Short '<First Last> @ <Company>' label for the rationale field.
    Falls back gracefully when company is missing."""
    if contact is None:
        return "未知联系人"
    name = f"{contact.first_name or ''} {contact.last_name or ''}".strip() or "未命名"
    if contact.company_name:
        return f"{name} @ {contact.company_name}"
    return name


async def _latest_activity_per_contact(
    db: AsyncSession,
) -> dict[int, Activity]:
    """Return {contact_id: latest_activity_row} across the whole table.

    One round-trip; rules then filter the dict in Python rather than
    re-querying the DB per contact.
    """
    sub = (
        select(
            Activity.contact_id.label("cid"),
            func.max(Activity.created_at).label("mx"),
        )
        .group_by(Activity.contact_id)
        .subquery()
    )
    q = (
        select(Activity)
        .join(
            sub,
            (Activity.contact_id == sub.c.cid)
            & (Activity.created_at == sub.c.mx),
        )
    )
    res = await db.execute(q)
    return {a.contact_id: a for a in res.scalars().all()}


async def _contacts_by_id(
    db: AsyncSession, ids: set[int]
) -> dict[int, Contact]:
    """Bulk-load contacts referenced by a rule. Empty input → empty dict."""
    if not ids:
        return {}
    res = await db.execute(select(Contact).where(Contact.id.in_(ids)))
    return {c.id: c for c in res.scalars().all()}


# --- A. Pacing rules (12) ---

# 1. pacing_hot_48h: latest call/meeting < 48h → send recap email
@register_rule("pacing_hot_48h", "pacing")
async def rule_pacing_hot_48h(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    _ = user
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=48)
    latest = await _latest_activity_per_contact(db)
    out: list[TodoSuggestion] = []
    for cid, a in latest.items():
        if a.activity_type not in (ActivityType.CALL, ActivityType.MEETING):
            continue
        if a.created_at < cutoff:
            continue
        out.append(_make(cid, "pacing_hot_48h", "high", "email",
                         f"{cid} — 24h 内发感谢/总结邮件"))
    return await _decorate(db, out)


# 2. pacing_email_no_reply_3d: last activity = email, > 3d, no later activity
@register_rule("pacing_email_no_reply_3d", "pacing")
async def rule_pacing_email_no_reply_3d(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    _ = user
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=3)
    latest = await _latest_activity_per_contact(db)
    out: list[TodoSuggestion] = []
    for cid, a in latest.items():
        if a.activity_type != ActivityType.EMAIL:
            continue
        if a.created_at >= cutoff:  # too recent — wait
            continue
        out.append(_make(cid, "pacing_email_no_reply_3d", "medium", "call",
                         f"{cid} — 邮件 3d 无回，改打电话"))
    return await _decorate(db, out)


# 3. pacing_call_no_answer_2d: last activity content contains "no answer" keyword > 2d
@register_rule("pacing_call_no_answer_2d", "pacing")
async def rule_pacing_call_no_answer_2d(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    _ = user
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=2)
    latest = await _latest_activity_per_contact(db)
    out: list[TodoSuggestion] = []
    for cid, a in latest.items():
        text = (a.content or "").lower()
        if not any(kw.lower() in text for kw in NO_ANSWER_KEYWORDS):
            continue
        if a.created_at >= cutoff:
            continue
        out.append(_make(cid, "pacing_call_no_answer_2d", "medium", "email",
                         f"{cid} — 电话未接 2d，发邮件 + LinkedIn"))
    return await _decorate(db, out)


# 4. pacing_silent_7d: 7d ≤ since_last < 14d → light touch
@register_rule("pacing_silent_7d", "pacing")
async def rule_pacing_silent_7d(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    return await _silent_window(db, user, min_days=7, max_days=14,
                                rule_id="pacing_silent_7d", urgency="low",
                                action="email", phrase="沉默 7d，发轻 touch")


# 5. pacing_silent_14d
@register_rule("pacing_silent_14d", "pacing")
async def rule_pacing_silent_14d(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    return await _silent_window(db, user, min_days=14, max_days=30,
                                rule_id="pacing_silent_14d", urgency="medium",
                                action="email", phrase="沉默 14d，写 check-in")


# 6. pacing_silent_30d
@register_rule("pacing_silent_30d", "pacing")
async def rule_pacing_silent_30d(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    return await _silent_window(db, user, min_days=30, max_days=60,
                                rule_id="pacing_silent_30d", urgency="high",
                                action="email", phrase="沉默 30d，触发挽回")


# 7. pacing_silent_60d
@register_rule("pacing_silent_60d", "pacing")
async def rule_pacing_silent_60d(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    return await _silent_window(db, user, min_days=60, max_days=90,
                                rule_id="pacing_silent_60d", urgency="medium",
                                action="email", phrase="沉默 60d，break-up 邮件或归档")


# 8. pacing_silent_90d
@register_rule("pacing_silent_90d", "pacing")
async def rule_pacing_silent_90d(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    return await _silent_window(db, user, min_days=90, max_days=None,
                                rule_id="pacing_silent_90d", urgency="low",
                                action="review", phrase="沉默 > 90d，归档或激活")


# 9. pacing_quote_5d: lead at quote stage + last activity > 5d
# NOTE: spec lists statuses (price_negotiation, talking_potential_order) that
# don't yet exist in LeadStatus enum. Mapping to closest existing status:
# PROPOSAL. Will be revisited in Checkpoint 4 when B-rules expand the enum.
@register_rule("pacing_quote_5d", "pacing")
async def rule_pacing_quote_5d(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    return await _quote_window(db, user, min_days=5, urgency="high",
                               rule_id="pacing_quote_5d", action="call",
                               phrase="报价 5d 无音，打电话问反馈")


# 10. pacing_quote_10d
@register_rule("pacing_quote_10d", "pacing")
async def rule_pacing_quote_10d(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    return await _quote_window(db, user, min_days=10, urgency="medium",
                               rule_id="pacing_quote_10d", action="email",
                               phrase='报价 10d 无音，发 "still interested?"')


# 11. pacing_inbound_call_2h: last activity content has "inbound" keyword < 2h
@register_rule("pacing_inbound_call_2h", "pacing")
async def rule_pacing_inbound_call_2h(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    _ = user
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=2)
    latest = await _latest_activity_per_contact(db)
    out: list[TodoSuggestion] = []
    for cid, a in latest.items():
        text = (a.content or "").lower()
        if not any(kw.lower() in text for kw in INBOUND_KEYWORDS):
            continue
        if a.created_at < cutoff:  # too old (> 2h)
            continue
        out.append(_make(cid, "pacing_inbound_call_2h", "high", "call",
                         f"{cid} — 客户来电，立即回拨"))
    return await _decorate(db, out)


# 12. pacing_email_received_today: latest sent_email row is received today,
#     no sent email since then
@register_rule("pacing_email_received_today", "pacing")
async def rule_pacing_email_received_today(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    _ = user
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    sub = (
        select(
            SentEmail.contact_id.label("cid"),
            func.max(
                func.coalesce(SentEmail.received_at, SentEmail.sent_at, SentEmail.created_at)
            ).label("mx"),
        )
        .where(SentEmail.contact_id.isnot(None))
        .group_by(SentEmail.contact_id)
        .subquery()
    )
    q = (
        select(SentEmail)
        .join(
            sub,
            (SentEmail.contact_id == sub.c.cid)
            & (
                func.coalesce(SentEmail.received_at, SentEmail.sent_at, SentEmail.created_at)
                == sub.c.mx
            ),
        )
    )
    res = await db.execute(q)
    rows = res.scalars().all()

    out: list[TodoSuggestion] = []
    for e in rows:
        if e.direction != "received":
            continue
        when = e.received_at or e.sent_at or e.created_at
        if when is None or when < today_start:
            continue
        out.append(_make(e.contact_id, "pacing_email_received_today",
                         "high", "email",
                         f"{e.contact_id} — 当天收到邮件，今天回"))
    return await _decorate(db, out)


# --- Internal pacing helpers ---


def _make(
    contact_id: Optional[int],
    rule_id: str,
    urgency: Urgency,
    action: SuggestedAction,
    rationale_seed: str,
) -> TodoSuggestion:
    """Build a TodoSuggestion. `rationale_seed` is a temporary placeholder —
    `_decorate` later swaps the leading numeric contact_id for the real
    name + company once contacts are bulk-loaded."""
    return TodoSuggestion(
        rule_id=rule_id,
        urgency=urgency,
        category="pacing",
        suggested_action=action,
        rationale=rationale_seed,
        contact_id=contact_id,
    )


async def _decorate(
    db: AsyncSession, items: list[TodoSuggestion]
) -> list[TodoSuggestion]:
    """Replace leading 'cid — ' in rationale with the real contact label."""
    cids = {s.contact_id for s in items if s.contact_id is not None}
    contacts = await _contacts_by_id(db, cids)
    for s in items:
        if s.contact_id is None:
            continue
        c = contacts.get(s.contact_id)
        label = _contact_label(c)
        # Replace leading "<id> — " or "<id> —" with the real label
        prefix = f"{s.contact_id} —"
        if s.rationale.startswith(prefix):
            s.rationale = f"{label} —{s.rationale[len(prefix):]}"
    return items


async def _silent_window(
    db: AsyncSession,
    user: User,
    *,
    min_days: int,
    max_days: Optional[int],
    rule_id: str,
    urgency: Urgency,
    action: SuggestedAction,
    phrase: str,
) -> list[TodoSuggestion]:
    """Generic 'last activity is at least min_days ago, less than max_days ago'."""
    _ = user
    now = datetime.now(timezone.utc)
    min_cutoff = now - timedelta(days=min_days)  # latest must be older than this
    max_cutoff = now - timedelta(days=max_days) if max_days else None

    latest = await _latest_activity_per_contact(db)
    out: list[TodoSuggestion] = []
    for cid, a in latest.items():
        if a.created_at >= min_cutoff:
            continue  # too recent
        if max_cutoff is not None and a.created_at < max_cutoff:
            continue  # too old (caught by a higher window)
        out.append(_make(cid, rule_id, urgency, action, f"{cid} — {phrase}"))
    return await _decorate(db, out)


async def _quote_window(
    db: AsyncSession,
    user: User,
    *,
    min_days: int,
    urgency: Urgency,
    rule_id: str,
    action: SuggestedAction,
    phrase: str,
) -> list[TodoSuggestion]:
    """Find leads in 'quote' status whose last contact is >= min_days ago."""
    _ = user
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=min_days)

    quote_statuses = [LeadStatus.PROPOSAL]  # see CP2 NOTE on enum mapping

    leads_q = await db.execute(
        select(Lead).where(Lead.status.in_(quote_statuses))
    )
    leads = leads_q.scalars().all()
    if not leads:
        return []

    latest = await _latest_activity_per_contact(db)
    out: list[TodoSuggestion] = []
    for lead in leads:
        a = latest.get(lead.contact_id)
        last_contact = a.created_at if a else lead.created_at
        if last_contact >= cutoff:
            continue
        out.append(_make(lead.contact_id, rule_id, urgency, action,
                         f"{lead.contact_id} — {phrase}"))
    return await _decorate(db, out)


# --- D. Data health rules (6) ---


def _make_data(
    contact_id: int,
    rule_id: str,
    urgency: Urgency,
    action: SuggestedAction,
    rationale_seed: str,
) -> TodoSuggestion:
    """Like _make but emits category='data_health'."""
    return TodoSuggestion(
        rule_id=rule_id,
        urgency=urgency,
        category="data_health",
        suggested_action=action,
        rationale=rationale_seed,
        contact_id=contact_id,
    )


# 1. data_missing_phone: contact created > 7d ago, both phone fields null
@register_rule("data_missing_phone", "data_health")
async def rule_data_missing_phone(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    _ = user
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    res = await db.execute(
        select(Contact).where(
            Contact.created_at < cutoff,
            Contact.mobile_phone.is_(None),
            Contact.office_phone.is_(None),
        )
    )
    out = [
        _make_data(c.id, "data_missing_phone", "low", "review",
                   f"{c.id} — 缺手机号 + 办公室电话")
        for c in res.scalars().all()
    ]
    return await _decorate(db, out)


# 2. data_missing_linkedin
@register_rule("data_missing_linkedin", "data_health")
async def rule_data_missing_linkedin(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    _ = user
    res = await db.execute(
        select(Contact).where(Contact.linkedin_url.is_(None))
    )
    out = [
        _make_data(c.id, "data_missing_linkedin", "low", "review",
                   f"{c.id} — 缺 LinkedIn")
        for c in res.scalars().all()
    ]
    return await _decorate(db, out)


# 3. data_missing_industry: industry OR company_size missing
@register_rule("data_missing_industry", "data_health")
async def rule_data_missing_industry(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    from sqlalchemy import or_
    _ = user
    res = await db.execute(
        select(Contact).where(
            or_(Contact.industry.is_(None), Contact.company_size.is_(None))
        )
    )
    out = [
        _make_data(c.id, "data_missing_industry", "low", "review",
                   f"{c.id} — 缺行业 / 公司规模")
        for c in res.scalars().all()
    ]
    return await _decorate(db, out)


# 4. data_dead_contact_30d: created > 30d, zero activity records
@register_rule("data_dead_contact_30d", "data_health")
async def rule_data_dead_contact_30d(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    _ = user
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    # Subquery: contact_ids that DO have activity
    active_ids = (
        select(Activity.contact_id).distinct().subquery()
    )
    res = await db.execute(
        select(Contact).where(
            Contact.created_at < cutoff,
            Contact.id.notin_(select(active_ids.c.contact_id)),
        )
    )
    out = [
        _make_data(c.id, "data_dead_contact_30d", "medium", "review",
                   f"{c.id} — 创建 30d+ 还 0 条活动，判断是不是 dead")
        for c in res.scalars().all()
    ]
    return await _decorate(db, out)


# 5. data_lead_stuck_60d: lead.updated_at > 60d ago (regardless of status)
@register_rule("data_lead_stuck_60d", "data_health")
async def rule_data_lead_stuck_60d(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    _ = user
    cutoff = datetime.now(timezone.utc) - timedelta(days=60)
    res = await db.execute(
        select(Lead).where(
            Lead.updated_at < cutoff,
            Lead.status.notin_([LeadStatus.CLOSED_WON, LeadStatus.CLOSED_LOST]),
        )
    )
    out = [
        _make_data(lead.contact_id, "data_lead_stuck_60d", "medium", "review",
                   f"{lead.contact_id} — Lead 60d+ 没动，推进或归档")
        for lead in res.scalars().all()
    ]
    return await _decorate(db, out)


# 6. data_collision_7d: same contact has activity from ≥ 2 distinct owner_ids
#    in the last 7 days. Signals two SDRs working the same prospect.
@register_rule("data_collision_7d", "data_health")
async def rule_data_collision_7d(
    db: AsyncSession, user: User
) -> list[TodoSuggestion]:
    _ = user
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    res = await db.execute(
        select(
            Activity.contact_id,
            func.count(func.distinct(Activity.user_id)).label("uniq_owners"),
        )
        .where(Activity.created_at >= cutoff)
        .group_by(Activity.contact_id)
        .having(func.count(func.distinct(Activity.user_id)) >= 2)
    )
    rows = res.all()
    out = [
        _make_data(cid, "data_collision_7d", "high", "review",
                   f"{cid} — 7d 内多人触达，检查撞车")
        for cid, _n in rows
    ]
    return await _decorate(db, out)
