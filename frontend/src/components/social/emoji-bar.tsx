/**
 * EmojiBar — reusable horizontal strip of 5 reaction pills (🔥 👊 ⭐ 💪 🎯).
 *
 * Used in three places:
 *   - Team Feed event row
 *   - Activity timeline social toolbar
 *   - Comments and team notes
 *
 * The component is fully controlled — the parent owns the state and the
 * "did current user already react?" set. Click toggles the user's reaction
 * and adjusts the count by ±1.
 */
"use client";

import { REACTION_EMOJIS, type ReactionEmoji } from "@/lib/social-mock";

interface EmojiBarProps {
  /** emoji → current count */
  counts: Record<ReactionEmoji, number>;
  /** Set of emojis the current user has already reacted with. */
  active: Set<ReactionEmoji>;
  /** Called when a pill is clicked — parent toggles state. */
  onToggle: (emoji: ReactionEmoji) => void;
  /** Tighter sizing for inline use under comments. */
  size?: "sm" | "md";
}

export default function EmojiBar({
  counts,
  active,
  onToggle,
  size = "md",
}: EmojiBarProps) {
  const padding = size === "sm" ? "px-1.5 py-0.5" : "px-2 py-0.5";
  const text = size === "sm" ? "text-[11px]" : "text-xs";

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {REACTION_EMOJIS.map((emoji) => {
        const isActive = active.has(emoji);
        const count = counts[emoji] ?? 0;
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji)}
            className={`rounded-full ${padding} ${text} transition-colors flex items-center gap-1 border ${
              isActive
                ? "bg-blue-50 border-blue-200 text-blue-700"
                : "bg-slate-50 border-transparent hover:bg-slate-100 text-slate-600"
            }`}
            aria-pressed={isActive}
            aria-label={`React with ${emoji}`}
          >
            <span aria-hidden>{emoji}</span>
            {count > 0 && <span className="font-medium tabular-nums">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
