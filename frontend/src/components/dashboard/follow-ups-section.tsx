/**
 * FollowUpsSection — the main dashboard surface.
 *
 * Splits the backend's flat follow-up list into 4 time buckets and renders
 * each via <FollowUpBucket />:
 *   - Overdue          (red, default open)
 *   - Today            (default open)
 *   - This week        (default closed)
 *   - Later this month (default closed)
 *
 * The backend already pre-groups overdue / today / upcoming; we further split
 * "upcoming" into "this week" (next 7 days) vs "later this month" (≤ 31 days
 * out) on the client. Anything past 31 days is dropped — those are too far
 * to be actionable on a daily dashboard.
 */
"use client";

import { useMemo } from "react";
import type { FollowUp, FollowUpsResponse } from "./types";
import FollowUpBucket from "./follow-up-bucket";

interface Props {
  followUps: FollowUpsResponse | null;
  onSnooze: (item: FollowUp, days: number) => void;
  onClose: (item: FollowUp) => void;
  onDone: (item: FollowUp) => void;
}

export default function FollowUpsSection({
  followUps,
  onSnooze,
  onClose,
  onDone,
}: Props) {
  const buckets = useMemo(() => splitBuckets(followUps), [followUps]);

  return (
    <section className="mb-8">
      <header className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-base font-semibold text-slate-900">
          Follow-ups
        </h2>
        <p className="text-xs text-slate-500">
          Click <span className="font-mono">View detail</span> to open the
          contact ·{" "}
          <span className="font-mono">⋯</span> for more actions
        </p>
      </header>

      <FollowUpBucket
        title="Overdue"
        items={buckets.overdue}
        defaultOpen
        isOverdue
        onDone={onDone}
        onSnooze={onSnooze}
        onClose={onClose}
      />
      <FollowUpBucket
        title="Today"
        items={buckets.today}
        defaultOpen
        onDone={onDone}
        onSnooze={onSnooze}
        onClose={onClose}
      />
      <FollowUpBucket
        title="This week"
        items={buckets.this_week}
        defaultOpen={false}
        onDone={onDone}
        onSnooze={onSnooze}
        onClose={onClose}
      />
      <FollowUpBucket
        title="Later this month"
        items={buckets.later}
        defaultOpen={false}
        onDone={onDone}
        onSnooze={onSnooze}
        onClose={onClose}
      />

      {!followUps && (
        <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
      )}
      {followUps && followUps.total === 0 && (
        <p className="text-sm text-slate-400 text-center py-6">
          No follow-ups scheduled. Log an activity with a follow-up date to
          see it here.
        </p>
      )}
    </section>
  );
}

function splitBuckets(resp: FollowUpsResponse | null): {
  overdue: FollowUp[];
  today: FollowUp[];
  this_week: FollowUp[];
  later: FollowUp[];
} {
  if (!resp) return { overdue: [], today: [], this_week: [], later: [] };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oneWeek = new Date(today);
  oneWeek.setDate(oneWeek.getDate() + 7);
  const oneMonth = new Date(today);
  oneMonth.setDate(oneMonth.getDate() + 31);

  const overdue: FollowUp[] = [];
  const todayBucket: FollowUp[] = [];
  const thisWeek: FollowUp[] = [];
  const later: FollowUp[] = [];

  for (const fu of resp.follow_ups) {
    if (fu.urgency === "overdue") {
      overdue.push(fu);
      continue;
    }
    if (fu.urgency === "today") {
      todayBucket.push(fu);
      continue;
    }
    // upcoming — split further
    if (fu.follow_up_date) {
      const due = new Date(fu.follow_up_date);
      if (due <= oneWeek) thisWeek.push(fu);
      else if (due <= oneMonth) later.push(fu);
      // > 31 days out: dropped from dashboard.
    } else {
      // Task with no due date — drop into "later".
      later.push(fu);
    }
  }

  return { overdue, today: todayBucket, this_week: thisWeek, later };
}
