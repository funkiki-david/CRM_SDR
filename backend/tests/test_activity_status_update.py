"""
v1.3 § 11.5: tests for the optional lead_status_update field on
POST /api/activities and PATCH /api/activities/{id}.

These tests exercise the helper directly (`_maybe_update_lead_status`)
so we don't have to mount the FastAPI app — the helper IS the contract.
"""

from __future__ import annotations

import pytest

from app.api.routes.activities import _maybe_update_lead_status
from app.models.lead import LeadStatus


@pytest.mark.asyncio
async def test_create_activity_no_status_update(
    db_session, make_contact, make_lead
):
    """Passing None must leave lead.status unchanged."""
    c = await make_contact(first_name="NoUpdate")
    lead = await make_lead(c.id, status=LeadStatus.PROPOSAL)
    await _maybe_update_lead_status(db_session, c.id, None)
    await db_session.refresh(lead)
    assert lead.status == LeadStatus.PROPOSAL


@pytest.mark.asyncio
async def test_create_activity_with_status_update(
    db_session, make_contact, make_lead
):
    """Passing a valid status must overwrite lead.status."""
    c = await make_contact(first_name="WithUpdate")
    lead = await make_lead(c.id, status=LeadStatus.NEW)
    await _maybe_update_lead_status(db_session, c.id, "proposal")
    await db_session.refresh(lead)
    assert lead.status == LeadStatus.PROPOSAL


@pytest.mark.asyncio
async def test_create_activity_status_update_no_lead(
    db_session, make_contact
):
    """Contact has no lead — must silent-skip, not error."""
    c = await make_contact(first_name="LeadlessTest")
    # No lead is created. Helper should return cleanly.
    await _maybe_update_lead_status(db_session, c.id, "interested")
    # Asserting "no exception" is the contract; nothing to verify on DB.


@pytest.mark.asyncio
async def test_create_activity_status_update_multiple_leads(
    db_session, make_contact, make_lead
):
    """When a contact has multiple leads, only the most recently updated
    one gets the new status."""
    c = await make_contact(first_name="MultiLead")
    older = await make_lead(c.id, status=LeadStatus.NEW)
    # Force older.updated_at into the past so newer wins the order_by.
    from datetime import datetime, timedelta, timezone
    older.updated_at = datetime.now(timezone.utc) - timedelta(days=2)
    await db_session.flush()

    newer = await make_lead(c.id, status=LeadStatus.CONTACTED)

    await _maybe_update_lead_status(db_session, c.id, "interested")

    await db_session.refresh(older)
    await db_session.refresh(newer)
    assert newer.status == LeadStatus.INTERESTED
    assert older.status == LeadStatus.NEW  # untouched


@pytest.mark.asyncio
async def test_create_activity_downgrade_allowed(
    db_session, make_contact, make_lead
):
    """v1.3 § 11.2 decision 3: downgrades (e.g. PROPOSAL → INTERESTED) are
    allowed without warning."""
    c = await make_contact(first_name="Downgrader")
    lead = await make_lead(c.id, status=LeadStatus.PROPOSAL)
    await _maybe_update_lead_status(db_session, c.id, "interested")
    await db_session.refresh(lead)
    assert lead.status == LeadStatus.INTERESTED


@pytest.mark.asyncio
async def test_create_activity_invalid_status_raises(
    db_session, make_contact, make_lead
):
    """Invalid enum value should fail loudly with HTTP 400."""
    from fastapi import HTTPException

    c = await make_contact(first_name="BadStatus")
    await make_lead(c.id, status=LeadStatus.NEW)
    with pytest.raises(HTTPException) as exc_info:
        await _maybe_update_lead_status(db_session, c.id, "not_a_real_status")
    assert exc_info.value.status_code == 400
