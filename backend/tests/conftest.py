"""
Pytest fixtures for the AI to-do engine.

We deliberately do NOT spin up a real Postgres for these unit tests — the
engine's behaviour under test is sort/filter/truncate logic, not SQLAlchemy
integration. We pass an `unittest.mock.AsyncMock` session and monkey-patch
`fetch_active_snoozes` when a test needs to simulate snoozed entries.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


@pytest.fixture
def mock_db() -> AsyncMock:
    """A stand-in AsyncSession. Engine code never touches it directly because
    the only DB call (`fetch_active_snoozes`) is monkey-patched in tests that
    need it."""
    return AsyncMock()


@pytest.fixture
def fake_user() -> SimpleNamespace:
    """Minimal User stand-in — engine only reads `.id`."""
    return SimpleNamespace(id=1, email="t@t.com", role="manager")
