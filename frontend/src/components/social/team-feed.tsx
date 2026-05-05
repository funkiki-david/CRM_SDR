/**
 * TeamFeed — Dashboard real-time activity stream.
 *
 * Renders the mock feed events with one-click emoji reactions and a
 * "Send credits" hook. The hook is optional so the component is usable
 * before the Send-Credits modal is wired (Commit 5).
 */
"use client";

import { useState } from "react";
import {
  MOCK_FEED_EVENTS,
  REACTION_EMOJIS,
  type ReactionEmoji,
} from "@/lib/social-mock";
import { findTeamMember } from "@/lib/team-mock";
import EmojiBar from "./emoji-bar";

interface TeamFeedProps {
  /** Optional — if provided, each row gets a "Send credits" button. */
  onSendCredits?: (recipientUserId: number) => void;
}

export default function TeamFeed({ onSendCredits }: TeamFeedProps) {
  const [collapsed, setCollapsed] = useState(false);
  // eventId → counts (mutated by toggle)
  const [counts, setCounts] = useState<Record<number, Record<ReactionEmoji, number>>>(
    () => {
      const out: Record<number, Record<ReactionEmoji, number>> = {};
      for (const e of MOCK_FEED_EVENTS) out[e.id] = { ...e.reactions };
      return out;
    }
  );
  // eventId → set of emojis the current user has tapped
  const [myReactions, setMyReactions] = useState<Record<number, Set<ReactionEmoji>>>(
    () => {
      const out: Record<number, Set<ReactionEmoji>> = {};
      for (const e of MOCK_FEED_EVENTS) out[e.id] = new Set();
      return out;
    }
  );

  function toggleReaction(eventId: number, emoji: ReactionEmoji) {
    setMyReactions((prev) => {
      const next = { ...prev };
      const set = new Set(next[eventId] ?? []);
      const wasOn = set.has(emoji);
      if (wasOn) set.delete(emoji); else set.add(emoji);
      next[eventId] = set;
      return next;
    });
    setCounts((prev) => {
      const next = { ...prev };
      const row = { ...(next[eventId] ?? makeZero()) };
      const wasOn = (myReactions[eventId] ?? new Set()).has(emoji);
      row[emoji] = Math.max(0, (row[emoji] ?? 0) + (wasOn ? -1 : 1));
      next[eventId] = row;
      return next;
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="font-display font-bold text-slate-900" style={{ fontSize: 14 }}>
            Team Feed
          </h2>
          <p className="text-xs text-slate-500">What your team&apos;s doing right now</p>
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
          {MOCK_FEED_EVENTS.map((event) => {
            const member = findTeamMember(event.userId);
            return (
              <li key={event.id} className="px-2.5 py-2 hover:bg-slate-50 rounded-lg transition-colors">
                <div className="flex items-start gap-2.5">
                  <Avatar member={member} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-800 leading-snug">
                      <span className="font-medium">{member?.name ?? "Someone"}</span>
                      <span className="text-slate-600"> {event.verb} </span>
                      <span className="font-medium text-slate-900">{event.target}</span>
                      <span className="text-[10px] text-slate-400 ml-1.5">· {event.timeAgo}</span>
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
                      <EmojiBar
                        counts={counts[event.id] ?? makeZero()}
                        active={myReactions[event.id] ?? new Set()}
                        onToggle={(emoji) => toggleReaction(event.id, emoji)}
                      />
                      {onSendCredits && member && (
                        <button
                          type="button"
                          onClick={() => onSendCredits(member.id)}
                          className="rounded-full px-2 py-0.5 text-[10px] font-medium border border-slate-200 hover:bg-slate-100 text-slate-700 inline-flex items-center gap-0.5"
                        >
                          <span aria-hidden>💎</span> Send credits
                        </button>
                      )}
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

function makeZero(): Record<ReactionEmoji, number> {
  return REACTION_EMOJIS.reduce((acc, e) => {
    acc[e] = 0;
    return acc;
  }, {} as Record<ReactionEmoji, number>);
}
