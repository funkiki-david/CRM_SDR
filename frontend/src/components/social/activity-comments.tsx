/**
 * ActivityComments — social toolbar that hangs off each activity in the
 * Contact timeline.
 *
 * Mixed mockup + real:
 *  - Stars (⭐⭐⭐⭐⭐) and 5-emoji reactions stay mockup state (resets on refresh)
 *  - Comments are backed by real DB rows via activityCommentsApi
 *
 * Permissions on comments:
 *  - Author can Edit + Delete own comment
 *  - Admin can Delete anyone's comment
 *  - Stars / emoji reactions still let everyone toggle their own (in-memory)
 *
 * Mock activities (id < 0) bypass the real API — comment input is hidden so
 * users don't try to comment on rows that don't exist server-side.
 */
"use client";

import { useEffect, useState } from "react";
import {
  MOCK_ACTIVITY_SOCIAL,
  REACTION_EMOJIS,
  type ActivitySocial,
  type ReactionEmoji,
} from "@/lib/social-mock";
import { CURRENT_USER_ID, findTeamMember } from "@/lib/team-mock";
import { activityCommentsApi, authApi, type ServerActivityComment } from "@/lib/api";
import EmojiBar from "./emoji-bar";
import StarRating from "./star-rating";

interface ActivityCommentsProps {
  activityId: number;
  /** Optional — when provided, opens the Send-Credits modal. */
  onSendCredits?: (recipientUserId: number) => void;
}

