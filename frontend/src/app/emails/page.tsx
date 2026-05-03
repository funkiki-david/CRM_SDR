/**
 * Emails Page — unified inbox + sent list.
 *
 * Two-pane layout: left list (40%) / right detail (60%).
 *   - Tabs: Inbox / Sent / All
 *   - Search: subject / from / to
 *   - Sync Inbox button: POST /api/emails/sync to pull IMAP
 *   - Click a list item → load full message on the right
 *   - Reply button: opens EmailCompose pre-filled with To and Re: subject
 */
"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import AppShell from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emailsApi } from "@/lib/api";
import EmailCompose from "@/components/email-compose";

interface MessageListItem {
  id: number;
  direction: "sent" | "received";
  subject: string;
  from_email: string | null;
  to_email: string;
  contact_id: number | null;
  email_account_id: number | null;
  status: string;
  is_read: boolean;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
  snippet: string;
}

interface MessageDetail extends MessageListItem {
  body: string;
  body_html: string;
  message_id: string | null;
  in_reply_to: string | null;
}

type Tab = "inbox" | "sent" | "all";
const TAB_TO_DIRECTION: Record<Tab, "received" | "sent" | "all"> = {
  inbox: "received",
  sent: "sent",
  all: "all",
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EmailsInner() {
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [counts, setCounts] = useState({ sent: 0, received: 0, all: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Reply dialog
  const [replyOpen, setReplyOpen] = useState(false);

  const loadList = useCallback(async (t: Tab, term: string) => {
    setLoading(true);
    try {
      const data = await emailsApi.listMessages({
        direction: TAB_TO_DIRECTION[t],
        search: term.trim() || undefined,
        limit: 100,
      });
      setMessages(data.messages || []);
      setCounts(data.counts || { sent: 0, received: 0, all: 0 });
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadList(tab, search), 200);
    return () => clearTimeout(t);
  }, [tab, search, loadList]);

  const openMessage = useCallback(async (id: number) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const data = await emailsApi.getMessage(id);
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const data = await emailsApi.syncInbox();
      const nNew = data.new_emails ?? 0;
      const nSkipped = data.skipped ?? 0;
      setSyncResult({
        ok: true,
        msg: `✓ ${nNew} new email${nNew !== 1 ? "s" : ""} synced (${nSkipped} already in sync)`,
      });
      await loadList(tab, search);
    } catch (e) {
      setSyncResult({
        ok: false,
        msg: e instanceof Error ? e.message : "Sync failed",
      });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 5000);
    }
  }, [tab, search, loadList]);

  const replySubject = detail
    ? detail.subject.toLowerCase().startsWith("re:")
      ? detail.subject
      : `Re: ${detail.subject}`
    : "";

  const canReply = Boolean(
    detail && detail.contact_id !== null && (detail.from_email || detail.to_email)
  );

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1
            className="font-display font-bold"
            style={{ fontSize: 28, color: "var(--text-primary)" }}
          >
            Emails
          </h1>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? "Syncing inbox..." : "Sync Inbox"}
          </Button>
        </div>

        {/* Phase D: SMTP-paused banner — amber-light. Always visible
            because every Reply/Forward in the app is currently disabled. */}
        <div
          className="rounded-xl px-5 py-3.5 flex items-start gap-3 flex-wrap"
          style={{
            background: "var(--brand-amber-soft)",
            border: "1px solid var(--brand-amber)",
            color: "var(--brand-amber-dark)",
          }}
        >
          <div className="flex-1 min-w-0 text-sm">
            <strong>Email sending is paused</strong> — SMTP unavailable on
            Railway. You can still view inbox + log emails from the contact
            page; replies need to come from your own Gmail for now.
          </div>
          <button
            onClick={() => alert(
              "Email sending is paused while we evaluate Resend / Gmail OAuth as " +
              "alternatives. Inbound IMAP sync continues to work; outbound " +
              "everything stays disabled until we ship one of those."
            )}
            className="text-xs px-3 py-1 rounded-full"
            style={{
              background: "var(--bg-card)",
              color: "var(--brand-amber-dark)",
              border: "1px solid var(--brand-amber)",
            }}
          >
            Learn more
          </button>
        </div>

        {/* Sync toast */}
        {syncResult && (
          <div
            className={`p-2 rounded-lg border text-sm ${
              syncResult.ok
                ? "bg-green-50 border-green-200 text-green-700"
                : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            {syncResult.msg}
          </div>
        )}

        {/* Tabs + search */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1.5">
            {(["all", "sent", "inbox"] as Tab[]).map((t) => {
              const active = tab === t;
              // "Drafts" tab is in the spec but no draft data exists yet
              // (sent_emails has status=draft column but no draft creation
              // path while email is frozen). Surface "All / Sent / Inbox"
              // for now; Drafts will land once compose is unfrozen.
              const label =
                t === "inbox"
                  ? `Inbox (${counts.received})`
                  : t === "sent"
                  ? `Sent (${counts.sent})`
                  : `All (${counts.all})`;
              return (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t);
                    setSelectedId(null);
                    setDetail(null);
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium border transition-colors ${
                    active ? "" : "hover:border-slate-400"
                  }`}
                  style={
                    active
                      ? {
                          background: "var(--brand-blue)",
                          color: "#fff",
                          borderColor: "var(--brand-blue)",
                        }
                      : {
                          background: "var(--bg-card)",
                          color: "var(--text-secondary)",
                          borderColor: "var(--border-strong)",
                        }
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject / from / to..."
            className="h-9 flex-1 min-w-[200px]"
          />
        </div>

        {/* Two-pane layout */}
        <div className="flex border border-gray-200 rounded-md overflow-hidden h-[calc(100vh-230px)] min-h-[400px]">
          {/* Left: list */}
          <div className="w-2/5 border-r border-gray-200 overflow-y-auto">
            {loading ? (
              <p className="text-sm text-gray-400 p-4">Loading...</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-gray-400 p-4">
                No emails yet. {tab === "inbox" && "Click Sync Inbox to pull from Gmail."}
              </p>
            ) : (
              messages.map((m) => (
                <button
                  key={m.id}
                  onClick={() => openMessage(m.id)}
                  className={`w-full text-left p-3 border-b border-gray-100 transition-colors ${
                    selectedId === m.id
                      ? "bg-gray-100"
                      : "hover:bg-gray-50"
                  } ${m.direction === "received" && !m.is_read ? "bg-blue-50/40" : ""}`}
                >
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="text-base">
                      {m.direction === "sent" ? (
                        <span className="text-green-600">📤</span>
                      ) : (
                        <span className="text-blue-600">📥</span>
                      )}
                    </span>
                    <span>
                      {formatTimestamp(
                        m.direction === "sent" ? m.sent_at : m.received_at || m.created_at
                      )}
                    </span>
                    {m.direction === "received" && !m.is_read && (
                      <span className="ml-auto text-[10px] bg-blue-600 text-white rounded-full px-1.5 py-0.5">
                        new
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {m.direction === "sent"
                      ? `To: ${m.to_email}`
                      : `From: ${m.from_email ?? "unknown"}`}
                  </p>
                  <p className="text-sm font-medium text-gray-900 mt-0.5 truncate">
                    {m.subject || "(no subject)"}
                  </p>
                </button>
              ))
            )}
          </div>

          {/* Right: detail */}
          <div className="w-3/5 overflow-y-auto">
            {selectedId === null ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                Select an email to view details
              </div>
            ) : detailLoading ? (
              <p className="text-sm text-gray-400 p-4">Loading...</p>
            ) : detail === null ? (
              <p className="text-sm text-red-500 p-4">Failed to load message.</p>
            ) : (
              <div className="p-6 space-y-4">
                <div>
                  <h2
                    className="font-display font-bold"
                    style={{ fontSize: 20, color: "var(--text-primary)" }}
                  >
                    {detail.subject || "(no subject)"}
                  </h2>
                  <div className="mt-2 text-sm text-gray-600 space-y-0.5">
                    <p>
                      <span className="text-gray-400">From:</span>{" "}
                      {detail.from_email ?? "(unknown)"}
                    </p>
                    <p>
                      <span className="text-gray-400">To:</span> {detail.to_email}
                    </p>
                    <p>
                      <span className="text-gray-400">Date:</span>{" "}
                      {formatTimestamp(
                        detail.direction === "sent"
                          ? detail.sent_at
                          : detail.received_at || detail.created_at
                      )}
                    </p>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-4">
                  {detail.body_html ? (
                    <div
                      className="text-sm text-gray-800 leading-relaxed prose prose-sm max-w-none"
                      /* eslint-disable-next-line react/no-danger */
                      dangerouslySetInnerHTML={{ __html: detail.body_html }}
                    />
                  ) : (
                    <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans">
                      {detail.body}
                    </pre>
                  )}
                </div>

                <div className="flex gap-2 pt-3 border-t border-gray-100">
                  <Button
                    size="sm"
                    disabled
                    title="Email sending paused"
                    className="cursor-not-allowed bg-slate-100 text-slate-400 hover:bg-slate-100"
                  >
                    Reply
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    title="Email sending paused"
                  >
                    Forward
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reply dialog */}
      {detail && detail.contact_id && (
        <EmailCompose
          open={replyOpen}
          onClose={() => setReplyOpen(false)}
          contactId={detail.contact_id}
          contactName={detail.from_email ?? detail.to_email}
          contactEmail={detail.direction === "received" ? detail.from_email : detail.to_email}
          initialSubject={replySubject}
          initialBody={`\n\n---\nOn ${formatTimestamp(
            detail.direction === "sent" ? detail.sent_at : detail.received_at
          )}, ${detail.from_email ?? "(unknown)"} wrote:\n\n${(detail.body || "").split("\n").map(l => `> ${l}`).join("\n")}`}
          onSuccess={() => {
            setReplyOpen(false);
            loadList(tab, search);
          }}
        />
      )}
    </AppShell>
  );
}

export default function EmailsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading...</div>}>
      <EmailsInner />
    </Suspense>
  );
}
