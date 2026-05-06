/**
 * TeamNotes — internal "Slack-style" notes pinned to a contact.
 *
 * Read > write: the notes list is always expanded so teammates can scan
 * intel at a glance. The compose box is hidden behind a "+ Add note"
 * toggle to keep the card compact.
 *
 * 2026-05-06 overhaul: removed emoji-reaction strip and Send-credits
 * button (gamification stays on Dashboard); shrunk avatars / type;
 * added inline edit-your-own with Save/Cancel.
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

interface TeamNotesProps {
  contactId: number;
}

/** reactions field is preserved on the data structure for future restoration,
 *  but no UI renders it any more. Use this when we mint a fresh note. */
function emptyReactionMap(): Record<ReactionEmoji, number[]> {
  return REACTION_EMOJIS.reduce((acc, e) => {
    acc[e] = [];
    return acc;
  }, {} as Record<ReactionEmoji, number[]>);
}

export default function TeamNotes({ contactId }: TeamNotesProps) {
  const seed = MOCK_TEAM_NOTES[contactId] ?? DEFAULT_TEAM_NOTES_SEED;
  const [notes, setNotes] = useState<TeamNote[]>(() =>
    seed.map((n) => ({ ...n, reactions: { ...n.reactions } }))
  );
  const [draft, setDraft] = useState("");
  const [inputOpen, setInputOpen] = useState(false);
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
    setInputOpen(false);
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
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2
            className="font-display font-bold text-slate-900"
            style={{ fontSize: 14 }}
          >
            Team Notes ({notes.length})
          </h2>
          <p className="text-xs text-slate-500">Internal — only your team can see these</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setInputOpen((v) => !v);
            if (inputOpen) setDraft("");
          }}
          className="text-xs font-medium px-3 py-1 rounded-full border border-slate-300 hover:bg-slate-50"
        >
          {inputOpen ? "Cancel" : "+ Add note"}
        </button>
      </div>

      {inputOpen && (
        <div className="mb-3 flex items-start gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                postNote();
              }
            }}
            placeholder="Drop a tip for your teammates…"
            rows={2}
            autoFocus
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <button
            type="button"
            onClick={postNote}
            disabled={!draft.trim()}
            className="rounded-full px-3 py-1.5 text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            Post
          </button>
        </div>
      )}

      {notes.length === 0 ? (
        <p className="text-xs text-slate-400 italic py-4 text-center">
          No team notes yet. Drop the first tip above.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {notes.map((note) => {
            const author = findTeamMember(note.userId);
            const isMine = note.userId === CURRENT_USER_ID;
            const isEditing = editingId === note.id;
            return (
              <li key={note.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start gap-2.5">
                  <Avatar member={author} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs">
                      <span className="font-medium text-slate-800">
                        {author?.name ?? "Someone"}
                      </span>
                      <span className="text-slate-500"> · {note.createdAt}</span>
                      {isMine && !isEditing && (
                        <button
                          type="button"
                          onClick={() => startEdit(note)}
                          className="ml-2 text-[10px] text-slate-500 hover:text-slate-700 underline"
                        >
                          Edit
                        </button>
                      )}
                    </p>
                    {isEditing ? (
                      <div className="mt-1 flex items-start gap-2">
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={2}
                          autoFocus
                          className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                        <button
                          type="button"
                          onClick={saveEdit}
                          className="rounded-full px-2.5 py-1 text-[10px] font-medium bg-slate-900 text-white hover:bg-slate-800"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingId(null); setEditDraft(""); }}
                          className="rounded-full px-2.5 py-1 text-[10px] font-medium border border-slate-300 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-700 mt-0.5 whitespace-pre-wrap">
                        {note.text}
                      </p>
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
