/**
 * DashboardTopBar — greeting + compact stat line + My/All toggle + Refresh.
 *
 * Layout (one row, wraps on narrow screens):
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ Good morning, Doug                                                 │
 *   │ N contacts · N follow-ups · N overdue · Tue May 12 · 14:32         │
 *   │                                       [My][All]  [↻ Refresh]      │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Stats are derived from the FollowUpsResponse already in page state so this
 * component does not fetch anything on its own.
 */
"use client";

import type { CurrentUser, FollowUpsResponse, Scope } from "./types";

interface Props {
  user: CurrentUser | null;
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  onRefresh: () => void;
  followUps: FollowUpsResponse | null;
}

export default function DashboardTopBar({
  user,
  scope,
  onScopeChange,
  onRefresh,
  followUps,
}: Props) {
  const firstName = user?.full_name?.split(" ")[0] ?? "there";
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const followUpTotal = followUps?.total ?? 0;
  const overdue = followUps?.counts.overdue ?? 0;
  const uniqueContacts = followUps
    ? new Set(followUps.follow_ups.map((f) => f.contact_id).filter((id): id is number => id !== null)).size
    : 0;

  const todayLabel = now.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeLabel = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  const isAdmin = user?.role === "admin";

  return (
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1
          className="font-display font-bold text-slate-900 tracking-tight"
          style={{ fontSize: 30, lineHeight: 1.1 }}
        >
          {greeting}, {firstName}
        </h1>
        <p className="text-sm text-slate-500 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {uniqueContacts}{" "}
            {uniqueContacts === 1 ? "contact" : "contacts"}
          </span>
          <span className="text-slate-300">·</span>
          <span>
            {followUpTotal}{" "}
            {followUpTotal === 1 ? "follow-up" : "follow-ups"}
          </span>
          {overdue > 0 && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-red-600 font-medium">
                {overdue} overdue
              </span>
            </>
          )}
          <span className="text-slate-300">·</span>
          <span>{todayLabel}</span>
          <span className="text-slate-300">·</span>
          <span>{timeLabel}</span>
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="inline-flex rounded-full border border-slate-200 bg-white p-0.5 shadow-sm">
          <ToggleButton
            active={scope === "mine"}
            onClick={() => onScopeChange("mine")}
          >
            My customers
          </ToggleButton>
          <ToggleButton
            active={scope === "team"}
            onClick={() => onScopeChange("team")}
            disabled={!isAdmin}
            title={
              isAdmin
                ? undefined
                : "Admin only — your view is filtered to your own customers"
            }
          >
            All customers
          </ToggleButton>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <span aria-hidden>↻</span>
          Refresh
        </button>
      </div>
    </header>
  );
}

function ToggleButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:text-slate-900"
      } ${disabled ? "opacity-40 cursor-not-allowed hover:text-slate-600" : ""}`}
    >
      {children}
    </button>
  );
}