interface CurrentUser {
  id: number;
  role: "admin" | "manager" | "sdr";
  full_name?: string;
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

function relativeTimeFromIso(iso: string): string {
  const date = new Date(iso);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default function ActivityComments({ activityId, onSendCredits }: ActivityCommentsProps) {
  // Mock-only rows have negative ids — they exist only in MOCK_TIMELINE_ACTIVITIES
  // and have no DB row to attach real comments to.
  const isMockActivity = activityId < 0;

  // ============== Stars + Emoji reactions: still pure frontend mockup ==============
  const seed = MOCK_ACTIVITY_SOCIAL[activityId] ?? emptyState();
  const [stars, setStars] = useState<number[]>(seed.stars);
  const [reactions, setReactions] = useState<Record<ReactionEmoji, number[]>>(seed.reactions);

  // ============== Comments: real-backed (when activityId is a real row) ==============
  // For mock rows we still seed from MOCK_ACTIVITY_SOCIAL so the demo timeline
  // looks lived-in, but no API calls fire.
  const [comments, setComments] = useState<ServerActivityComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(!isMockActivity);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  // ============== UI state ==============
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // ============== Current user (for edit/delete permission gating) ==============
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    authApi
      .getMe()
      .then((u: CurrentUser) => {
        if (!cancelled) setCurrentUser(u);
      })
      .catch(() => {
        // 401 already handled globally by request(); just leave currentUser null
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load comments from the API once on mount (skip for mock rows)
  useEffect(() => {
    if (isMockActivity) {
      // Mock rows don't have a DB row — skip API; we won't render the input
      // either, so the empty list is fine.
      setCommentsLoading(false);
      return;
    }
    let cancelled = false;
    setCommentsLoading(true);
    setCommentsError(null);
    activityCommentsApi
      .list(activityId)
      .then((data) => {
        if (!cancelled) setComments(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCommentsError(err instanceof Error ? err.message : "Failed to load comments");
        }
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, isMockActivity]);

  // ============== Stars / reaction toggles (mockup) ==============
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

  // ============== Comment handlers (real API) ==============
  async function postComment() {
    const text = draft.trim();
    if (!text || posting || isMockActivity) return;
    setPosting(true);
    setCommentsError(null);
    try {
      const created = await activityCommentsApi.create(activityId, text);
      setComments((prev) => [...prev, created]);
      setDraft("");
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }

  function startEdit(c: ServerActivityComment) {
    setEditingId(c.id);
    setEditDraft(c.text);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }

  async function saveEdit() {
    if (editingId === null) return;
    const text = editDraft.trim();
    if (!text) {
      cancelEdit();
      return;
    }
    try {
      const updated = await activityCommentsApi.update(editingId, text);
      setComments((prev) => prev.map((c) => (c.id === editingId ? updated : c)));
      cancelEdit();
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : "Failed to edit comment");
    }
  }

  async function deleteComment(commentId: number) {
    if (!confirm("Delete this comment? This cannot be undone.")) return;
    try {
      await activityCommentsApi.remove(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : "Failed to delete comment");
    }
  }

  // ============== Derived counts for top toolbar ==============
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
          {commentsLoading && (
            <p className="text-xs text-slate-400">Loading comments…</p>
          )}

          {commentsError && (
            <p className="text-xs text-red-600">{commentsError}</p>
          )}

          {comments.length > 0 && (
            <ul className="space-y-3">
              {comments.map((c) => (
                <CommentRow
                  key={c.id}
                  comment={c}
                  currentUser={currentUser}
                  isEditing={editingId === c.id}
                  editDraft={editDraft}
                  setEditDraft={setEditDraft}
                  onStartEdit={() => startEdit(c)}
                  onSaveEdit={saveEdit}
                  onCancelEdit={cancelEdit}
                  onDelete={() => deleteComment(c.id)}
                  onSendCredits={onSendCredits}
                />
              ))}
            </ul>
          )}

          {/* Compose box — hidden for mock activity rows since there's no
              DB row to attach a comment to. */}
          {!isMockActivity && (
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
                disabled={!draft.trim() || posting}
                className="rounded-full px-4 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {posting ? "Posting…" : "Post"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  currentUser,
  isEditing,
  editDraft,
  setEditDraft,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onSendCredits,
}: {
  comment: ServerActivityComment;
  currentUser: CurrentUser | null;
  isEditing: boolean;
  editDraft: string;
  setEditDraft: (v: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onSendCredits?: (recipientUserId: number) => void;
}) {
  // Try to colour the avatar from the team-mock roster so existing seed data
  // stays consistent. Falls back to a slate avatar for unknown users.
  const author = comment.user_id !== null ? findTeamMember(comment.user_id) : null;
  const initials = author?.initials ?? (comment.user_name ? comment.user_name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase() : "??");
  const color = author?.color ?? "#94a3b8";

  const isMine = currentUser !== null && comment.user_id === currentUser.id;
  const isAdmin = currentUser?.role === "admin";
  const canDelete = isMine || isAdmin;

  return (
    <li className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2">
      <div
        className="flex items-center justify-center rounded-full text-white font-semibold shrink-0"
        style={{ width: 28, height: 28, fontSize: 11, background: color }}
        aria-hidden
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap text-xs text-slate-500">
          <span className="font-medium text-slate-800">
            {comment.user_name ?? "(deleted user)"}
          </span>
          <span className="text-slate-400">· {relativeTimeFromIso(comment.created_at)}</span>
          {isMine && !isEditing && (
            <button
              type="button"
              onClick={onStartEdit}
              className="text-[10px] text-slate-500 hover:text-slate-700 underline"
            >
              Edit
            </button>
          )}
          {canDelete && !isEditing && (
            <button
              type="button"
              onClick={onDelete}
              className="text-[10px] text-red-500 hover:text-red-700 underline"
            >
              Delete
            </button>
          )}
        </div>

        {isEditing ? (
          <div className="mt-1 flex items-start gap-2">
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              rows={2}
              autoFocus
              className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="button"
              onClick={onSaveEdit}
              className="rounded-full px-3 py-1 text-xs font-medium bg-slate-900 text-white hover:bg-slate-800"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-full px-3 py-1 text-xs font-medium border border-slate-300 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap">{comment.text}</p>
        )}

        {/* Send credits button — only when handler provided + not your own comment */}
        {onSendCredits && comment.user_id !== null && comment.user_id !== currentUser?.id && !isEditing && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => onSendCredits(comment.user_id as number)}
              className="rounded-full px-2 py-0.5 text-[11px] font-medium border border-slate-200 hover:bg-slate-100 text-slate-700 inline-flex items-center gap-1"
            >
              <span aria-hidden>💎</span> Send credits
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
