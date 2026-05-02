"""
Pacing rule unit tests (Checkpoint 2).

Each of the 12 A-class rules has at least one positive (rule fires) and
one negative (rule does not fire) test. Tests run inside a transactional
session that is rolled back on teardown, so rows never leak into the dev
database.

We assert by checking whether the freshly-created test contact_id appears
in the rule's output — other contacts in the dev DB may also fire the
rule, but that's fine; we only care about the contact under test.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.models.activity import ActivityType
from app.models.lead import LeadStatus
from app.services.ai_todo_engine import (
    rule_pacing_call_no_answer_2d,
    rule_pacing_email_no_reply_3d,
    rule_pacing_email_received_today,
    rule_pacing_hot_48h,
    rule_pacing_inbound_call_2h,
    rule_pacing_quote_5d,
    rule_pacing_quote_10d,
    rule_pacing_silent_7d,
    rule_pacing_silent_14d,
    rule_pacing_silent_30d,
    rule_pacing_silent_60d,
    rule_pacing_silent_90d,
)
from tests.conftest import days_ago, hours_ago


# Helper: extract contact_ids from a rule output
def _ids(out):
    return {s.contact_id for s in out}


# ----------------------------------------------------- 1. pacing_hot_48h


@pytest.mark.asyncio
async def test_hot_48h_fires_for_recent_call(db_session, fake_user, make_contact, make_activity):
    c = await make_contact(first_name="Hot", company_name="Recent Inc")
    await make_activity(c.id, when=hours_ago(12), activity_type=ActivityType.CALL)
    out = await rule_pacing_hot_48h(db_session, fake_user)
    assert c.id in _ids(out)
    suggestion = next(s for s in out if s.contact_id == c.id)
    assert suggestion.urgency == "high"
    assert "Hot" in suggestion.rationale  # contact name appears in rationale


@pytest.mark.asyncio
async def test_hot_48h_no_fire_for_old_call(db_session, fake_user, make_contact, make_activity):
    c = await make_contact(first_name="Stale")
    await make_activity(c.id, when=days_ago(5), activity_type=ActivityType.CALL)
    out = await rule_pacing_hot_48h(db_session, fake_user)
    assert c.id not in _ids(out)


# ------------------------------------------------- 2. pacing_email_no_reply_3d


@pytest.mark.asyncio
async def test_email_no_reply_3d_fires(db_session, fake_user, make_contact, make_activity):
    c = await make_contact(first_name="Quiet")
    await make_activity(c.id, when=days_ago(5), activity_type=ActivityType.EMAIL)
    out = await rule_pacing_email_no_reply_3d(db_session, fake_user)
    assert c.id in _ids(out)


@pytest.mark.asyncio
async def test_email_no_reply_3d_skips_recent(db_session, fake_user, make_contact, make_activity):
    c = await make_contact(first_name="Fresh")
    await make_activity(c.id, when=days_ago(1), activity_type=ActivityType.EMAIL)
    out = await rule_pacing_email_no_reply_3d(db_session, fake_user)
    assert c.id not in _ids(out)


# ------------------------------------------------- 3. pacing_call_no_answer_2d


@pytest.mark.asyncio
async def test_no_answer_2d_fires_keyword_voicemail(
    db_session, fake_user, make_contact, make_activity
):
    c = await make_contact(first_name="VM")
    await make_activity(
        c.id, when=days_ago(3),
        activity_type=ActivityType.CALL,
        content="Left a voicemail asking to call back",
    )
    out = await rule_pacing_call_no_answer_2d(db_session, fake_user)
    assert c.id in _ids(out)


@pytest.mark.asyncio
async def test_no_answer_2d_no_fire_when_keyword_missing(
    db_session, fake_user, make_contact, make_activity
):
    c = await make_contact(first_name="Talked")
    await make_activity(
        c.id, when=days_ago(3),
        activity_type=ActivityType.CALL,
        content="Productive 30 min discussion about pricing",
    )
    out = await rule_pacing_call_no_answer_2d(db_session, fake_user)
    assert c.id not in _ids(out)


# ------------------------------------------------- 4-8. silent_Nd rules


SILENT_CASES = [
    (rule_pacing_silent_7d, 10, "low"),       # 10d in (7, 14)
    (rule_pacing_silent_14d, 20, "medium"),   # 20d in (14, 30)
    (rule_pacing_silent_30d, 40, "high"),     # 40d in (30, 60)
    (rule_pacing_silent_60d, 75, "medium"),   # 75d in (60, 90)
    (rule_pacing_silent_90d, 120, "low"),     # 120d > 90
]


@pytest.mark.asyncio
@pytest.mark.parametrize("rule_fn, days, expected_urgency", SILENT_CASES)
async def test_silent_window_positive(
    rule_fn, days, expected_urgency, db_session, fake_user, make_contact, make_activity
):
    c = await make_contact(first_name=f"Silent{days}")
    await make_activity(c.id, when=days_ago(days), activity_type=ActivityType.EMAIL)
    out = await rule_fn(db_session, fake_user)
    assert c.id in _ids(out)
    s = next(x for x in out if x.contact_id == c.id)
    assert s.urgency == expected_urgency


@pytest.mark.asyncio
async def test_silent_30d_skips_too_recent(db_session, fake_user, make_contact, make_activity):
    c = await make_contact(first_name="TooFresh")
    await make_activity(c.id, when=days_ago(20), activity_type=ActivityType.EMAIL)
    out = await rule_pacing_silent_30d(db_session, fake_user)
    assert c.id not in _ids(out)  # 20d falls in silent_14d window, not silent_30d


@pytest.mark.asyncio
async def test_silent_30d_skips_too_old(db_session, fake_user, make_contact, make_activity):
    c = await make_contact(first_name="WayOld")
    await make_activity(c.id, when=days_ago(80), activity_type=ActivityType.EMAIL)
    out = await rule_pacing_silent_30d(db_session, fake_user)
    assert c.id not in _ids(out)  # 80d falls in silent_60d window


@pytest.mark.asyncio
async def test_silent_90d_open_ended(db_session, fake_user, make_contact, make_activity):
    """silent_90d has no upper bound — fires for any activity older than 90d."""
    c = await make_contact(first_name="Ancient")
    await make_activity(c.id, when=days_ago(365), activity_type=ActivityType.EMAIL)
    out = await rule_pacing_silent_90d(db_session, fake_user)
    assert c.id in _ids(out)


# Negative cases for silent_7d / 14d / 60d (silent_30d already has two
# above; silent_90d covered by the "skip newer" parametrize below).
NEG_CASES = [
    (rule_pacing_silent_7d, 3),    # 3d is too recent for the 7d window
    (rule_pacing_silent_14d, 5),   # 5d is too recent for the 14d window
    (rule_pacing_silent_60d, 30),  # 30d falls in silent_30d window, not 60d
    (rule_pacing_silent_90d, 60),  # 60d falls in silent_60d window, not 90d
]


@pytest.mark.asyncio
@pytest.mark.parametrize("rule_fn, days", NEG_CASES)
async def test_silent_window_negative(
    rule_fn, days, db_session, fake_user, make_contact, make_activity
):
    c = await make_contact(first_name=f"Out{days}")
    await make_activity(c.id, when=days_ago(days), activity_type=ActivityType.EMAIL)
    out = await rule_fn(db_session, fake_user)
    assert c.id not in _ids(out)


# ------------------------------------------------- 9-10. pacing_quote_5d/10d


@pytest.mark.asyncio
async def test_quote_5d_fires_for_proposal_lead(
    db_session, fake_user, make_contact, make_activity, make_lead
):
    c = await make_contact(first_name="Quoted")
    await make_lead(c.id, status=LeadStatus.PROPOSAL)
    await make_activity(c.id, when=days_ago(7), activity_type=ActivityType.EMAIL)
    out = await rule_pacing_quote_5d(db_session, fake_user)
    assert c.id in _ids(out)


@pytest.mark.asyncio
async def test_quote_5d_no_fire_for_non_proposal(
    db_session, fake_user, make_contact, make_activity, make_lead
):
    c = await make_contact(first_name="EarlyStage")
    await make_lead(c.id, status=LeadStatus.NEW)  # not a quote stage
    await make_activity(c.id, when=days_ago(20), activity_type=ActivityType.EMAIL)
    out = await rule_pacing_quote_5d(db_session, fake_user)
    assert c.id not in _ids(out)


@pytest.mark.asyncio
async def test_quote_10d_skips_5d_window(
    db_session, fake_user, make_contact, make_activity, make_lead
):
    """A lead with last activity 7d ago should fire pacing_quote_5d, but
    pacing_quote_10d still fires only for last activity >= 10d."""
    c = await make_contact(first_name="MidQuote")
    await make_lead(c.id, status=LeadStatus.PROPOSAL)
    await make_activity(c.id, when=days_ago(7), activity_type=ActivityType.EMAIL)
    out = await rule_pacing_quote_10d(db_session, fake_user)
    assert c.id not in _ids(out)


@pytest.mark.asyncio
async def test_quote_10d_fires_for_old_quote(
    db_session, fake_user, make_contact, make_activity, make_lead
):
    c = await make_contact(first_name="OldQuote")
    await make_lead(c.id, status=LeadStatus.PROPOSAL)
    await make_activity(c.id, when=days_ago(15), activity_type=ActivityType.EMAIL)
    out = await rule_pacing_quote_10d(db_session, fake_user)
    assert c.id in _ids(out)


# ------------------------------------------------- 11. pacing_inbound_call_2h


@pytest.mark.asyncio
async def test_inbound_call_2h_fires(db_session, fake_user, make_contact, make_activity):
    c = await make_contact(first_name="Inbound")
    await make_activity(
        c.id, when=hours_ago(1),
        activity_type=ActivityType.NOTE,
        content="Customer called in asking about lead times",
    )
    out = await rule_pacing_inbound_call_2h(db_session, fake_user)
    assert c.id in _ids(out)


@pytest.mark.asyncio
async def test_inbound_call_2h_skips_too_old(
    db_session, fake_user, make_contact, make_activity
):
    c = await make_contact(first_name="OldInbound")
    await make_activity(
        c.id, when=hours_ago(5),  # > 2h, too old
        activity_type=ActivityType.NOTE,
        content="客户来电询问报价",
    )
    out = await rule_pacing_inbound_call_2h(db_session, fake_user)
    assert c.id not in _ids(out)


# ------------------------------------------------- 12. pacing_email_received_today


@pytest.mark.asyncio
async def test_email_received_today_fires(
    db_session, fake_user, make_contact, make_sent_email
):
    c = await make_contact(first_name="ReplyToday")
    await make_sent_email(
        c.id, direction="received", when=datetime.now(timezone.utc),
    )
    out = await rule_pacing_email_received_today(db_session, fake_user)
    assert c.id in _ids(out)


@pytest.mark.asyncio
async def test_email_received_today_skips_yesterday(
    db_session, fake_user, make_contact, make_sent_email
):
    c = await make_contact(first_name="YesterdayReply")
    await make_sent_email(
        c.id, direction="received", when=days_ago(1),
    )
    out = await rule_pacing_email_received_today(db_session, fake_user)
    assert c.id not in _ids(out)


@pytest.mark.asyncio
async def test_email_received_today_skips_when_replied(
    db_session, fake_user, make_contact, make_sent_email
):
    """If the latest row for this contact is direction='sent' (i.e. we
    already replied today), the rule must not fire."""
    c = await make_contact(first_name="AlreadyReplied")
    now = datetime.now(timezone.utc)
    # Received earlier today
    await make_sent_email(c.id, direction="received", when=now.replace(hour=8))
    # We replied later today
    await make_sent_email(c.id, direction="sent", when=now.replace(hour=14))
    out = await rule_pacing_email_received_today(db_session, fake_user)
    assert c.id not in _ids(out)
