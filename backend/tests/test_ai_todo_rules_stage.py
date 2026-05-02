"""
Stage-rule tests (Checkpoint 4-B — § 3.B, 6 rules × 2 = 12).

All 6 rules share the same shape:
  "lead.status = X AND latest activity on the contact older than N days"

so the bulk of the tests parametrize over the (rule_fn, status, days, urgency)
tuple. Each rule still gets a positive (fires) and a negative (skips) case.

Reuses the transactional Postgres fixtures from conftest.py.
"""

from __future__ import annotations

import pytest

from app.models.activity import ActivityType
from app.models.lead import LeadStatus
from app.services.ai_todo_engine import (
    rule_stage_contacted_stuck_5d,
    rule_stage_interested_stuck_14d,
    rule_stage_meeting_set_stuck_7d,
    rule_stage_new_stuck_7d,
    rule_stage_proposal_stuck_5d,
    rule_stage_won_repurchase_90d,
)
from tests.conftest import days_ago


def _ids(out):
    return {s.contact_id for s in out}


# (rule_fn, target_status, min_days, expected_urgency)
STAGE_RULES = [
    (rule_stage_new_stuck_7d,         LeadStatus.NEW,         7,  "medium"),
    (rule_stage_contacted_stuck_5d,   LeadStatus.CONTACTED,   5,  "medium"),
    (rule_stage_interested_stuck_14d, LeadStatus.INTERESTED,  14, "high"),
    (rule_stage_meeting_set_stuck_7d, LeadStatus.MEETING_SET, 7,  "high"),
    (rule_stage_proposal_stuck_5d,    LeadStatus.PROPOSAL,    5,  "high"),
    (rule_stage_won_repurchase_90d,   LeadStatus.CLOSED_WON,  90, "medium"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("rule_fn, status, min_days, expected_urgency", STAGE_RULES)
async def test_stage_rule_fires_when_stuck(
    rule_fn, status, min_days, expected_urgency,
    db_session, fake_user, make_contact, make_activity, make_lead,
):
    """Lead is in target status AND last activity exceeds min_days → fires."""
    c = await make_contact(first_name=f"Stuck{status.value}")
    await make_lead(c.id, status=status)
    await make_activity(
        c.id,
        when=days_ago(min_days + 2),
        activity_type=ActivityType.EMAIL,
    )
    out = await rule_fn(db_session, fake_user)
    assert c.id in _ids(out)
    s = next(x for x in out if x.contact_id == c.id)
    assert s.urgency == expected_urgency
    assert s.category == "stage"


@pytest.mark.asyncio
@pytest.mark.parametrize("rule_fn, status, min_days, expected_urgency", STAGE_RULES)
async def test_stage_rule_skips_when_recent(
    rule_fn, status, min_days, expected_urgency,
    db_session, fake_user, make_contact, make_activity, make_lead,
):
    """Lead in target status BUT last activity is fresh → must not fire."""
    _ = expected_urgency
    c = await make_contact(first_name=f"Fresh{status.value}")
    await make_lead(c.id, status=status)
    # Last activity well within the threshold (1 day ago, or half min_days
    # for the 90d case where 1d still counts as 'recent').
    fresh_days = max(1, min_days // 2)
    await make_activity(
        c.id,
        when=days_ago(fresh_days - 1 if fresh_days > 1 else 0),
        activity_type=ActivityType.EMAIL,
    )
    out = await rule_fn(db_session, fake_user)
    assert c.id not in _ids(out)


@pytest.mark.asyncio
async def test_stage_proposal_skips_other_statuses(
    db_session, fake_user, make_contact, make_activity, make_lead,
):
    """Sanity: a lead in NEW (not PROPOSAL) must NOT fire stage_proposal_stuck_5d."""
    c = await make_contact(first_name="Wrong status")
    await make_lead(c.id, status=LeadStatus.NEW)
    await make_activity(c.id, when=days_ago(20), activity_type=ActivityType.EMAIL)
    out = await rule_stage_proposal_stuck_5d(db_session, fake_user)
    assert c.id not in _ids(out)


@pytest.mark.asyncio
async def test_stage_won_repurchase_skips_recent_won(
    db_session, fake_user, make_contact, make_activity, make_lead,
):
    """Just-closed lead (last activity 30d ago) shouldn't trigger 90-day
    repurchase rule yet."""
    c = await make_contact(first_name="JustWon")
    await make_lead(c.id, status=LeadStatus.CLOSED_WON)
    await make_activity(c.id, when=days_ago(30), activity_type=ActivityType.EMAIL)
    out = await rule_stage_won_repurchase_90d(db_session, fake_user)
    assert c.id not in _ids(out)
