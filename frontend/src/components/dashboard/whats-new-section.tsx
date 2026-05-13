/**
 * WhatsNewSection — unread @mention inbox at the top of the dashboard.
 *
 * Hidden entirely when mentions is empty (no "Inbox zero" header noise).
 * Each row shows:
 *   - Author avatar (deterministic color from user id)
 *   - "Author commented on your {activity_type} w/ {contact_name}"
 *   - Quoted comment text (truncated to 2 lines)
 *   - Time + "View detail →" link (deep-link to contact page)
 *   - ✕ Dismiss button (calls onDismiss)
 */
"use client";

import { useRouter } from "next/navigation";
import type { Mention } from "./types";

interface Props {
  mentions: Mention[];
  onDismiss: (commentId: number) => void;
}

const AVATAR_PALETTE = [
  "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899", "#f97316",
  "#10b981", "#14b8a6", "#f59e0b", "#ef4444", "#3b82f6",
];

function avatarColor(userId: number | null): string {
  if (userId == null) return "#94a3b8";
  return AVATAR_PALETTE[Math.abs(userId) % AVATAR_PALETTE.length];
}

function initials(name: string | null): string {
  if (!name) return "??";
  return name
    .split(" ")
    .filter(Boolean)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function WhatsNewSection({ mentions, onDismiss }: Props) {
  const router = useRouter();
  if (mentions.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white mb-6">
      <header className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-900">
          What&apos;s new for you
        </h2>
        <span className="inline-flex items-center justify-center rounded-full bg-blue-600 text-white text-[10px] font-semibold min-w-[20px] h-5 px-1.5">
          {mentions.length}
        </span>
      </header>

      <ul className="divide-y divide-slate-100">
        {mentions.map((m) => (
          <li key={m.id} className="px-5 py-3 flex items-start gap-3">
            <div
              className="flex items-center justify-center rounded-full text-white font-semibold shrink-0"
              style={{
                width: 32,
                height: 32,
                fontSize: 11,
                background: avatarColor(m.author.id),
              }}
              aria-hidden
            >
              {initials(m.author.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-700">
                <span className="font-medium text-slate-900">
                  {m.author.name ?? "(deleted user)"}
                </span>{" "}
                commented on your{" "}
                <span className="text-slate-700">
                  {m.activity_type ?? "activity"}
                </span>
                {m.contact_name && (
                  <>
                    {" w/ "}
                    <span className="font-medium text-slate-900">
                      {m.contact_name}
                    </span>
                  </>
                )}
              </p>
              <blockquote className="mt-1 border-l-2 border-slate-200 pl-3 text-sm italic text-slate-600 line-clamp-2">
                {m.comment_text}
              </blockquote>
              <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                <span>{timeAgo(m.created_at)}</span>
                {m.contact_id != null && (
                  <button
                    type="button"
                    onClick={() => router.push(`/contacts?id=${m.contact_id}`)}
                    className="text-blue-600 hover:underline"
                  >
                    View detail →
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(m.id)}
              aria-label="Dismiss"
              className="shrink-0 text-slate-400 hover:text-slate-700 text-lg leading-none px-1"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
