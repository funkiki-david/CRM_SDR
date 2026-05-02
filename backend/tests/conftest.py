"""
Pytest fixtures for the AI to-do engine tests.

Two flavors of fixtures live here:

1. **Pure unit-test fixtures** (`mock_db`, `fake_user`) — used by
   `test_ai_todo_engine.py` for the engine plumbing tests. No real DB.

2. **Transactional Postgres fixtures** (`db_session`, `seed_user_id`) — used
   by `test_ai_todo_rules_pacing.py` and friends. Each test runs inside an
   outer transaction that is rolled back on teardown, so test rows never
   persist to the dev database.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import AsyncIterator
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from dotenv import load_dotenv
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# Load backend/.env so DATABASE_URL is available when pytest is invoked
# directly (without `source .venv/bin/activate` which doesn't read .env).
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


# ---------------------------------------------------------------- unit-test


@pytest.fixture
def mock_db() -> AsyncMock:
    """Pure mock — engine code never touches real Postgres in these tests."""
    return AsyncMock()


@pytest.fixture
def fake_user() -> SimpleNamespace:
    """Minimal user stand-in. The engine only reads `.id`."""
    return SimpleNamespace(id=1, email="t@t.com", role="manager")


# ---------------------------------------------------------------- DB-bound


def _resolve_test_database_url() -> str:
    """Pick the test database URL.

    Preference order:
      1. TEST_DATABASE_URL env var (explicit override)
      2. DATABASE_URL env var (dev DB; safe because we wrap in a rolled-back
         outer transaction so nothing persists)
    """
    return os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL", "")


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncIterator[AsyncSession]:
    """Yield a session bound to a single connection wrapped in an outer
    transaction. On teardown the outer transaction is rolled back, so any
    rows the test inserted vanish.

    Inside the session, callers can `await session.flush()` and even
    `await session.commit()` — both behave like SAVEPOINTs because of
    `join_transaction_mode="create_savepoint"`.
    """
    url = _resolve_test_database_url()
    if not url:
        pytest.skip(
            "DATABASE_URL not set — DB-bound tests need a Postgres connection"
        )

    engine = create_async_engine(url, future=True)
    async with engine.connect() as conn:
        outer = await conn.begin()
        sm = async_sessionmaker(
            bind=conn,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        async with sm() as session:
            try:
                yield session
            finally:
                await session.close()
        await outer.rollback()
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def seed_user_id(db_session: AsyncSession) -> int:
    """Return the id of the first admin in the dev DB. The rule code only
    uses user.id, so we don't need a fresh user per test."""
    from app.models.user import User, UserRole

    res = await db_session.execute(
        select(User).where(User.role == UserRole.ADMIN).limit(1)
    )
    admin = res.scalar_one_or_none()
    if admin is None:
        pytest.skip("No admin user in DB — pacing rule tests need a user_id")
    return admin.id


# ---------------------------------------------------------------- factories


@pytest_asyncio.fixture
async def make_contact(db_session: AsyncSession, seed_user_id: int):
    """Factory producing a Contact row inside the test transaction.

    Usage:
        c = await make_contact(first_name="Alice", company_name="Acme")
    """
    from app.models.contact import Contact

    counter = {"i": 0}

    async def _make(**overrides):
        counter["i"] += 1
        defaults = {
            "first_name": f"Test{counter['i']}",
            "last_name": "Contact",
            "email": f"cp2-test-{datetime.utcnow().timestamp()}-{counter['i']}@test.local",
            "company_name": "Test Co",
            "owner_id": seed_user_id,
        }
        defaults.update(overrides)
        c = Contact(**defaults)
        db_session.add(c)
        await db_session.flush()
        return c

    return _make


@pytest_asyncio.fixture
async def make_activity(db_session: AsyncSession, seed_user_id: int):
    """Factory producing an Activity row, with `when` controlling created_at."""
    from app.models.activity import Activity, ActivityType

    async def _make(
        contact_id: int,
        when: datetime,
        activity_type: ActivityType = ActivityType.EMAIL,
        content: str = "",
        subject: str = "",
    ):
        a = Activity(
            contact_id=contact_id,
            user_id=seed_user_id,
            activity_type=activity_type,
            subject=subject or None,
            content=content or None,
            created_at=when,
        )
        db_session.add(a)
        await db_session.flush()
        return a

    return _make


@pytest_asyncio.fixture
async def make_lead(db_session: AsyncSession, seed_user_id: int):
    """Factory producing a Lead row."""
    from app.models.lead import Lead, LeadStatus

    async def _make(contact_id: int, status: LeadStatus = LeadStatus.NEW):
        lead = Lead(
            contact_id=contact_id,
            owner_id=seed_user_id,
            status=status,
        )
        db_session.add(lead)
        await db_session.flush()
        return lead

    return _make


@pytest_asyncio.fixture
async def make_sent_email(db_session: AsyncSession, seed_user_id: int):
    """Factory producing a sent_emails row (direction='sent' or 'received')."""
    from app.models.sent_email import EmailStatus, SentEmail

    counter = {"i": 0}

    async def _make(
        contact_id: int,
        direction: str = "sent",
        when: datetime | None = None,
        from_email: str = "from@test.local",
        to_email: str = "to@test.local",
        subject: str = "Test",
        body: str = "Test body",
    ):
        counter["i"] += 1
        when = when or datetime.now(timezone.utc)
        e = SentEmail(
            contact_id=contact_id,
            user_id=seed_user_id,
            direction=direction,
            from_email=from_email,
            to_email=to_email,
            subject=subject,
            body=body,
            status=EmailStatus.SENT,
            sent_at=when if direction == "sent" else None,
            received_at=when if direction == "received" else None,
        )
        db_session.add(e)
        await db_session.flush()
        return e

    return _make


# ---------------------------------------------------------------- helpers


def days_ago(n: int) -> datetime:
    """Datetime n days before now (UTC)."""
    return datetime.now(timezone.utc) - timedelta(days=n)


def hours_ago(n: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=n)
