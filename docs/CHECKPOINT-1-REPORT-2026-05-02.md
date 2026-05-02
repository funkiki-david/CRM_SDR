# Checkpoint 1 Report — Engine Scaffold

**Date**: 2026-05-02
**Spec ref**: `docs/AI-TODO-SPEC-2026-05-02.md` § 2, § 5
**Plan ref**: `docs/CLAUDE-CODE-EXECUTION-PLAN-2026-05-02.md` (Checkpoint 1)
**Commit**: `<filled in after push>`

## What shipped

- `backend/app/services/ai_todo_engine.py` (new, ~140 lines)
  - `TodoSuggestion` Pydantic model — fields per spec § 2: `rule_id` / `urgency` / `category` / `suggested_action` / `rationale` / `contact_id`
  - `register_rule(rule_id, category)` decorator → appends to `TODO_RULES`
  - `suggestion_hash(rule_id, contact_id)` → `sha256(...)[:32]` per spec § 5.3
  - `fetch_active_snoozes(db, user_id)` → set of snoozed hashes whose `snooze_until > NOW()`
  - `generate_todos_for_user(db, user, max_count=7)` → fans out rules, filters snoozed, sorts (high < medium < low, tiebreak contact_id), truncates
  - One dummy rule `rule_dummy` registered as `dummy_test_rule / pacing` returning `[]` — to be removed in Checkpoint 2
- `backend/tests/__init__.py` + `backend/tests/conftest.py` + `backend/tests/test_ai_todo_engine.py`
  - 4 tests, all green
  - `mock_db` fixture (AsyncMock — no real Postgres needed)
  - `fake_user` fixture
  - `isolate_rules` autouse fixture clears `TODO_RULES` so tests don't leak into each other
- `backend/pytest.ini` — `pythonpath = .` + `asyncio_mode = auto`
- `backend/requirements.txt` — added `pytest>=8.0`, `pytest-asyncio>=1.0`

## What did NOT change

- `/api/ai/suggest-todos` endpoint untouched (still old Claude-driven implementation)
- No frontend changes
- No DB schema changes (`ai_suggestion_snoozes` table already existed from Apr 24's batch)
- No new tables

## Test output

```
============================= test session starts ==============================
platform darwin -- Python 3.9.6, pytest-8.4.2, pluggy-1.6.0
configfile: pytest.ini
plugins: anyio-4.12.1, asyncio-1.2.0
asyncio: mode=auto

tests/test_ai_todo_engine.py::test_engine_runs_with_no_rules PASSED      [ 25%]
tests/test_ai_todo_engine.py::test_engine_filters_snoozed PASSED         [ 50%]
tests/test_ai_todo_engine.py::test_engine_respects_max_count PASSED      [ 75%]
tests/test_ai_todo_engine.py::test_engine_sorts_by_urgency PASSED        [100%]

========================= 4 passed, 1 warning in 0.65s =========================
```
(One unrelated Pydantic V1 config warning from the existing AI service code.)

## Acceptance check (against the plan's checklist)

- [x] `ai_todo_engine.py` exists with decorator + `generate_todos_for_user`
- [x] `TodoSuggestion` model fields aligned with spec § 2
- [x] 4 unit tests all pass
- [x] `/api/ai/suggest-todos` not touched (backward compatible)
- [x] Frontend not touched

## Notes for Checkpoint 2

- Delete `rule_dummy` first thing
- Keyword constants for `pacing_inbound_call_2h` / `pacing_call_no_answer_2d` should live at the top of `ai_todo_engine.py` for easy tuning
- For DB-touching rule tests, plan to use the same monkey-patch pattern (replace the rule's query helper) rather than spinning up Postgres — keeps tests fast and hermetic
