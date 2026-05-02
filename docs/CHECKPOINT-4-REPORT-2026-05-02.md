# Checkpoint 4 Report — Activity-Status linkage + 6 D-class rules

**Date**: 2026-05-02
**Spec ref**: `docs/AI-TODO-SPEC-2026-05-02.md` v1.3 § 11 (Activity-Status), § 3.D (Data Health)
**Plan ref**: `docs/CLAUDE-CODE-EXECUTION-PLAN-2026-05-02.md` (Checkpoint 4)
**Commit**: `<filled in after push>`

> **Scope chosen by David**: option A — Activity-Status linkage (§ 11)
> + D-class rules now; B-class deferred 1-2 days until SDRs have populated
> real `lead.status` data via the new dropdown.

---

## Step 1 — Backend: optional `lead_status_update` on activity

### Schema (`backend/app/schemas/activity.py`)
- Added `lead_status_update: Optional[str] = None` to `ActivityCreate`.

### Routes (`backend/app/api/routes/activities.py`)
- New helper `_maybe_update_lead_status(db, contact_id, new_status)`:
  - `None` → no-op
  - Invalid enum → HTTP 400
  - Contact has no lead → silent skip (per § 11.3)
  - Multiple leads → updates the most recently `updated_at` one
  - No history kept (overwrite, per § 11.2 decision A)
- Wired into `POST /api/activities` after the activity insert.
- Wired into `PATCH /api/activities/{id}` after field updates.
- `ActivityPatch` extended with the same `lead_status_update` field.

### Tests (`backend/tests/test_activity_status_update.py`, **6 passing**)

```
test_create_activity_no_status_update          PASSED
test_create_activity_with_status_update        PASSED
test_create_activity_status_update_no_lead     PASSED
test_create_activity_status_update_multiple_leads  PASSED
test_create_activity_downgrade_allowed         PASSED
test_create_activity_invalid_status_raises     PASSED
```

(Spec asked for 5; added a 6th covering invalid-enum 400.)

### Live e2e check
```
POST /api/activities {contact_id:9, type:call, lead_status_update:"interested"}
  → HTTP 201
  → lead 6 status changed: new → interested  ✓
  → reverted + cleaned test rows after
```

---

## Step 2 — Frontend: status dropdown in QuickEntry + EditActivity

### `frontend/src/components/quick-entry.tsx`
- New state `leadStatus` (default `""` = "(不更新)").
- Reset to `""` on dialog open (alongside other form resets).
- New `<select>` between the Notes field and the Next-Follow-up block.
- Submit body now includes `lead_status_update: leadStatus || null`.

