"""
Data-health rule tests (Checkpoint 4 — D class, 6 rules × 2 tests = 12).

Same harness as test_ai_todo_rules_pacing.py: each test creates fresh
fixtures inside a transactional session that's rolled back at teardown.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models.activity import ActivityType
from app.models.lead import LeadStatus
from app.services.ai_todo_engine import (
    rule_data_collision_7d,
    rule_data_dead_contact_30d,
    rule_data_lead_stuck_60d,
    rule_data_missing_industry,
    rule_data_missing_linkedin,
    rule_data_missing_phone,
)
from tests.conftest import days_ago


def _ids(out):
    return {s.contact_id for s in out}


# ----------------------------------------------- 1. data_missing_phone


@pytest.mark.asyncio
async def test_missing_phone_fires_for_old_contact_no_phones(
    db_session, fake_user, make_contact
):
    """Contact created > 7d ago with both phone fields blank → fires."""
    c = await make_contact(
        first_name="NoPhone",
        mobile_phone=None,
        office_phone=None,
        created_at=days_ago(10),
    )
    out = await rule_data_missing_phone(db_session, fake_user)
    assert c.id in _ids(out)


@pytest.mark.asyncio
async def test_missing_phone_skips_recent_contact(
    db_session, fake_user, make_contact
):
    """Contact created within last 7d is still 'fresh' — don't nag yet."""
    c = await make_contact(
        first_name="FreshNoPhone",
        mobile_phone=None,
        office_phone=None,
        created_at=days_ago(2),
    )
    out = await rule_data_missing_phone(db_session, fake_user)
    assert c.id not in _ids(out)


@pytest.mark.asyncio
async def test_missing_phone_skips_when_one_phone_present(
    db_session, fake_user, make_contact
):
    """If either phone is present, the rule must NOT fire — having one is
    enough."""
    c = await make_contact(
        first_name="HasMobile",
        mobile_phone="+1-555-0100",
        office_phone=None,
        created_at=days_ago(20),
    )
    out = await rule_data_missing_phone(db_session, fake_user)
    assert c.id not in _ids(out)


# --------------------------------------------- 2. data_missing_linkedin


@pytest.mark.asyncio
async def test_missing_linkedin_fires(db_session, fake_user, make_contact):
    c = await make_contact(first_name="NoLI", linkedin_url=None)
    out = await rule_data_missing_linkedin(db_session, fake_user)
    assert c.id in _ids(out)


@pytest.mark.asyncio
async def test_missing_linkedin_skips_when_present(
    db_session, fake_user, make_contact
):
    c = await make_contact(
        first_name="HasLI",
        linkedin_url="https://www.linkedin.com/in/example",
    )
    out = await rule_data_missing_linkedin(db_session, fake_user)
    assert c.id not in _ids(out)


# --------------------------------------------- 3. data_missing_industry


@pytest.mark.asyncio
async def test_missing_industry_fires_when_industry_null(
    db_session, fake_user, make_contact
):
    c = await make_contact(first_name="NoIndustry", industry=None,
                           company_size="11-50")
    out = await rule_data_missing_industry(db_session, fake_user)
    assert c.id in _ids(out)


@pytest.mark.asyncio
async def test_missing_industry_skips_when_both_present(
    db_session, fake_user, make_contact
):
    c = await make_contact(
        first_name="FullData",
        industry="Manufacturing",
        company_size="51-200",
    )
    out = await rule_data_missing_industry(db_session, fake_user)
    assert c.id not in _ids(out)


# --------------------------------------------- 4. data_dead_contact_30d


@pytest.mark.asyncio
async def test_dead_contact_30d_fires(db_session, fake_user, make_contact):
    """Contact created > 30d ago with NO activities → 'dead' candidate."""
    c = await make_contact(first_name="Dead", created_at=days_ago(45))
    out = await rule_data_dead_contact_30d(db_session, fake_user)
    assert c.id in _ids(out)


@pytest.mark.asyncio
async def test_dead_contact_30d_skips_with_activity(
    db_session, fake_user, make_contact, make_activity
):
    """Old contact, but at least one activity exists → not 'dead'."""
    c = await make_contact(first_name="Active", created_at=days_ago(60))
    await make_activity(c.id, when=days_ago(10),
                        activity_type=ActivityType.EMAIL)
    out = await rule_data_dead_contact_30d(db_session, fake_user)
    assert c.id not in _ids(out)


# --------------------------------------------- 5. data_lead_stuck_60d


@pytest.mark.asyncio
async def test_lead_stuck_60d_fires(
    db_session, fake_user, make_contact, make_lead
):
    c = await make_contact(first_name="StuckLead")
    lead = await make_lead(c.id, status=LeadStatus.CONTACTED)
    # Force updated_at into the past — make_lead uses default=now()
    lead.updated_at = datetime.now(timezone.utc) - timedelta(days=70)
    await db_session.flush()
    out = await rule_data_lead_stuck_60d(db_session, fake_user)
    assert c.id in _ids(out)


@pytest.mark.asyncio
async def test_lead_stuck_60d_skips_recent_update(
    db_session, fake_user, make_contact, make_lead
):
    c = await make_contact(first_name="FreshLead")
    await make_lead(c.id, status=LeadStatus.CONTACTED)  # updated_at = now
    out = await rule_data_lead_stuck_60d(db_session, fake_user)
    assert c.id not in _ids(out)


@pytest.mark.asyncio
async def test_lead_stuck_60d_skips_closed_status(
    db_session, fake_user, make_contact, make_lead
):
    """Closed leads (won/lost) shouldn't trigger 'stuck' — they're done."""
    c = await make_contact(first_name="Won")
    lead = await make_lead(c.id, status=LeadStatus.CLOSED_WON)
    lead.updated_at = datetime.now(timezone.utc) - timedelta(days=120)
    await db_session.flush()
    out = await rule_data_lead_stuck_60d(db_session, fake_user)
    assert c.id not in _ids(out)


# --------------------------------------------- 6. data_collision_7d


@pytest.mark.asyncio
async def test_collision_7d_fires_with_two_owners(
    db_session, fake_user, make_contact, seed_user_id
):
    """Same contact gets activities from two distinct user_ids in 7d."""
    from app.models.activity import Activity
    from app.models.user import User
    from sqlalchemy import select

    # Need a second user for the collision
    res = await db_session.execute(select(User).limit(2))
    users = res.scalars().all()
    if len(users) < 2:
        pytest.skip("Need ≥ 2 users in DB for collision test")
    u1, u2 = users[0], users[1]

    c = await make_contact(first_name="Collide")
    # Owner u1's activity
    db_session.add(Activity(
        contact_id=c.id, user_id=u1.id,
        activity_type=ActivityType.CALL,
        created_at=days_ago(2),
    ))
    # Owner u2's activity
    db_session.add(Activity(
        contact_id=c.id, user_id=u2.id,
        activity_type=ActivityType.EMAIL,
        created_at=days_ago(1),
    ))
    await db_session.flush()

    out = await rule_data_collision_7d(db_session, fake_user)
    assert c.id in _ids(out)


@pytest.mark.asyncio
async def test_collision_7d_skips_single_owner(
    db_session, fake_user, make_contact, make_activity
):
    """One owner, multiple touches → not a collision."""
    c = await make_contact(first_name="Solo")
    await make_activity(c.id, when=days_ago(2),
                        activity_type=ActivityType.CALL)
    await make_activity(c.id, when=days_ago(1),
                        activity_type=ActivityType.EMAIL)
    out = await rule_data_collision_7d(db_session, fake_user)
    assert c.id not in _ids(out)
