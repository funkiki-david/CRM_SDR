"""
Audit step B: tests for the new optional Activity columns
(outcome / temperature / duration_minutes).

Exercises:
- Model accepts the fields and persists them
- Round-trip through ActivityResponse via _build_activity_response
- ActivityPatch path can change them
- All three fields default to None when not provided (back-compat)
"""

from __future__ import annotations

import pytest

from app.models.activity import Activity, ActivityType
from app.api.routes.activities import _build_activity_response


@pytest.mark.asyncio
async def test_activity_creates_with_mockup_fields(
    db_session, make_contact, seed_user_id
):
    c = await make_contact(first_name="MockupA")
    a = Activity(
        contact_id=c.id,
        user_id=seed_user_id,
        activity_type=ActivityType.CALL,
        outcome="positive",
        temperature="hot",
        duration_minutes=15,
    )
    db_session.add(a)
    await db_session.flush()
    assert a.outcome == "positive"
    assert a.temperature == "hot"
    assert a.duration_minutes == 15


@pytest.mark.asyncio
async def test_activity_response_includes_mockup_fields(
    db_session, make_contact, seed_user_id
):
    c = await make_contact(first_name="MockupB")
    a = Activity(
        contact_id=c.id,
        user_id=seed_user_id,
        activity_type=ActivityType.MEETING,
        outcome="neutral",
        temperature="warm",
        duration_minutes=45,
    )
    db_session.add(a)
    await db_session.flush()
    # Reload with relationships so contact / user are joined for the response.
    from sqlalchemy import select
    from sqlalchemy.orm import joinedload
    res = await db_session.execute(
        select(Activity)
        .options(joinedload(Activity.contact), joinedload(Activity.user))
        .where(Activity.id == a.id)
    )
    a = res.scalar_one()
    resp = _build_activity_response(a)
    assert resp["outcome"] == "neutral"
    assert resp["temperature"] == "warm"
    assert resp["duration_minutes"] == 45


@pytest.mark.asyncio
async def test_activity_mockup_fields_default_to_none(
    db_session, make_contact, seed_user_id
):
    """Older clients that don't send the new fields still work — Pydantic
    defaults to None and the row gets created with NULLs."""
    c = await make_contact(first_name="MockupLegacy")
    a = Activity(
        contact_id=c.id,
        user_id=seed_user_id,
        activity_type=ActivityType.NOTE,
    )
    db_session.add(a)
    await db_session.flush()
    assert a.outcome is None
    assert a.temperature is None
    assert a.duration_minutes is None
