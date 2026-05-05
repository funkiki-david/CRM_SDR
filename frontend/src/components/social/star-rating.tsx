/**
 * StarRating — 5-star "teammates loved this" badge.
 *
 * Display mode: shows ⭐⭐⭐⭐⭐ with a count of teammates who starred,
 * tooltip exposes the names. Click the cluster to toggle the current user's
 * star (gold when on, slate when off).
 *
 * Behaviour matches §3.3 of the spec: each user contributes at most one
 * star; the displayed count is "how many teammates starred" — not a
 * weighted average.
 */
"use client";

import { CURRENT_USER_ID, namesFromIds } from "@/lib/team-mock";

interface StarRatingProps {
  /** userIds who starred this row */
  starredBy: number[];
  /** Toggle handler — parent flips the current user in/out of the set. */
  onToggle: () => void;
}

export default function StarRating({ starredBy, onToggle }: StarRatingProps) {
  const userStarred = starredBy.includes(CURRENT_USER_ID);
  const count = starredBy.length;
  const tooltip = count > 0 ? namesFromIds(starredBy) : "Be the first to star this";

  return (
    <button
      type="button"
      onClick={onToggle}
      title={tooltip}
      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors hover:bg-slate-100"
      aria-pressed={userStarred}
      aria-label={`Star this — ${count} teammates`}
    >
      <span
        aria-hidden
        className="tracking-tight"
        style={{ color: userStarred ? "#f59e0b" : "#cbd5e1" }}
      >
        {"★★★★★"}
      </span>
      <span className="font-medium tabular-nums text-slate-600">({count})</span>
    </button>
  );
}
