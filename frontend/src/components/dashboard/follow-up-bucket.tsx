/**
 * FollowUpBucket — collapsible time-grouped section in the Follow-ups area.
 *
 * One of: "Overdue" / "Today" / "This week" / "Later this month".
 * Default open vs closed is decided by the parent (Overdue + Today open).
 *
 * Shows the first 10 rows; if more, a "+ N more · view all →" link.
 * (View-all navigates to a contacts-list with status filter — TBD.)
 */
"use client";

import { useState } from "react";
import type { FollowUp } from "./types";
import FollowUpRow from "./follow-up-row";

interface Props {
  title: string;
  items: FollowUp[];
  defaultOpen: boolean;
  isOverdue?: boolean;
  onDone: (item: FollowUp) => void;
  onSnooze: (item: FollowUp, days: number) => void;
  onClose: (item: FollowUp) => void;
}

const INITIAL_LIMIT = 10;

export default function FollowUpBucket({
  title,
  items,
  defaultOpen,
  isOverdue = false,
  onDone,
  onSnooze,
  onClose,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  if (items.length === 0) return null;

  const visible = items.slice(0, INITIAL_LIMIT);
  const hiddenCount = items.length - visible.length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white mb-3 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span
            className={`text-sm font-semibold ${
              isOverdue ? "text-red-600" : "text-slate-900"
            }`}
          >
            {title}
          </span>
          <span
            className={`rounded-full text-[11px] font-semibold px-2 py-0.5 ${
              isOverdue
                ? "bg-red-100 text-red-700"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {items.length}
          </span>
        </span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-100">
          {visible.map((item) => (
            <FollowUpRow
              key={String(item.lead_id)}
              item={item}
              isOverdue={isOverdue && item.urgency === "overdue"}
              onDone={() => onDone(item)}
              onSnooze={(d) => onSnooze(item, d)}
              onClose={() => onClose(item)}
            />
          ))}
          {hiddenCount > 0 && (
            <p className="px-5 py-3 text-xs text-slate-500 border-t border-slate-100">
              + {hiddenCount} more —{" "}
              <a className="text-blue-600 hover:underline" href="/contacts">
                view all →
              </a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
