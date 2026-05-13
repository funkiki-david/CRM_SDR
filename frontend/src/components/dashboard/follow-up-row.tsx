/**
 * FollowUpRow — single follow-up entry in a bucket.
 *
 * Visual:
 *   ┌─[3px red stripe if isOverdue]──────────────────────────────────────┐
 *   │ Contact Name                                         time-tag       │
 *   │ Assignee · last activity date type · "last note excerpt"            │
 *   │                                            View detail →  [⋯]      │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * The ⋯ dropdown offers: Mark done · Snooze 3 days · Close follow-up
 * (Close = stop bugging me; keeps Lead Active.)
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FollowUp } from "./types";

interface Props {
  item: FollowUp;
  isOverdue: boolean;
  onDone: () => void;
  onSnooze: (days: number) => void;
  onClose: () => void;
}

function activityTypeLabel(t: string | null): string {
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function timeLabel(fu: FollowUp): string {
  if (!fu.follow_up_date) return "";
  const due = new Date(fu.follow_up_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (dueDay.getTime() - today.getTime()) / 86_400_000
  );
  if (diffDays < 0) {
    const n = Math.abs(diffDays);
    return `overdue ${n}d`;
  }
  if (diffDays === 0) return "today";
  if (diffDays < 7) {
    return due.toLocaleDateString(undefined, { weekday: "short" });
  }
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function lastActivityShort(fu: FollowUp): string {
  if (!fu.last_activity_date) return "no prior contact";
  const days = fu.days_since_last_contact ?? 0;
  const type = activityTypeLabel(fu.last_activity_type);
  return `${days}d ago ${type}`.trim();
}

export default function FollowUpRow({
  item,
  isOverdue,
  onDone,
  onSnooze,
  onClose,
}: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const note =
    item.last_activity_content?.trim() ||
    item.last_activity_summary?.trim() ||
    item.follow_up_reason?.trim() ||
    "";

  const tLabel = timeLabel(item);

  return (
    <div className="flex">
      {isOverdue && (
        <div className="w-[3px] bg-red-500 shrink-0" aria-hidden />
      )}
      <div className="flex-1 min-w-0 px-4 py-3 hover:bg-slate-50 transition-colors">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[14px] font-semibold text-slate-900 truncate">
                {item.contact_name}
              </p>
              {tLabel && (
                <span
                  className={`text-[11px] font-medium ${
                    isOverdue ? "text-red-600" : "text-slate-500"
                  }`}
                >
                  {tLabel}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {item.owner_name && (
                <>
                  <span>{item.owner_name}</span>
                  <span className="text-slate-300"> · </span>
                </>
              )}
              <span>{lastActivityShort(item)}</span>
              {note && (
                <>
                  <span className="text-slate-300"> · </span>
                  <span className="italic">&ldquo;{note}&rdquo;</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 relative" ref={menuRef}>
            {item.contact_id != null && (
              <button
                type="button"
                onClick={() => router.push(`/contacts?id=${item.contact_id}`)}
                className="text-blue-600 hover:underline text-[14px]"
              >
                View detail →
              </button>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More actions"
              className="text-slate-500 hover:text-slate-900 text-base leading-none w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-slate-100"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 z-10 w-44 rounded-xl border border-slate-200 bg-white shadow-lg py-1">
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onDone();
                  }}
                >
                  ✓ Mark done
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onSnooze(3);
                  }}
                >
                  ⏰ Snooze 3 days
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onClose();
                  }}
                  danger
                >
                  🔒 Close follow-up
                </MenuItem>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
        danger
          ? "text-slate-700 hover:bg-red-50 hover:text-red-700"
          : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
