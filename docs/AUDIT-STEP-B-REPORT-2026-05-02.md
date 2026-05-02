# Audit Step B Report — Mockup-ready foundations

**Date**: 2026-05-02
**Scope ref**: `docs/SDR-CRM-前端交互审计报告` step B
**Commit**: `<filled in after push>`

> Lays the backend foundations the 6 mockup HTML pages need. Step B is
> deliberately backend-only — visual styling (fonts/colours/pills/layout)
> ships in a separate task.

## Audited 4 items, all green

### ✅ 1. New activity columns

```sql
ALTER TABLE activities ADD COLUMN outcome VARCHAR(20)
ALTER TABLE activities ADD COLUMN temperature VARCHAR(20)
ALTER TABLE activities ADD COLUMN duration_minutes INTEGER
```

Verified in dev DB (`information_schema.columns` query). Idempotent
migration is also added to `init_db.py` so cloud picks it up on next
deploy.

### ✅ 2. POST /api/activities schema extended

New optional fields on `ActivityCreate`:
- `outcome` — `positive` / `neutral` / `no_answer` / `negative`
- `temperature` — `hot` / `warm` / `neutral` / `cold`
- `duration_minutes` — integer

All optional → existing clients keep working, no validation errors.
The POST handler persists them. The PATCH handler also accepts them
(so the audit's "Edit" actions on the mockup work end-to-end).
The response builder (`_build_activity_response`) surfaces them in
every API response.

Live e2e:
```
POST {…, outcome:"positive", temperature:"hot", duration_minutes:12}
  → id=208  outcome=positive  temperature=hot  duration_minutes=12 ✓

PATCH /api/activities/208 {outcome:"no_answer", temperature:"warm", duration_minutes:5}
  → updated ✓

POST {legacy payload — no new fields}
  → id=209  outcome=None  temperature=None  duration_minutes=None ✓
```

(Both test rows deleted after verification.)

### ✅ 3. Snooze: localStorage residue

Audit flagged "前端还在用 localStorage". `grep -rn "ai_todos_dismissed"
frontend/src` returns **0 hits** — already migrated to backend in
CP3 (commit `7a29980`, Apr 30). Frontend now calls
`POST /api/tasks/snooze-suggestion` and pre-loads active hashes via
`GET /api/tasks/snooze-suggestion?active=true`.

### ✅ 4. Email Reply / Forward disabled

Audit flagged that buttons "must be disabled, can't pretend they
work". Already handled in the email-freeze CP (commit `26c8428`,
Apr 22). Confirmed at `frontend/src/app/emails/page.tsx:315-324`:

```tsx
<Button size="sm" disabled
        title="Coming soon — please send emails from your Gmail directly"
        className="cursor-not-allowed bg-slate-100 text-slate-400 …">
  Reply
</Button>
<Button size="sm" variant="outline" disabled title="Coming soon">
  Forward
</Button>
```

Both buttons render greyed-out with hover tooltip. Server side, all
send routes return `501 EMAIL_FROZEN` regardless.

## Tests

```
68 passed in 4.02s
   3   activity mockup-fields (Step B today)
   4   engine plumbing
   6   activity status_update helper
  27   pacing rules
  14   data_health rules
  14   stage rules
```

The 3 new mockup-field tests cover:
1. Activity row created with all three fields persists them
2. `_build_activity_response` surfaces them in API output
3. Legacy clients sending no new fields still work (back-compat)

## What did NOT change

- Frontend rendering: no styling work, mockup HTML still lives outside
  the React tree
- No new endpoints — only schema additions to existing POST + PATCH
- No new tables
- `Activity` enum values for `outcome` / `temperature` are loose
  strings for now; can tighten with a Postgres CHECK constraint or
  Python enum once mockup wires them up via dropdowns

## Next step (per David)

Visual mockup-to-React port — fonts, colours, pills, layout. Out of
scope for Step B. New task brief incoming.
