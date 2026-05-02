# Checkpoint 2 Report — 12 A-class Pacing Rules

**Date**: 2026-05-02
**Spec ref**: `docs/AI-TODO-SPEC-2026-05-02.md` § 3.A
**Plan ref**: `docs/CLAUDE-CODE-EXECUTION-PLAN-2026-05-02.md` (Checkpoint 2)
**Commit**: `<filled in after push>`

## What shipped

### Rules implemented (12 total, registered in `ai_todo_engine.py`)

| # | Rule ID | Trigger | Urgency | Action |
|---|---|---|---|---|
| 1 | `pacing_hot_48h` | latest call/meeting < 48h | high | email |
| 2 | `pacing_email_no_reply_3d` | latest activity = email, > 3d | medium | call |
| 3 | `pacing_call_no_answer_2d` | latest content has voicemail keyword > 2d | medium | email |
| 4 | `pacing_silent_7d` | 7d ≤ silence < 14d | low | email |
| 5 | `pacing_silent_14d` | 14d ≤ silence < 30d | medium | email |
| 6 | `pacing_silent_30d` | 30d ≤ silence < 60d | high | email |
| 7 | `pacing_silent_60d` | 60d ≤ silence < 90d | medium | email |
| 8 | `pacing_silent_90d` | silence ≥ 90d | low | review |
| 9 | `pacing_quote_5d` | lead in PROPOSAL + last activity > 5d | high | call |
| 10 | `pacing_quote_10d` | lead in PROPOSAL + last activity > 10d | medium | email |
| 11 | `pacing_inbound_call_2h` | latest content has inbound keyword < 2h | high | call |
| 12 | `pacing_email_received_today` | latest sent_emails row direction=received, today, no later sent | high | email |

### Architecture

- Each rule is a standalone `async def rule_<id>(db, user)` function decorated
  with `@register_rule("<id>", "pacing")`. No shared state.
- Helpers `_latest_activity_per_contact(db)`, `_contacts_by_id(db, ids)`,
  `_silent_window(...)`, `_quote_window(...)` are read-only and shared
  freely — they do not mutate engine state.
- `NO_ANSWER_KEYWORDS` and `INBOUND_KEYWORDS` constants live at module top
  for easy tuning.
- Rationale post-decoration: rules emit `"<contact_id> — <phrase>"` and
  `_decorate(db, items)` swaps the leading id for `"<First Last> @ <Company>"`
  in one bulk-load round-trip after all rules have run.
- Dummy rule from CP1 deleted.

### Tests (`backend/tests/test_ai_todo_rules_pacing.py`, 27 tests)

| Rule | Tests |
|---|---|
| `pacing_hot_48h` | 2 (positive: recent call; negative: 5d-old call) |
| `pacing_email_no_reply_3d` | 2 (positive: 5d email; negative: 1d email) |
| `pacing_call_no_answer_2d` | 2 (positive: voicemail keyword; negative: no keyword) |
| `pacing_silent_7d` | 2 (positive 10d; negative 3d) |
| `pacing_silent_14d` | 2 (positive 20d; negative 5d) |
| `pacing_silent_30d` | 3 (positive 40d; too-recent 20d; too-old 80d) |
| `pacing_silent_60d` | 2 (positive 75d; negative 30d) |
| `pacing_silent_90d` | 3 (positive 120d; open-ended 365d; negative 60d) |
| `pacing_quote_5d` | 2 (positive PROPOSAL+7d; negative NEW status) |
| `pacing_quote_10d` | 2 (positive PROPOSAL+15d; negative PROPOSAL+7d) |
| `pacing_inbound_call_2h` | 2 (positive: "called in" 1h ago; negative: 5h ago) |
| `pacing_email_received_today` | 3 (positive; yesterday; replied-after-receive) |

Plus 4 engine-plumbing tests from Checkpoint 1, total **31 passing** in 2.49 s.

### Test infrastructure (new in this checkpoint)

- `backend/tests/conftest.py`: transactional Postgres fixture using
  SQLAlchemy 2.0 `join_transaction_mode="create_savepoint"`. Each test
  runs inside an outer transaction that is rolled back on teardown — no
  rows persist to the dev DB.
