# Checkpoint 4-B Report — 6 stage rules (B-class)

**Date**: 2026-05-02
**Spec ref**: `docs/AI-TODO-SPEC-2026-05-02.md` v1.3 § 3.B
**Plan ref**: `docs/CLAUDE-CODE-EXECUTION-PLAN-2026-05-02.md` Checkpoint 4
**Commit**: `<filled in after push>`

> Continuation of CP4. Step 1-3 (status linkage + D-class) shipped earlier
> today as commit `243ca62`. This sub-report covers the deferred B-class
> rules now that the activity-status dropdown is wired and SDRs can
> populate real lead.status data.

## What shipped

### 6 stage rules (`backend/app/services/ai_todo_engine.py`)

| Rule ID | Trigger | Urgency | Action |
|---|---|---|---|
| `stage_new_stuck_7d` | `status=NEW`, last activity > 7d | medium | email |
| `stage_contacted_stuck_5d` | `status=CONTACTED`, > 5d | medium | call |
| `stage_interested_stuck_14d` | `status=INTERESTED`, > 14d | high | email |
| `stage_meeting_set_stuck_7d` | `status=MEETING_SET`, > 7d | high | review |
| `stage_proposal_stuck_5d` | `status=PROPOSAL`, > 5d | high | call |
| `stage_won_repurchase_90d` | `status=CLOSED_WON`, > 90d | medium | call |

`CLOSED_LOST` deliberately excluded per spec (don't nag dead leads).

### Implementation notes
- All 6 rules share a generic `_stage_stuck_window(...)` helper that:
  1. Queries `Lead` rows in the target status
  2. Reuses the engine's `_latest_activity_per_contact(db)` cache
  3. Falls back to `lead.created_at` when the contact has no activities
     (so a lead created and immediately ignored never escapes the rule)
- Rationale uses the same `_decorate(...)` substitution pattern as A-class
  (e.g. `"Scott Hider @ Clampitt Paper — 还在 NEW 7d+，该首次 reach out"`).
- New `_make_stage(...)` helper mirrors `_make` / `_make_data` to keep
  category="stage" centralized.

### Tests (`backend/tests/test_ai_todo_rules_stage.py`, 14 passing)

```
test_stage_rule_fires_when_stuck[NEW-7-medium]            PASSED
test_stage_rule_fires_when_stuck[CONTACTED-5-medium]      PASSED
test_stage_rule_fires_when_stuck[INTERESTED-14-high]      PASSED
test_stage_rule_fires_when_stuck[MEETING_SET-7-high]      PASSED
test_stage_rule_fires_when_stuck[PROPOSAL-5-high]         PASSED
test_stage_rule_fires_when_stuck[CLOSED_WON-90-medium]    PASSED
test_stage_rule_skips_when_recent[NEW-7-medium]           PASSED
test_stage_rule_skips_when_recent[CONTACTED-5-medium]     PASSED
test_stage_rule_skips_when_recent[INTERESTED-14-high]     PASSED
test_stage_rule_skips_when_recent[MEETING_SET-7-high]     PASSED
test_stage_rule_skips_when_recent[PROPOSAL-5-high]        PASSED
test_stage_rule_skips_when_recent[CLOSED_WON-90-medium]   PASSED
test_stage_proposal_skips_other_statuses                  PASSED
test_stage_won_repurchase_skips_recent_won                PASSED
```

(Plan asked for ≥ 12; shipped 14, including 2 sanity cases for status
isolation and "just-won" repurchase guard.)

## Total registered rules

```
total: 24
  pacing:      12
  stage:        6   ← this checkpoint
  data_health:  6
```

## Live engine output on dev DB

```
total returned: 7 (engine cap)
[high  ] pacing       pacing_hot_48h          cid=190: Doug Test @ GT Test
[medium] stage        stage_new_stuck_7d      cid=9:   Scott Hider @ Clampitt Paper
[medium] stage        stage_new_stuck_7d      cid=10:  Gale Woelffer @ OVAL
[medium] stage        stage_new_stuck_7d      cid=11:  David Brown @ Lindenmeyr
[medium] stage        stage_new_stuck_7d      cid=12:  Frank Matheus @ Lexjet
[medium] stage        stage_new_stuck_7d      cid=13:  Richard Reece @ Reece Supply
[medium] stage        stage_new_stuck_7d      cid=14:  Oscar Traveno @ GMG
```

(`pacing_hot_48h` for cid=190 was triggered by the live status-update e2e
test from earlier today; it'll roll off in 48h.)

**Observation**: All 118 leads in the dev DB are still `NEW`. As predicted
in spec § 11.6, every one is firing `stage_new_stuck_7d`. This is *correct
behaviour* but illustrates exactly why the activity-status dropdown
matters — once SDRs use it for a few days, status distribution will
diversify and the other 5 stage rules will start showing up.

## Total test suite

```
65 passed in 4.05s
   4   engine plumbing (CP1)
   6   activity status_update helper (CP4 step 1)
  27   pacing rules (CP2)
  14   data_health rules (CP4 step 3)
  14   stage rules (CP4-B today)
```

## Acceptance check

- [x] 6 B-class rules registered with `category="stage"`
- [x] Function names match spec (`rule_stage_<status>_stuck`)
- [x] LeadStatus enum NOT modified (uses existing 7 values per v1.3)
- [x] `CLOSED_LOST` not flagged (no rule for dead leads)
- [x] ≥ 12 unit tests (14 passing)
- [x] No frontend changes (engine output flows through existing CP3 UI)
- [x] No new tables / no DB migrations

## ⚠️ Known overlap (flagged, not blocking)

`pacing_quote_5d` (§ 3.A) and `stage_proposal_stuck_5d` (§ 3.B) trigger
on **the same condition** (lead in PROPOSAL + last activity > 5d) with
identical urgency=high. Both fire as separate suggestions; the engine's
7-slot cap absorbs the duplication.

Two clean-up paths once Manager feedback comes in:
1. **Drop `pacing_quote_5d` / `pacing_quote_10d`** — stage rules supersede
   them (recommended; the "quote" naming was a v1.2 holdover).
2. **Add a dedup pass in the engine** — collapse multiple suggestions for
   the same `contact_id` into the highest-urgency one.

Defer the call until 1-2 weeks of real usage tells us whether
overlap is hurting the panel.

## Threshold-tuning watchlist (carried over from CP4 step 3 + new from B)

| Rule | Why it might fire too much / too little |
|---|---|
| `data_missing_linkedin` / `data_missing_industry` | ~60-80% of dev DB hits these; could drown out actionable rules |
| `stage_new_stuck_7d` | All 118 dev leads currently fire this; dropdown usage will fix the data, not the threshold |
| `stage_won_repurchase_90d` | No leads in CLOSED_WON yet — can't observe in dev |

## David smoke-test path

1. Pull `main`, restart backend (engine auto-loads new rules)
2. Open dashboard — should see `pacing_*` + `stage_new_stuck_7d` mixed in
3. Open any contact's QuickEntry, log a call with Lead Status = "已发提案"
   → next dashboard refresh, that contact may now appear under
   `stage_proposal_stuck_5d` instead of `stage_new_stuck_7d` (depending
   on its activity recency)
4. Verify "Why?" expand on a stage card shows `rule_id: stage_*_stuck_*`
5. Snooze a stage suggestion → next refresh it's gone for 7d (UI default)