### `frontend/src/components/edit-activity.tsx`
- Same dropdown, placed after Notes.
- Resets to `""` on every prefill (edits default to "no change" — avoids
  accidentally stomping a status the SDR didn't intend to touch).
- PATCH payload conditionally sets `lead_status_update` only when
  non-empty.

### Dropdown options (label / value)
```
(不更新)        ""
新线索          new
已联系          contacted
有兴趣          interested
已约会议        meeting_set
已发提案        proposal
成交            closed_won
失败            closed_lost
```

`build` passes; static prerender succeeds for all 8 routes.

---

## Step 3 — D-class rules: 6 rules + 14 tests

### Rules implemented

| ID | Trigger | Urgency |
|---|---|---|
| `data_missing_phone` | contact created > 7d ago AND mobile_phone IS NULL AND office_phone IS NULL | low |
| `data_missing_linkedin` | linkedin_url IS NULL | low |
| `data_missing_industry` | industry IS NULL OR company_size IS NULL | low |
| `data_dead_contact_30d` | contact created > 30d ago AND zero activities | medium |
| `data_lead_stuck_60d` | `leads.updated_at < NOW() - 60d` AND status not in (won, lost) | medium |
| `data_collision_7d` | same `contact_id` has activity from ≥ 2 distinct `user_id` in last 7d | high |

All registered with `category="data_health"`. Rationale post-decoration
shares the same `_decorate(db, items)` helper as A-class — `<First Last>
@ <Company>` substitution.

### Tests (`backend/tests/test_ai_todo_rules_data.py`, **14 passing**)

```
test_missing_phone_fires_for_old_contact_no_phones  PASSED
test_missing_phone_skips_recent_contact             PASSED
test_missing_phone_skips_when_one_phone_present     PASSED
test_missing_linkedin_fires                         PASSED
test_missing_linkedin_skips_when_present            PASSED
test_missing_industry_fires_when_industry_null      PASSED
test_missing_industry_skips_when_both_present       PASSED
test_dead_contact_30d_fires                         PASSED
test_dead_contact_30d_skips_with_activity           PASSED
test_lead_stuck_60d_fires                           PASSED
test_lead_stuck_60d_skips_recent_update             PASSED
test_lead_stuck_60d_skips_closed_status             PASSED
test_collision_7d_fires_with_two_owners             PASSED
test_collision_7d_skips_single_owner                PASSED
```

(Spec asked for ≥ 12; shipped 14, including a "won/lost should not be
flagged stuck" sanity case for `data_lead_stuck_60d`.)

---

## Engine output on the dev DB (post-CP4)

```
7 suggestions returned (max 7 per the engine cap)
[medium] pacing       pacing_email_no_reply_3d   cid=190: Doug Test @ GT Test — 邮件 3d 无回...
[medium] pacing       pacing_email_no_reply_3d   cid=191: Graphic Tac Info — 邮件 3d 无回...
[low]    data_health  data_missing_industry      cid=9:   Scott Hider @ Clampitt Paper
[low]    data_health  data_missing_linkedin      cid=10:  Gale Woelffer @ OVAL — 缺 LinkedIn
[low]    data_health  data_missing_industry      cid=10:  Gale Woelffer — 缺行业 / 公司规模
[low]    data_health  data_missing_linkedin      cid=11:  David Brown — 缺 LinkedIn
[low]    data_health  data_missing_industry      cid=11:  David Brown — 缺行业 / 公司规模
```

D-class rules now contribute. Pacing still leads (medium > low).
180+ contacts in dev DB have no LinkedIn / no industry, so once the
two `pacing_email_no_reply_3d` suggestions are dismissed, the next
batch will be all data-health.

**Possible threshold tuning signal**: `data_missing_linkedin` likely
fires for ~60-80% of contacts — this could overwhelm the panel once
the pacing rules quiet down. Recommend monitoring for 1 week before
deciding whether to:
- Raise threshold to "missing AND created > 30d" (give SDR time to enrich), or
- Cap each data-health rule at top 5 results before the engine's
  max_count truncation.

---

## Total test suite

```
51 passed in 3.28s
  4 engine plumbing
  6 status-update helper
 27 pacing rules (CP2)
 14 data-health rules (CP4 today)
```

---

## Acceptance check (against the plan)

- [x] Section 11 backend (`POST` + `PATCH` accept `lead_status_update`)
- [x] 5+ status-update unit tests (6 passing)
- [x] QuickEntry + EditActivity have the dropdown
- [x] Dropdown UI: 7 enum + "(不更新)" default = no-op
- [x] D-class 6 rules implemented
- [x] ≥ 12 D-class tests (14 passing)
- [x] Frontend `npm run build` green
- [x] Live e2e verified: posting an activity with `lead_status_update`
      flips the linked lead's status, no error when contact has no lead

---

## What's deferred (B-class, on purpose)

Per spec § 11.6: B-class rules require real `lead.status` data. With
all 118 leads still in `NEW` (until SDRs use the new dropdown for 1-2
days), the 6 stage rules would all return empty.

Plan: deploy this commit → 1-2 day SDR usage produces real status
data → next checkpoint implements B-class rules.

---

## David's smoke-test path

1. Pull latest `main`, restart backend
2. Open localhost:3000/dashboard, login as any account, click `+ Log Activity`
3. Pick a contact → Type=call → leave Notes blank → Lead Status =
   "已联系" → Save
4. Verify in psql: `SELECT id, contact_id, status FROM leads WHERE contact_id = <id>`
5. Open the same activity from the contact page, click ✏️ Edit → set
   Lead Status = "(不更新)" → Save → confirm `leads.status` is still
   the previous value (didn't get overwritten)