- Factories: `make_contact`, `make_activity`, `make_lead`, `make_sent_email`,
  plus `seed_user_id` (uses the existing dev admin's id).
- `load_dotenv` at top of conftest so `DATABASE_URL` is picked up when
  pytest is invoked directly.
- Helpers `days_ago(n)` and `hours_ago(n)`.

## What did NOT change

- `/api/ai/suggest-todos` endpoint untouched (still old Claude-driven impl)
- No frontend changes
- No DB schema changes
- No new tables

## Test output

```
============================= test session starts ==============================
collected 31 items

tests/test_ai_todo_engine.py::test_engine_runs_with_no_rules PASSED
tests/test_ai_todo_engine.py::test_engine_filters_snoozed PASSED
tests/test_ai_todo_engine.py::test_engine_respects_max_count PASSED
tests/test_ai_todo_engine.py::test_engine_sorts_by_urgency PASSED
tests/test_ai_todo_rules_pacing.py::test_hot_48h_fires_for_recent_call PASSED
tests/test_ai_todo_rules_pacing.py::test_hot_48h_no_fire_for_old_call PASSED
tests/test_ai_todo_rules_pacing.py::test_email_no_reply_3d_fires PASSED
tests/test_ai_todo_rules_pacing.py::test_email_no_reply_3d_skips_recent PASSED
tests/test_ai_todo_rules_pacing.py::test_no_answer_2d_fires_keyword_voicemail PASSED
tests/test_ai_todo_rules_pacing.py::test_no_answer_2d_no_fire_when_keyword_missing PASSED
tests/test_ai_todo_rules_pacing.py::test_silent_window_positive[rule_pacing_silent_7d-10-low] PASSED
tests/test_ai_todo_rules_pacing.py::test_silent_window_positive[rule_pacing_silent_14d-20-medium] PASSED
tests/test_ai_todo_rules_pacing.py::test_silent_window_positive[rule_pacing_silent_30d-40-high] PASSED
tests/test_ai_todo_rules_pacing.py::test_silent_window_positive[rule_pacing_silent_60d-75-medium] PASSED
tests/test_ai_todo_rules_pacing.py::test_silent_window_positive[rule_pacing_silent_90d-120-low] PASSED
tests/test_ai_todo_rules_pacing.py::test_silent_30d_skips_too_recent PASSED
tests/test_ai_todo_rules_pacing.py::test_silent_30d_skips_too_old PASSED
tests/test_ai_todo_rules_pacing.py::test_silent_90d_open_ended PASSED
tests/test_ai_todo_rules_pacing.py::test_silent_window_negative[rule_pacing_silent_7d-3] PASSED
tests/test_ai_todo_rules_pacing.py::test_silent_window_negative[rule_pacing_silent_14d-5] PASSED
tests/test_ai_todo_rules_pacing.py::test_silent_window_negative[rule_pacing_silent_60d-30] PASSED
tests/test_ai_todo_rules_pacing.py::test_silent_window_negative[rule_pacing_silent_90d-60] PASSED
tests/test_ai_todo_rules_pacing.py::test_quote_5d_fires_for_proposal_lead PASSED
tests/test_ai_todo_rules_pacing.py::test_quote_5d_no_fire_for_non_proposal PASSED
tests/test_ai_todo_rules_pacing.py::test_quote_10d_skips_5d_window PASSED
tests/test_ai_todo_rules_pacing.py::test_quote_10d_fires_for_old_quote PASSED
tests/test_ai_todo_rules_pacing.py::test_inbound_call_2h_fires PASSED
tests/test_ai_todo_rules_pacing.py::test_inbound_call_2h_skips_too_old PASSED
tests/test_ai_todo_rules_pacing.py::test_email_received_today_fires PASSED
tests/test_ai_todo_rules_pacing.py::test_email_received_today_skips_yesterday PASSED
tests/test_ai_todo_rules_pacing.py::test_email_received_today_skips_when_replied PASSED

======================== 31 passed, 1 warning in 2.49s =========================
```

## ⚠️ Spec-vs-code deviations (please review)

### 1. LeadStatus enum mismatch (affects `pacing_quote_5d` + `pacing_quote_10d`)

The spec § 3.B references a 12-stage lead pipeline with statuses like
`price_negotiation`, `talking_potential_order`, `verbal_order`, etc.
**The current `LeadStatus` enum has only 7 values**:
`new / contacted / interested / meeting_set / proposal / closed_won / closed_lost`.

Spec's `pacing_quote_5d` triggers on
`status IN (price_negotiation, talking_potential_order)`.
For Checkpoint 2 I mapped the "quote" concept to **`LeadStatus.PROPOSAL`**
(the closest existing semantic). Tests confirm rules fire for PROPOSAL leads.

**This needs to be revisited at Checkpoint 4** when B-class rules require
the full 12-stage enum. At that point either:
- Expand `LeadStatus` enum (12 values) and update these two rules, or
- Keep current 7-stage enum and rewrite the spec's 12-stage tables to fit.

David should pick before CP4 starts.

### 2. Section A header says "13 条" but table has 12 rows

Spec § 3.A heading reads "13 条" but the table only enumerates 12 rules
(`pacing_hot_48h` through `pacing_email_received_today`). Plan also says
"12 条". Implemented 12, treating the heading as a typo.

## Acceptance check (against the plan)

- [x] 12 rules implemented; function names + IDs strictly match spec
- [x] 27 unit tests pass (≥ 24 required)
- [x] Keyword constants top-of-file (`NO_ANSWER_KEYWORDS`, `INBOUND_KEYWORDS`)
- [x] No rule shares state with another rule (no calls between rules)
- [x] All DB queries use SQLAlchemy ORM (no raw SQL)
- [x] `/api/ai/suggest-todos` not modified
- [x] No frontend changes
- [x] Dummy rule from CP1 deleted

## David self-test prompts

Pick any 3 of these and reproduce in a Python REPL against the dev DB:

```python
from app.services.ai_todo_engine import (
    rule_pacing_silent_30d, rule_pacing_hot_48h, rule_pacing_email_received_today
)
from app.core.database import async_session
from app.models.user import User

import asyncio
async def main():
    async with async_session() as db:
        u = (await db.execute(select(User).limit(1))).scalar_one()
        out = await rule_pacing_silent_30d(db, u)
        for s in out[:5]:
            print(s.rule_id, s.contact_id, s.urgency, "—", s.rationale)
asyncio.run(main())
```
