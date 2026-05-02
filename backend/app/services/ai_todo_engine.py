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
from datetime import datetime, timezone
from typing import Awaitable, Callable, Literal, Optional

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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


# --- Dummy rule (Checkpoint 1 only — verifies registration + invocation) ---


@register_rule("dummy_test_rule", "pacing")
async def rule_dummy(db: AsyncSession, user: User) -> list[TodoSuggestion]:
    """Always returns no suggestions. Will be deleted in Checkpoint 2."""
    _ = db, user
    return []
