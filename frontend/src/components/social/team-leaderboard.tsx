/**
 * TeamLeaderboard — small "this week" ranking card for the dashboard
 * right column. Pure read-only render of TEAM_MEMBERS, sorted by stars
 * (tiebreak: weekly credits).
 */
"use client";

import { TEAM_MEMBERS } from "@/lib/team-mock";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function TeamLeaderboard() {
  const ranked = [...TEAM_MEMBERS].sort((a, b) => {
    if (b.starsThisWeek !== a.starsThisWeek) {
      return b.starsThisWeek - a.starsThisWeek;
    }
    return b.creditsThisWeek - a.creditsThisWeek;
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      <h2 className="font-display font-bold text-slate-900" style={{ fontSize: 18 }}>
        This week&apos;s leaderboard
      </h2>
      <p className="text-sm text-slate-500 mb-3">Ranked by stars received</p>
      <ul className="space-y-2">
        {ranked.map((m, i) => {
          const medal = MEDALS[i] ?? "  ";
          return (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-slate-50 transition-colors"
            >
              <span className="w-6 text-center text-base" aria-hidden>{medal}</span>
              <div
                className="flex items-center justify-center rounded-full text-white font-semibold shrink-0"
                style={{ width: 28, height: 28, fontSize: 11, background: m.color }}
                aria-hidden
              >
                {m.initials}
              </div>
              <span className="flex-1 text-sm font-medium text-slate-800">{m.name}</span>
              <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                <span aria-hidden>⭐</span>
                <span className="tabular-nums font-medium text-slate-700">{m.starsThisWeek}</span>
              </span>
              <span className="text-xs text-slate-500 inline-flex items-center gap-1 ml-2">
                <span aria-hidden>💎</span>
                <span className="tabular-nums font-medium text-slate-700">+{m.creditsThisWeek}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
