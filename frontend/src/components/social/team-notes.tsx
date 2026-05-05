/**
 * TeamNotes — internal "Slack-style" notes pinned to a contact. Only
 * teammates see them; reactions + edit-your-own + post a new one all
 * mocked in component state.
 */
"use client";

import { useState } from "react";
import {
  DEFAULT_TEAM_NOTES_SEED,
  MOCK_TEAM_NOTES,
  REACTION_EMOJIS,
  type ReactionEmoji,
  type TeamNote,
} from "@/lib/social-mock";
import { CURRENT_USER_ID, findTeamMember } from "@/lib/team-mock";
import EmojiBar from "./emoji-bar";

interface TeamNotesProps {
  contactId: number;
  /** Optional — wired by Commit 5 to the Send-Credits modal. */
  onSendCredits?: (recipientUserId: number) => void;
}

function emptyReactionMap(): Record<ReactionEmoji, number[]> {
  return REACTION_EMOJIS.reduce((acc, e) => {
    acc[e] = [];
    return acc;
  }, {} as Record<ReactionEmoji, number[]>);
}

export default function TeamNotes({ contactId, onSendCredits }: TeamNotesProps) {
  const seed = MOCK_TEAM_NOTES[contactId] ?? DEFAULT_TEAM_NOTES_SEED;
  const [notes, setNotes] = useState<TeamNote[]>(() => seed.map((n) => ({ ...n, reactions: { ...n.reactions } })));
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  function postNote() {
    const text = draft.trim();
    if (!text) return;
    const newNote: TeamNote = {
      id: Date.now(),
      userId: CURRENT_USER_ID,
      text,
      createdAt: "Just now",
      reactions: emptyReactionMap(),
    };
    setNotes((prev) => [newNote, ...prev]);
    setDraft("");
  }

  function toggleEmoji(noteId: number, emoji: ReactionEmoji) {
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id !== noteId) return n;
        const list = n.reactions[emoji] ?? [];
        const next = list.includes(CURRENT_USER_ID)
          ? list.filter((id) => id !== CURRENT_USER_ID)
          : [...list, CURRENT_USER_ID];
        return { ...n, reactions: { ...n.reactions, [emoji]: next } };
      })
    );
  }

  function startEdit(note: TeamNote) {
    setEditingId(note.id);
    setEditDraft(note.text);
  }

  function saveEdit() {
    if (editingId === null) return;
    const text = editDraft.trim();
    if (!text) {
      setEditingId(null);
      return;
    }
    setNotes((prev) =>
      prev.map((n) => (n.id === editingId ? { ...n, text } : n))
    );
    setEditingId(null);
    setEditDraft("");
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      <div className="mb-3">
        <h3 className="font-display font-bold text-slate-900" style={{ fontSize: 18 }}>
          Team Notes
        </h3>
        <p className="text-sm text-slate-500">
          Internal — only your team can see these
        </p>
      </div>

      {/* Compose box at the top */}
      <div className="mb-4 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              postNote();
            }
          }}
          placeholder="Drop a tip for your teammates..."
          rows={2}
          className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
        />
        <button
          type="button"
          onClick={postNote}
          disabled={!draft.trim()}
          className="rounded-full px-4 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          Post note
        </button>
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-slate-400 italic">
          No team notes yet. Drop the first tip above.
        </p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => {
            const author = findTeamMember(note.userId);
            const isMine = note.userId === CURRENT_USER_ID;
            const counts = REACTION_EMOJIS.reduce((acc, e) => {
              acc[e] = (note.reactions[e] ?? []).length;
              return acc;
            }, {} as Record<ReactionEmoji, number>);
            const mine = new Set<ReactionEmoji>(
              REACTION_EMOJIS.filter((e) => (note.reactions[e] ?? []).includes(CURRENT_USER_ID))
            );
            const isEditing = editingId === note.id;

            return (
              <li key={note.id} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="flex items-start gap-2">
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
                      <span className="ml-2">· {note.createdAt}</span>
                    </p>
                    {isEditing ? (
                      <div className="mt-1 flex items-end gap-2">
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={2}
                          autoFocus
                          className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                        />
                        <button
                          type="button"
                          onClick={saveEdit}
                          className="rounded-full px-3 py-1 text-xs font-medium bg-slate-900 text-white hover:bg-slate-800"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-full px-3 py-1 text-xs text-slate-500 hover:bg-slate-100"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap">
                        {note.text}
                      </p>
                    )}
                    {!isEditing && (
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <EmojiBar
                          counts={counts}
                          active={mine}
                          onToggle={(e) => toggleEmoji(note.id, e)}
                          size="sm"
                        />
                        {isMine && (
                          <button
                            type="button"
                            onClick={() => startEdit(note)}
                            className="rounded-full px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
                          >
                            Edit
                          </button>
                        )}
                        {!isMine && onSendCredits && author && (
                          <button
                            type="button"
                            onClick={() => onSendCredits(author.id)}
                            className="rounded-full px-2 py-0.5 text-[11px] font-medium border border-slate-200 hover:bg-slate-100 text-slate-700 inline-flex items-center gap-1"
                          >
                            <span aria-hidden>💎</span> Send credits
                          </button>
                        )}
                      </div>
                    )}
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
