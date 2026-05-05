/**
 * CreditsChip — virtual credit balance with a click-to-expand recent-activity
 * ledger. Used in the dashboard right-column TeamZone (compact mode) and
 * preserved as a horizontal flex layout for legacy top-bar placement.
 *
 * The parent owns the credit balance (so Send-Credits actions can decrement
 * it). The ledger and "stars this week" come from team-mock.
 *
 * `compact` prop = true  → 2x2 grid layout, tighter padding, smaller text;
 *                          popover anchors left to fit a narrow column.
 * `compact` prop = false → single horizontal row (legacy top-bar layout).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { MOCK_CREDIT_LEDGER, MOCK_TEAM_REACTIONS_TODAY } from "@/lib/social-mock";
import { CURRENT_USER_ID, findTeamMember } from "@/lib/team-mock";

interface CreditsChipProps {
  /** Live credit balance — passed from the dashboard so it can react to sends. */
  credits: number;
  /** When true, render chips in a 2x2 grid with smaller text (for narrow columns). */
  compact?: boolean;
}

export default function CreditsChip({ credits, compact = false }: CreditsChipProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const me = findTeamMember(CURRENT_USER_ID);
  const stars = me?.starsThisWeek ?? 0;
  const myWeeklyCredits = me?.creditsThisWeek ?? 0;

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Layout + sizing tokens scaled to compact / non-compact.
  const containerClass = compact
    ? "grid grid-cols-2 gap-1.5"
    : "flex items-center gap-2 flex-wrap";
  const chipPadding = compact ? "px-2.5 py-1" : "px-3 py-1.5";
  const chipText    = compact ? "text-xs"     : "text-sm";
  const balanceText = compact ? "text-xs"     : "text-sm";
  const labelText   = compact ? "text-[10px]" : "text-xs";

  return (
    <div className="relative" ref={popoverRef}>
      <div className={containerClass}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white ${chipPadding} ${balanceText} font-medium text-slate-800 hover:bg-slate-50 transition-colors`}
          aria-haspopup="true"
          aria-expanded={open}
        >
          <span aria-hidden>💎</span>
          <span className="tabular-nums">{credits.toLocaleString()}</span>
          <span className="text-slate-500 font-normal">credits</span>
        </button>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full ${chipPadding} ${chipText}`}
          style={{ background: "var(--brand-amber-soft)", color: "var(--brand-amber-dark)" }}
        >
          <span aria-hidden>⭐</span>
          <span className="font-medium tabular-nums">{stars}</span>
          <span className={labelText}>stars this week</span>
        </span>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full ${chipPadding} ${chipText}`}
          style={{ background: "var(--brand-blue-soft)", color: "var(--brand-blue)" }}
        >
          <span aria-hidden>💎</span>
          <span className="font-medium tabular-nums">+{myWeeklyCredits}</span>
          <span className={labelText}>credits this week</span>
        </span>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full ${chipPadding} ${chipText}`}
          style={{ background: "var(--brand-red-soft)", color: "var(--brand-red)" }}
        >
          <span aria-hidden>🔥</span>
          <span className="font-medium tabular-nums">{MOCK_TEAM_REACTIONS_TODAY}</span>
          <span className={labelText}>reactions today</span>
        </span>
      </div>

      {open && (
        <div
          className={`absolute ${compact ? "left-0" : "right-0"} mt-2 w-80 rounded-2xl border border-slate-200 bg-white shadow-lg p-4 z-30`}
        >
          <p className="font-display font-bold text-slate-900 text-sm mb-2">Recent activity</p>
          <ul className="divide-y divide-slate-100">
            {MOCK_CREDIT_LEDGER.map((entry) => {
              const positive = entry.amount >= 0;
              return (
                <li key={entry.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-700 truncate">{entry.reason}</p>
                    <p className="text-xs text-slate-400">{entry.timeAgo}</p>
                  </div>
                  <span
                    className={`font-medium tabular-nums ml-3 ${
                      positive ? "text-emerald-600" : "text-slate-400"
                    }`}
                  >
                    {positive ? "+" : ""}
                    {entry.amount}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
