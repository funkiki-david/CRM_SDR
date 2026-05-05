/**
 * ActivityComments — social toolbar that hangs off each activity in the
 * Contact timeline. Shows the 5-star "teammates loved this" cluster, an
 * emoji bar, and a collapsible comments list with an inline input.
 *
 * Pure mock — state lives in this component; resets on page refresh.
 */
"use client";

import { useState } from "react";
import {
  MOCK_ACTIVITY_SOCIAL,
  REACTION_EMOJIS,
  type ActivitySocial,
  type ActivityComment,
  type ReactionEmoji,
} from "@/lib/social-mock";
import { CURRENT_USER_ID, findTeamMember } from "@/lib/team-mock";
import EmojiBar from "./emoji-bar";
import StarRating from "./star-rating";

interface ActivityCommentsProps {
  activityId: number;
  /** Optional — when wired by Commit 5, opens the Send-Credits modal. */
  onSendCredits?: (recipientUserId: number) => void;
}

function emptyState(): ActivitySocial {
  return {
    stars: [],
    reactions: REACTION_EMOJIS.reduce((acc, e) => {
      acc[e] = [];
      return acc;
    }, {} as Record<ReactionEmoji, number[]>),
    comments: [],
  };
}

export default function ActivityComments({ activityId, onSendCredits }: ActivityCommentsProps) {
  const seed = MOCK_ACTIVITY_SOCIAL[activityId] ?? emptyState();
  const [stars, setStars] = useState<number[]>(seed.stars);
  const [reactions, setReactions] = useState<Record<ReactionEmoji, number[]>>(seed.reactions);
  const [comments, setComments] = useState<ActivityComment[]>(seed.comments);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");

  function toggleStar() {
    setStars((prev) =>
      prev.includes(CURRENT_USER_ID)
        ? prev.filter((id) => id !== CURRENT_USER_ID)
        : [...prev, CURRENT_USER_ID]
    );
  }

  function toggleEmoji(emoji: ReactionEmoji) {
    setReactions((prev) => {
      const list = prev[emoji] ?? [];
      const next = list.includes(CURRENT_USER_ID)
        ? list.filter((id) => id !== CURRENT_USER_ID)
        : [...list, CURRENT_USER_ID];
      return { ...prev, [emoji]: next };
    });
  }

  function postComment() {
    const text = draft.trim();
    if (!text) return;
    const newComment: ActivityComment = {
      id: Date.now(),
      userId: CURRENT_USER_ID,
      text,
      timeAgo: "Just now",
      reactions: REACTION_EMOJIS.reduce((acc, e) => {
        acc[e] = [];
        return acc;
      }, {} as Record<ReactionEmoji, number[]>),
    };
    setComments((prev) => [...prev, newComment]);
    setDraft("");
  }

  function toggleCommentEmoji(commentId: number, emoji: ReactionEmoji) {
    setComments((prev) =>
      prev.map((c) => {
        if (c.id !== commentId) return c;
        const list = c.reactions[emoji] ?? [];
        const next = list.includes(CURRENT_USER_ID)
          ? list.filter((id) => id !== CURRENT_USER_ID)
          : [...list, CURRENT_USER_ID];
        return { ...c, reactions: { ...c.reactions, [emoji]: next } };
      })
    );
  }

  // Convert "userIds[] per emoji" → "count per emoji" for EmojiBar
  const counts = REACTION_EMOJIS.reduce((acc, e) => {
    acc[e] = (reactions[e] ?? []).length;
    return acc;
  }, {} as Record<ReactionEmoji, number>);

  const myReactions = new Set<ReactionEmoji>(
    REACTION_EMOJIS.filter((e) => (reactions[e] ?? []).includes(CURRENT_USER_ID))
  );

  return (
    <div className="border-t border-slate-200 mt-3 pt-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <StarRating starredBy={stars} onToggle={toggleStar} />
          <EmojiBar counts={counts} active={myReactions} onToggle={toggleEmoji} size="sm" />
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 px-2 py-0.5 rounded-full hover:bg-slate-100"
          >
            <span aria-hidden>💬</span>
            {comments.length} {comments.length === 1 ? "comment" : "comments"}
            <span className="text-slate-400">{expanded ? "⌃" : "⌄"}</span>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {comments.length > 0 && (
            <ul className="space-y-3">
              {comments.map((c) => (
                <CommentRow
                  key={c.id}
                  comment={c}
                  onToggleEmoji={(e) => toggleCommentEmoji(c.id, e)}
                  onSendCredits={onSendCredits}
                />
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  postComment();
                }
              }}
              placeholder="Add a comment..."
              rows={2}
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
            />
            <button
              type="button"
              onClick={postComment}
              disabled={!draft.trim()}
              className="rounded-full px-4 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              Post
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  onToggleEmoji,
  onSendCredits,
}: {
  comment: ActivityComment;
  onToggleEmoji: (emoji: ReactionEmoji) => void;
  onSendCredits?: (recipientUserId: number) => void;
}) {
  const author = findTeamMember(comment.userId);
  const counts = REACTION_EMOJIS.reduce((acc, e) => {
    acc[e] = (comment.reactions[e] ?? []).length;
    return acc;
  }, {} as Record<ReactionEmoji, number>);
  const mine = new Set<ReactionEmoji>(
    REACTION_EMOJIS.filter((e) => (comment.reactions[e] ?? []).includes(CURRENT_USER_ID))
  );

  return (
    <li className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2">
      <div
        className="flex items-center justify-center rounded-full text-white font-semibold shrink-0"
        style={{ width: 28, height: 28, fontSize: 11, background: author?.color ?? "#94a3b8" }}
        aria-hidden
      >
        {author?.initials ?? "??"}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500">
          <span className="font-medium text-slate-800">{author?.name ?? "Someone"}</span>
          <span className="ml-2">· {comment.timeAgo}</span>
        </p>
        <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap">{comment.text}</p>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <EmojiBar counts={counts} active={mine} onToggle={onToggleEmoji} size="sm" />
          {onSendCredits && author && comment.userId !== CURRENT_USER_ID && (
            <button
              type="button"
              onClick={() => onSendCredits(author.id)}
              className="rounded-full px-2 py-0.5 text-[11px] font-medium border border-slate-200 hover:bg-slate-100 text-slate-700 inline-flex items-center gap-1"
            >
              <span aria-hidden>💎</span> Send credits
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
