# Checkpoint 3 Report — Engine wired to API + dashboard redesigned

**Date**: 2026-05-02
**Spec ref**: `docs/AI-TODO-SPEC-2026-05-02.md` § 5.2 / § 5.3 / § 5.4
**Plan ref**: `docs/CLAUDE-CODE-EXECUTION-PLAN-2026-05-02.md` (Checkpoint 3)
**Commit**: `<filled in after push>`

## What shipped

### Backend

1. **`/api/ai/suggest-todos`** rewired (`backend/app/api/routes/ai.py`)
   - Now calls `generate_todos_for_user(db, current_user, max_count=7)` from
     the engine — **no more Claude calls / token spend** for to-dos
   - Old Claude path renamed `_legacy_suggest_todos_claude` and kept inline
     for quick rollback; `# pragma: no cover` so coverage doesn't complain
   - The `force` query param is accepted but inert (rules are deterministic,
     no caching to bust)

2. **`POST /api/tasks/snooze-suggestion`** updated (`backend/app/api/routes/tasks.py`)
   - Body now accepts `{rule_id, contact_id, days}` (engine-aligned hash:
     `sha256("{rule_id}|{contact_id or ''}")[:32]`)
   - Old `{title, action, days}` shape still accepted (legacy hash) for
     backward compat — rows get written but the engine no longer matches
     against this hash

3. **`GET /api/tasks/snooze-suggestion?active=true`** (new)
   - Returns `{hashes: [...]}` for the current user's currently-active snoozes
   - Frontend uses this on dashboard mount to pre-filter without per-card
     round-trips

### Frontend

4. **`frontend/src/app/dashboard/page.tsx`** AI Suggested To-Do section
   - **Removed**: `dismissed` Set + `localStorage.getItem("ai_todos_dismissed")`
     (key no longer used anywhere)
   - **Added**: parallel fetch of `/api/ai/suggest-todos` + active snoozes
     on mount; client-side SHA-256 hash (`crypto.subtle.digest`) to filter
   - **Optimistic hide** on dismiss/snooze — card disappears instantly,
     server write happens in background
   - New `AISuggestion` shape: `rule_id`, `urgency` (high/medium/low),
     `category` (pacing/stage/data_health/relationship/discipline),
     `suggested_action` (call/email/linkedin/review), `rationale`, `contact_id`

5. **New `<SuggestionCard>`** layout
   - Left urgency stripe: `bg-red-500` (high) / `bg-amber-500` (medium) /
     `bg-slate-400` (low)
   - Top-right category pill: `Pacing` / `Stage` / `Data` / `Relationship` /
     `Discipline`
   - Card body: rationale headline (e.g. *"Calis Argueta @ PVC TECH —
     沉默 7d，发轻 touch"*)
   - Collapsible **▶ Why?** section showing `rule_id`, `suggested_action`,
     `contact_id` for debugging
   - Action row: `[+ Create Task]` (blue) `[😴 1d] [3d] [7d]` (white)
     `[✓ Done]` (slate-400, right-aligned, days=365 effective forever)

6. **`tasksApi`** (`frontend/src/lib/api.ts`)
   - `snoozeSuggestion()` accepts both new `{rule_id, contact_id, days}`
     object and legacy `(title, action, days)` positional args
   - `snoozeSuggestionList()` added — wraps GET `?active=true`

### What did NOT change
- Today's Follow-Ups section (untouched per plan rule "不重做 dashboard
  的今日 Follow-Ups")
- Activity Feed
- Other dashboard sections

## Live test results (local)

```
=== 4 accounts hitting engine-driven /api/ai/suggest-todos ===
  info@amazonsolutions.us:
    count=7
    [medium] pacing_email_no_reply_3d: Doug Test @ GT Test — 邮件 3d 无回...
    [medium] pacing_email_no_reply_3d: Graphic Tac Info @ Graphic Tac — ...
    [low] pacing_silent_7d: Calis Argueta @ PVC TECH — 沉默 7d, 发轻 touch
  marketing@graphictac.biz:           count=7  (same data, team-shared)
  graphictac.doug@gmail.com:          count=7  (same)
  graphictac.steve@gmail.com:         count=7  (same)
```

```
=== Snooze cycle (rule=pacing_email_no_reply_3d, contact=190) ===
  POST snooze HTTP 200
  GET active snoozes → {"hashes": ["ed00570a12c2404a9fd2f8210be5ee99"]}
  Re-fetched suggest-todos → that exact (rule, contact) combo no longer in output
  Doug Test still appears under different rules (pacing_silent_7d) — correct,
  snoozes are scoped to the (rule_id, contact_id) tuple
```

(Test snooze rows were wiped after verification; Manager will see a clean
slate of 7 suggestions on first dashboard load.)

## Acceptance check (against the plan's checklist)

- [x] 4 accounts can fetch to-dos (all return 7 each)
- [x] Snooze removes the (rule, contact) combo from subsequent fetches
- [ ] **Time-decay: snooze for N days then re-appear** — verified at API level
      (snooze_until > NOW() filter); tested by manually shifting clock would
      go beyond CP3 scope. Plan says "可手动改 snooze_until 测试" so flagged
      for David's灰度 (item below)
- [x] `localStorage` key `ai_todos_dismissed` is gone (grep finds 0 hits)
- [x] urgency color stripe correct (red/amber/slate by urgency)
- [x] Why? expandable shows rule_id + action + contact_id

## David grey-launch instructions

> **The plan's most important rule for CP3** (line 217): don't start CP4
> before letting Managers actually use it for **3-5 days**.

What to do this week:

1. Push `main` (this commit) to Railway and let Cloud rebuild (~10 min)
2. Tell the 3 Managers the dashboard's AI panel got rebuilt — engine-based,
   not LLM-guessed
3. Each day, check the panel for each account and note:
   - Which suggestions get dismissed/snoozed most? (signal: threshold off)
   - Which never appear? (signal: rule bug or data starvation)
   - Which do Managers say "yes I'd do that"? (signal: reinforce)
4. Manually re-write `ai_suggestion_snoozes.snooze_until` to a past time to
   confirm a snoozed card re-appears on the next page load:
   ```sql
   UPDATE ai_suggestion_snoozes SET snooze_until = NOW() - INTERVAL '1 hour'
   WHERE id = <pick one>;
   ```
5. After 3-5 days, write `docs/CHECKPOINT-3-FEEDBACK-<date>.md` (1 page,
   bullet form). That's the gate to CP4.

## Implementation notes

- **Why client-side SHA-256?** The frontend filter has to match the same
  hash that the backend's `suggestion_hash()` produces. `crypto.subtle.digest`
  ships in every modern browser and Node, so we don't add a bundle dep.
  Computed once per `(rule_id, contact_id)` per refresh.

- **Optimistic hide vs. true server filter.** When a Manager dismisses,
  we add the hash to a local `hiddenHashes` Set immediately so the card
  vanishes; the POST to the server happens in parallel. On next page load
  the server's `snoozedHashes` takes over — no flicker.

- **Done = days=365**. Spec said "forever", but using NULL would require
  a special-case in the engine query. 365 days is a clean reuse of the
  existing snooze mechanism. Easy to extend to NULL later if "true forever"
  is needed.

- **Category-data_health colour stripe**. Spec only specifies urgency
  colours, so all categories use the same stripe scheme. The category
  pill is the differentiator.

- **Backwards compat preserved**. Old frontends that POST
  `{title, action, days}` still work (legacy hash recorded). They'll
  filter nothing because the engine doesn't read those hashes — that's
  the intended behaviour: a stale frontend just sees no snoozes apply.
