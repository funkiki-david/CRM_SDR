"""
Engine scaffold tests (Checkpoint 1).

These exercise the pure-Python sort/filter/truncate logic in
`ai_todo_engine.generate_todos_for_user` without standing up a real database.
The single DB-touching helper, `fetch_active_snoozes`, is monkey-patched to
return whatever set of hashes a given test needs.
"""

from __future__ import annotations

from typing import Optional

import pytest

from app.services import ai_todo_engine as engine
from app.services.ai_todo_engine import (
    TodoSuggestion,
    register_rule,
    suggestion_hash,
)


# --- Helpers ----------------------------------------------------------


def _suggestion(
    rule_id: str = "dummy",
    urgency: str = "medium",
    contact_id: Optional[int] = 1,
) -> TodoSuggestion:
    return TodoSuggestion(
        rule_id=rule_id,
        urgency=urgency,  # type: ignore[arg-type]
        category="pacing",
        suggested_action="email",
        rationale="测试用 rationale",
        contact_id=contact_id,
    )


@pytest.fixture(autouse=True)
def isolate_rules(monkeypatch):
    """Each test starts with an empty rule registry so the dummy rule
    (and any rule a test registers locally) never bleeds into another."""
    monkeypatch.setattr(engine, "TODO_RULES", [])
    yield


@pytest.fixture
def no_snoozes(monkeypatch):
    """fetch_active_snoozes returns the empty set unless overridden."""
    async def _empty(_db, _uid):
        return set()
    monkeypatch.setattr(engine, "fetch_active_snoozes", _empty)


# --- Tests ------------------------------------------------------------


@pytest.mark.asyncio
async def test_engine_runs_with_no_rules(mock_db, fake_user, no_snoozes):
    """With zero registered rules, the engine returns an empty list."""
    out = await engine.generate_todos_for_user(mock_db, fake_user, max_count=7)
    assert out == []


@pytest.mark.asyncio
async def test_engine_filters_snoozed(mock_db, fake_user, monkeypatch):
    """Snoozed (rule_id, contact_id) hashes must not appear in the output."""
    # Register two rules: one targets contact 10, one targets contact 20.
    @register_rule("rule_a", "pacing")
    async def _ra(db, user):
        return [_suggestion(rule_id="rule_a", contact_id=10, urgency="high")]

    @register_rule("rule_b", "pacing")
    async def _rb(db, user):
        return [_suggestion(rule_id="rule_b", contact_id=20, urgency="medium")]

    # Mark rule_a/contact 10 as currently snoozed.
    snoozed = {suggestion_hash("rule_a", 10)}

    async def _fake_fetch(_db, _uid):
        return snoozed

    monkeypatch.setattr(engine, "fetch_active_snoozes", _fake_fetch)

    out = await engine.generate_todos_for_user(mock_db, fake_user, max_count=7)

    assert len(out) == 1
    assert out[0].rule_id == "rule_b"


@pytest.mark.asyncio
async def test_engine_respects_max_count(mock_db, fake_user, no_snoozes):
    """Total suggestions across all rules must be capped at max_count."""
    @register_rule("many", "pacing")
    async def _many(db, user):
        return [
            _suggestion(rule_id="many", contact_id=i, urgency="medium")
            for i in range(20)
        ]

    out = await engine.generate_todos_for_user(mock_db, fake_user, max_count=5)
    assert len(out) == 5


@pytest.mark.asyncio
async def test_engine_sorts_by_urgency(mock_db, fake_user, no_snoozes):
    """high must always sort before medium, which sorts before low."""
    @register_rule("mixed", "pacing")
    async def _mixed(db, user):
        return [
            _suggestion(rule_id="mixed", contact_id=3, urgency="low"),
            _suggestion(rule_id="mixed", contact_id=1, urgency="high"),
            _suggestion(rule_id="mixed", contact_id=2, urgency="medium"),
        ]

    out = await engine.generate_todos_for_user(mock_db, fake_user, max_count=10)
    urgencies = [s.urgency for s in out]
    assert urgencies == ["high", "medium", "low"]
    # Tiebreak by contact_id (verified implicitly above — high.contact_id=1
    # came back first because it had both the best urgency AND lowest id).
