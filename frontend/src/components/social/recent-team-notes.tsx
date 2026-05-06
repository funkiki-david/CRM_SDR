/**
 * RecentTeamNotes — Dashboard widget showing the latest internal notes
 * teammates have left across all contacts.
 *
 * This is the dashboard counterpart to the per-contact <TeamNotes> block.
 * Where TeamNotes shows notes for ONE contact (used inside Contact detail),
 * this component aggregates the most recent notes ACROSS contacts so the
 * user can scan team intel as soon as they log in.
 *
 * Data source is currently hard-coded mock (RECENT_TEAM_NOTES). Replace
 * with a real /api/team-notes/recent endpoint when notes graduate from
 * mockup to a backed feature.
 */
"use client";

import { useState } from "react";
import { RECENT_TEAM_NOTES } from "@/lib/social-mock";
import { findTeamMember } from "@/lib/team-mock";

const MAX_NOTES = 6;

export default function RecentTeamNotes() {
  const [collapsed, setCollapsed] = useState(false);

  const notes = RECENT_TEAM_NOTES.slice(0, MAX_NOTES);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="font-display font-bold text-slate-900" style={{ fontSize: 14 }}>
            Team Notes
          </h2>
          <p className="text-xs text-slate-500">Recent insights from your team</p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-full"
        >
          {collapsed ? "Expand ⌄" : "Collapse ⌃"}
        </button>
      </div>

      {!collapsed && (
        <ul className="divide-y divide-slate-100 px-2 pb-2">
          {notes.map((note) => {
            const author = findTeamMember(note.userId);
            return (
              <li
                key={note.id}
                className="px-2.5 py-2 hover:bg-slate-50 rounded-lg transition-colors"
              >
                <div className="flex items-start gap-2.5">
                  <Avatar member={author} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-snug">
                      <span className="font-medium text-slate-800">
                        {author?.name ?? "Someone"}
                      </span>
                      <span className="text-slate-500"> · on </span>
                      <span className="font-medium text-blue-600 hover:underline cursor-default">
                        {note.contactName}
                      </span>
                      <span className="text-[10px] text-slate-400 ml-1.5">
                        · {note.timeAgo}
                      </span>
                    </p>
                    <p className="text-xs text-slate-700 mt-1 leading-snug line-clamp-2 italic">
                      &ldquo;{note.text}&rdquo;
                    </p>
                    <div className="mt-1.5 flex items-center gap-3">
                      <span className="text-[10px] text-slate-500 inline-flex items-center gap-0.5">
                        <span aria-hidden>🔥</span>
                        <span className="tabular-nums">{note.reactions["🔥"]}</span>
                      </span>
                      <span className="text-[10px] text-slate-500 inline-flex items-center gap-0.5">
                        <span aria-hidden>👊</span>
                        <span className="tabular-nums">{note.reactions["👊"]}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Avatar({ member }: { member: ReturnType<typeof findTeamMember> }) {
  const initials = member?.initials ?? "??";
  const color = member?.color ?? "#94a3b8";
  return (
    <div
      className="flex items-center justify-center rounded-full text-white font-semibold shrink-0"
      style={{ width: 28, height: 28, fontSize: 11, background: color }}
      aria-hidden
    >
      {initials}
    </div>
  );
}
