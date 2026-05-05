/**
 * Dashboard — 2026 CRM layout.
 *
 * Layout:
 *   - Welcome header (Welcome back, David)
 *   - Quick Stats: 4 number cards (Contacts / Emails / Calls / Meetings)
 *   - 60/40 split:
 *       Left  (60%): Follow-Ups Needed + Activity Feed
 *       Right (40%): AI Suggested To-Do
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import QuickEntry from "@/components/quick-entry";
import EmailCompose from "@/components/email-compose";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { dashboardApi, activitiesApi, aiApi, authApi, tasksApi } from "@/lib/api";
import { useAIBudget } from "@/components/ai-budget";
import TeamFeed from "@/components/social/team-feed";
import CreditsChip from "@/components/social/credits-chip";
import TeamLeaderboard from "@/components/social/team-leaderboard";
import SendCreditsModal from "@/components/social/send-credits-modal";
import CreditsToast from "@/components/social/credits-toast";
import { findTeamMember, CURRENT_USER_ID } from "@/lib/team-mock";

// ==================== Types ====================

interface FollowUp {
  lead_id: number | string;     // backend may emit "task-N" for task rows
  contact_id: number;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  company: string | null;
  title: string | null;
  urgency: "overdue" | "today" | "upcoming";
  // Backend returns the lead's current LeadStatus value (e.g. "new",
  // "contacted", "interested", "meeting_set", "proposal", "closed_won",
  // "closed_lost") — used by Phase B for the status-grouped follow-ups.
  lead_status: string;
  follow_up_date: string | null;
  follow_up_reason: string | null;
  last_activity_date: string | null;
  last_activity_type: string | null;
  last_activity_summary: string | null;
  last_activity_content: string | null;
  days_since_last_contact: number | null;
  owner_name: string | null;
}

interface FollowUpsResponse {
  follow_ups?: FollowUp[];  // backend's flat list — used by status grouping
  grouped: { overdue: FollowUp[]; today: FollowUp[]; upcoming: FollowUp[] };
  counts: { overdue: number; today: number; upcoming: number };
  total: number;
}

interface ActivityItem {
  id: number;
  activity_type: string;
  subject: string | null;
  content: string | null;
  contact_id: number;
  contact_name: string | null;
  user_name: string | null;
  created_at: string;
}

interface QuickStats {
  total_contacts: number;
  emails_today: number;
  calls_today: number;
  meetings_this_week: number;
}

interface AISuggestion {
  rule_id: string;
  urgency: "high" | "medium" | "low";
  category: "pacing" | "stage" | "data_health" | "relationship" | "discipline";
  suggested_action: "call" | "email" | "linkedin" | "review";
  rationale: string;
  contact_id?: number | null;
}

interface AISuggestionsResponse {
  suggestions: AISuggestion[];
  message?: string;
  generated_at?: string;
  cached?: boolean;
}

// ==================== Helpers ====================

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function dateGroupLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - dd.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Monochrome unicode (not emoji) so CSS color (text-slate-400) actually applies.
// Emoji glyphs are rendered in their native color by the OS regardless of CSS.
const ACTIVITY_ICON: Record<string, string> = {
  call: "☎", email: "✉", linkedin: "in", meeting: "◆", note: "✎",
};

const ACTIVITY_VERB: Record<string, string> = {
  call: "Called", email: "Emailed", linkedin: "Messaged", meeting: "Met with", note: "Noted about",
};

// ==================== Main Page ====================

export default function DashboardPage() {
  const [currentUserName, setCurrentUserName] = useState("");
  const [stats, setStats] = useState<QuickStats | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpsResponse | null>(null);
  const [loadingFollowUps, setLoadingFollowUps] = useState(true);

  // Compose dialogs
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [emailComposeOpen, setEmailComposeOpen] = useState(false);
  const [emailContext, setEmailContext] = useState<{ id: number; name: string; email: string | null }>({
    id: 0, name: "", email: null,
  });

  // Social mockup — current user's virtual credit balance + Send-Credits state.
  const [myCredits, setMyCredits] = useState(
    () => findTeamMember(CURRENT_USER_ID)?.credits ?? 0
  );
  const [sendCreditsTo, setSendCreditsTo] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function handleSendCredits(recipientUserId: number, amount: number, message: string) {
    const recipient = findTeamMember(recipientUserId);
    setMyCredits((c) => c - amount);
    setSendCreditsTo(null);
    const msgFragment = message ? ` — "${message}"` : "";
    setToastMessage(`💎 Sent ${amount} credits to ${recipient?.name ?? "teammate"}${msgFragment}`);
  }

  const loadFollowUps = useCallback(async () => {
    setLoadingFollowUps(true);
    try {
      const data = await dashboardApi.getFollowUps() as FollowUpsResponse;
      setFollowUps(data);
    } catch {
      setFollowUps({ grouped: { overdue: [], today: [], upcoming: [] }, counts: { overdue: 0, today: 0, upcoming: 0 }, total: 0 });
    } finally {
      setLoadingFollowUps(false);
    }
  }, []);

  useEffect(() => {
    authApi.getMe().then((u: { full_name: string }) => setCurrentUserName(u.full_name)).catch(() => {});
    dashboardApi.getQuickStats().then(setStats).catch(() => {});
    loadFollowUps();
  }, [loadFollowUps]);

  const openEmail = (fu: FollowUp) => {
    setEmailContext({ id: fu.contact_id, name: fu.contact_name, email: fu.contact_email });
    setEmailComposeOpen(true);
  };

  // Phase B: dynamic greeting + subtitle
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = currentUserName ? currentUserName.split(" ")[0] : "there";
  const today = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const overdueCount = followUps?.counts?.overdue ?? 0;

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">
        {/* === Greeting header + Credits chip (Phase B + social mockup) === */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1
              className="font-display font-bold text-slate-900"
              style={{ fontSize: 32, lineHeight: 1.15 }}
            >
              {greeting}, {firstName}
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
              {today}
              {overdueCount > 0 && (
                <>
                  {" — You have "}
                  <span style={{ color: "var(--brand-red)", fontWeight: 600 }}>
                    {overdueCount} overdue follow-up{overdueCount === 1 ? "" : "s"}
                  </span>
                </>
              )}
            </p>
          </div>
          <CreditsChip credits={myCredits} />
        </div>

        {/* === Inline stat chips (Phase B) === */}
        <QuickStatsRow stats={stats} />

        {/* === 60 / 40 two-column === */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: 60% (3/5) — Follow-Ups + Team Feed + Activity Feed */}
          <div className="lg:col-span-3 space-y-6">
            <FollowUpsSection
              loading={loadingFollowUps}
              data={followUps}
              onRefresh={loadFollowUps}
              onEmail={openEmail}
            />
            <TeamFeed onSendCredits={(uid) => setSendCreditsTo(uid)} />
            <ActivityFeedSection />
          </div>

          {/* Right: 40% (2/5) — AI Suggested To-Do + Leaderboard */}
          <div className="lg:col-span-2 space-y-6">
            <AISuggestionsSection />
            <TeamLeaderboard />
          </div>
        </div>
      </div>

      {/* Quick action dialogs.
          (AddContact dialog removed in Phase B — the +Contact button was
          deleted from the dashboard header. AddContact still ships in
          /contacts/page.tsx where it belongs.) */}
      <QuickEntry
        open={quickEntryOpen}
        onClose={() => setQuickEntryOpen(false)}
        onSuccess={() => { setQuickEntryOpen(false); loadFollowUps(); }}
      />
      <EmailCompose
        open={emailComposeOpen}
        onClose={() => setEmailComposeOpen(false)}
        contactId={emailContext.id}
        contactName={emailContext.name}
        contactEmail={emailContext.email}
        onSuccess={() => setEmailComposeOpen(false)}
      />
      {/* Social mockup — single Send Credits modal serves Team Feed clicks */}
      <SendCreditsModal
        recipientUserId={sendCreditsTo}
        balance={myCredits}
        onSend={handleSendCredits}
        onClose={() => setSendCreditsTo(null)}
      />
      <CreditsToast message={toastMessage} onClose={() => setToastMessage(null)} />
    </AppShell>
  );
}

// ==================== StatCard + Quick Stats Row ====================

// Phase B: stat row collapsed from 5 big cards to inline pill chips.
// No icons (emoji or otherwise) — pure typography. Big number in Fraunces,
// label in DM Sans.

function StatChip({ value, label, valueColor }: {
  value: number | string;
  label: string;
  valueColor?: string;
}) {
  return (
    <div
      className="inline-flex items-baseline gap-1.5 rounded-full"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-faint)",
        padding: "6px 14px",
        fontSize: 13,
        color: "var(--text-secondary)",
      }}
    >
      <strong
        className="font-display"
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: valueColor ?? "var(--text-primary)",
        }}
      >
        {value}
      </strong>
      <span>{label}</span>
    </div>
  );
}

function AIBudgetChip() {
  const { usage } = useAIBudget();
  if (!usage) return <StatChip value="—" label="AI budget" />;
  if (usage.unlimited) return <StatChip value="∞" label="AI budget" />;
  const colour = usage.at_limit ? "var(--brand-red)" : undefined;
  return (
    <StatChip
      value={`$${usage.spent_today.toFixed(2)}`}
      label={`/ $${(usage.daily_limit ?? 0).toFixed(2)} AI budget`}
      valueColor={colour}
    />
  );
}

function QuickStatsRow({ stats }: { stats: QuickStats | null }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <StatChip value={stats?.total_contacts ?? "—"} label="contacts" />
      <StatChip value={stats?.emails_today ?? 0} label="emails today" />
      <StatChip value={stats?.calls_today ?? 0} label="calls today" />
      <StatChip value={stats?.meetings_this_week ?? 0} label="meetings this week" />
      <AIBudgetChip />
    </div>
  );
}

// ==================== Follow-Ups Needed (Phase B redesign) ====================
//
// Two grouping axes per the mockup spec:
//   - Time:    Overdue / Due today / This week / Coming up
//   - Status:  Waiting on reply / Sample sent / Hot leads / Price negotiation
// Time groups come from backend's `grouped.{overdue,today,upcoming}` field;
// "Coming up" is reserved for ≥ 8 days out (none in current backend output,
// so it stays empty until backend adds it). Status groups bucket the FLAT
// list by `lead_status` mapping below.
//
// Default expansion: only Overdue → top 3. Other groups collapsed.

interface TimeGroupStyle {
  key: "overdue" | "today" | "this_week" | "coming_up";
  label: string;
  stripe: string;       // 3px coloured stripe
  badgeBg: string;
  badgeFg: string;
}

const TIME_GROUPS: TimeGroupStyle[] = [
  { key: "overdue",   label: "Overdue",     stripe: "var(--brand-red)",   badgeBg: "var(--brand-red-soft)",   badgeFg: "var(--brand-red)" },
  { key: "today",     label: "Due today",   stripe: "var(--brand-amber)", badgeBg: "var(--brand-amber-soft)", badgeFg: "var(--brand-amber-dark)" },
  { key: "this_week", label: "This week",   stripe: "var(--brand-blue)",  badgeBg: "var(--brand-blue-soft)",  badgeFg: "var(--brand-blue)" },
  { key: "coming_up", label: "Coming up",   stripe: "var(--brand-green)", badgeBg: "var(--brand-green-soft)", badgeFg: "var(--brand-green)" },
];

interface StatusGroupStyle {
  key: string;          // backend lead_status value
  label: string;
  stripe: string;
  badgeBg: string;
  badgeFg: string;
}

// Mapping current 7-value LeadStatus → 4 mockup buckets (loose, will tighten
// after the activity-status dropdown produces real distribution data):
//   contacted    → Waiting on reply (we sent something, awaiting a reply)
//   interested   → Sample sent / engaged
//   meeting_set  → Hot leads (close to closing)
//   proposal     → Price negotiation
//
// Leads in NEW are intentionally excluded from the status section — they
// live in the "no contact yet" bucket at the top via stage_new_stuck_7d.
const STATUS_GROUPS: StatusGroupStyle[] = [
  { key: "contacted",   label: "Waiting on reply",     stripe: "var(--brand-amber)", badgeBg: "var(--brand-amber-soft)", badgeFg: "var(--brand-amber-dark)" },
  { key: "interested",  label: "Sample sent",          stripe: "var(--brand-blue)",  badgeBg: "var(--brand-blue-soft)",  badgeFg: "var(--brand-blue)" },
  { key: "meeting_set", label: "Hot leads",            stripe: "var(--brand-red)",   badgeBg: "var(--brand-red-soft)",   badgeFg: "var(--brand-red)" },
  { key: "proposal",    label: "Price negotiation",    stripe: "var(--brand-green)", badgeBg: "var(--brand-green-soft)", badgeFg: "var(--brand-green)" },
];

function FollowUpsSection({
  loading, data, onRefresh, onEmail,
}: {
  loading: boolean;
  data: FollowUpsResponse | null;
  onRefresh: () => void;
  onEmail: (fu: FollowUp) => void;
}) {
  // Expansion state: per-group key. Default is only "overdue" expanded
  // (with top 3 visible — `INITIAL_TOP=3` below).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ overdue: true });
  const [search, setSearch] = useState("");
  const INITIAL_TOP = 3;

  if (loading) {
    return (
      <Card><CardContent className="py-6 text-sm text-slate-400">Loading follow-ups…</CardContent></Card>
    );
  }

  const total = data?.total ?? 0;
  if (total === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          No follow-ups scheduled. Log an activity with a follow-up date to see it here.
        </CardContent>
      </Card>
    );
  }

  // Client-side text filter on contact name / company / activity content
  const filterFn = (f: FollowUp): boolean => {
    if (!search.trim()) return true;
    const term = search.trim().toLowerCase();
    return (
      (f.contact_name || "").toLowerCase().includes(term) ||
      (f.company || "").toLowerCase().includes(term) ||
      (f.last_activity_content || "").toLowerCase().includes(term) ||
      (f.last_activity_summary || "").toLowerCase().includes(term) ||
      (f.follow_up_reason || "").toLowerCase().includes(term)
    );
  };

  // Bucket time groups (overdue/today/upcoming come from backend; "coming_up"
  // is empty until backend exposes a 7+ day bucket).
  const flat: FollowUp[] = (data?.follow_ups ?? []).filter(filterFn);
  const timeBuckets: Record<string, FollowUp[]> = {
    overdue:   (data?.grouped.overdue ?? []).filter(filterFn),
    today:     (data?.grouped.today ?? []).filter(filterFn),
    this_week: (data?.grouped.upcoming ?? []).filter(filterFn),
    coming_up: [],
  };

  // Status buckets (cross-cuts the time groups — same row may appear once
  // here too if its lead_status maps to one of the 4 status groups).
  const statusBuckets: Record<string, FollowUp[]> = {};
  for (const sg of STATUS_GROUPS) statusBuckets[sg.key] = [];
  for (const f of flat) {
    if (statusBuckets[f.lead_status]) statusBuckets[f.lead_status].push(f);
  }

  const searchActive = search.trim().length > 0;
  const shownTotal = flat.length;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2
          className="font-display font-bold text-slate-900"
          style={{ fontSize: 22 }}
        >
          Follow-ups
        </h2>
        <span
          className="rounded-full"
          style={{
            background: "var(--brand-red-soft)",
            color: "var(--brand-red)",
            padding: "2px 10px",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {shownTotal} needed
        </span>
        <div className="relative flex-1 min-w-[180px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, company, or note..."
            className="h-8 text-xs pr-7"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {searchActive && shownTotal === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">
          No follow-ups match &ldquo;{search}&rdquo;.
        </p>
      ) : (
        <>
          {/* === Top: time-based groups === */}
          <div className="space-y-3 mb-5">
            {TIME_GROUPS.map((g) => (
              <FollowUpGroup
                key={g.key}
                groupKey={g.key}
                label={g.label}
                stripe={g.stripe}
                badgeBg={g.badgeBg}
                badgeFg={g.badgeFg}
                items={timeBuckets[g.key]}
                expanded={Boolean(expanded[g.key]) || searchActive}
                onToggle={() =>
                  setExpanded((prev) => ({ ...prev, [g.key]: !prev[g.key] }))
                }
                initialTop={INITIAL_TOP}
                onEmail={onEmail}
                onRefresh={onRefresh}
              />
            ))}
          </div>

          {/* Divider between time + status views */}
          <div
            className="my-5"
            style={{ borderTop: "1px solid var(--border-faint)" }}
          />

          {/* === Bottom: status-based groups === */}
          <div className="space-y-3">
            {STATUS_GROUPS.map((g) => (
              <FollowUpGroup
                key={g.key}
                groupKey={g.key}
                label={g.label}
                stripe={g.stripe}
                badgeBg={g.badgeBg}
                badgeFg={g.badgeFg}
                items={statusBuckets[g.key]}
                expanded={Boolean(expanded[g.key]) || searchActive}
                onToggle={() =>
                  setExpanded((prev) => ({ ...prev, [g.key]: !prev[g.key] }))
                }
                initialTop={INITIAL_TOP}
                onEmail={onEmail}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function FollowUpGroup({
  label, stripe, badgeBg, badgeFg, items, expanded, onToggle, initialTop, onEmail, onRefresh,
}: {
  groupKey: string;
  label: string;
  stripe: string;
  badgeBg: string;
  badgeFg: string;
  items: FollowUp[];
  expanded: boolean;
  onToggle: () => void;
  initialTop: number;
  onEmail: (fu: FollowUp) => void;
  onRefresh: () => void;
}) {
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, initialTop);
  const hasMore = items.length > initialTop;

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between py-1.5 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 11 }}>{expanded ? "▼" : "▶"}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            {label}
          </span>
          <span
            className="rounded-full"
            style={{
              background: badgeBg,
              color: badgeFg,
              padding: "1px 8px",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {items.length}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="space-y-2 mt-2">
          {shown.map((item) => (
            <FollowUpCard
              key={item.lead_id}
              fu={item}
              stripeColor={stripe}
              onEmail={onEmail}
              onRefresh={onRefresh}
            />
          ))}
          {!expanded && hasMore && (
            <p className="text-xs text-slate-400 pl-4">
              + {items.length - initialTop} more — click header to expand
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Phase B: 2-button card. Coloured stripe taken from caller (group axis
// determines colour). No emoji. Log Action opens QuickEntry preselected
// to this contact; Snooze pushes the lead's next_follow_up forward.
function FollowUpCard({
  fu, stripeColor, onRefresh,
}: {
  fu: FollowUp;
  stripeColor: string;
  onEmail: (fu: FollowUp) => void;  // kept for prop compat; unused now
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [snoozeMenu, setSnoozeMenu] = useState(false);

  const handleSnooze = async (days: number) => {
    setBusy(true);
    setSnoozeMenu(false);
    try {
      // task-derived rows have non-numeric lead_id ("task-N"); skip snooze
      // for now since the backend snooze endpoint only handles real leads.
      if (typeof fu.lead_id === "number") {
        await dashboardApi.snoozeFollowUp(fu.lead_id, days);
      }
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Snooze failed");
    } finally {
      setBusy(false);
    }
  };

  const lastContactLine = fu.last_activity_date
    ? `Last contact: ${fu.days_since_last_contact ?? 0} days ago · ${fu.last_activity_type ?? "Activity"}`
    : "No prior contact";

  const noteLine = fu.last_activity_content || fu.last_activity_summary || fu.follow_up_reason;

  const pillBtn = "text-[12px] px-3 py-1 rounded-full border transition-colors";

  return (
    <div
      className="bg-white rounded-xl overflow-hidden hover:shadow-sm transition-shadow"
      style={{ border: "1px solid var(--border-faint)" }}
    >
      <div className="flex">
        {/* 3px coloured left stripe */}
        <div style={{ width: 3, background: stripeColor, flexShrink: 0 }} />
        <div className="px-4 py-3 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <Link
                href={`/contacts?id=${fu.contact_id}`}
                className="font-medium text-[14px] hover:underline"
                style={{ color: "var(--text-primary)" }}
              >
                {fu.contact_name}
              </Link>
              {fu.company && (
                <span className="text-[14px] ml-1" style={{ color: "var(--text-secondary)" }}>
                  · {fu.company}
                </span>
              )}
              <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                {lastContactLine}
              </p>
              {noteLine && (
                <p
                  className="text-[12px] mt-1 italic line-clamp-2"
                  style={{ color: "var(--text-secondary)" }}
                >
                  &ldquo;{noteLine}&rdquo;
                </p>
              )}
            </div>
          </div>

          {/* 2-button action row: Log Action / Snooze */}
          <div
            className="flex items-center gap-2 mt-2.5 pt-2.5"
            style={{ borderTop: "1px solid var(--border-faint)" }}
          >
            <Link
              href={`/contacts?id=${fu.contact_id}`}
              className={pillBtn}
              style={{
                background: "var(--brand-blue)",
                color: "#fff",
                borderColor: "var(--brand-blue)",
              }}
            >
              Log Action
            </Link>
            <div className="relative">
              <button
                onClick={() => setSnoozeMenu((v) => !v)}
                disabled={busy}
                className={pillBtn}
                style={{
                  background: "var(--bg-card)",
                  color: "var(--text-secondary)",
                  borderColor: "var(--border-strong)",
                }}
              >
                Snooze
              </button>
              {snoozeMenu && (
                <div
                  className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg z-10 text-[12px] min-w-[120px] overflow-hidden"
                  style={{ border: "1px solid var(--border-strong)" }}
                >
                  <button onClick={() => handleSnooze(1)} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50">+ 1 day</button>
                  <button onClick={() => handleSnooze(3)} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50">+ 3 days</button>
                  <button onClick={() => handleSnooze(7)} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50">+ 1 week</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== Activity Feed Section ====================

function ActivityFeedSection() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<string>("all");
  const [search, setSearch] = useState("");
  const PER_PAGE = 15;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(PER_PAGE),
      offset: String((page - 1) * PER_PAGE),
      time_range: timeRange,
    });
    if (filterType !== "all") params.set("activity_type", filterType);
    if (search.trim()) params.set("search", search.trim());

    try {
      const data = await activitiesApi.feedPaged(params.toString()) as {
        items: ActivityItem[]; total: number; has_more: boolean;
      };
      setItems(data.items);
      setTotal(data.total);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, filterType, timeRange, search]);

  // Debounce search
  const searchTimer = useRef<number | null>(null);
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(load, 300);
    return () => { if (searchTimer.current) window.clearTimeout(searchTimer.current); };
  }, [load]);

  // Group by date — today expanded, others collapsed by default
  const groups = useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    items.forEach(it => {
      const label = dateGroupLabel(it.created_at);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(it);
    });
    return Array.from(map.entries());
  }, [items]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (label: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };
  const isCollapsed = (label: string) => label !== "Today" && !collapsed.has(`expanded:${label}`) && collapsed.has(label);
  // default collapse non-"Today" — use different logic: keep collapsed set as "expanded exceptions"
  // simplify: collapsed = set of group labels the user has manually collapsed OR auto-collapsed initially

  // Auto-collapse all but "Today" on first data load
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current && items.length > 0) {
      firstRenderRef.current = false;
      const toCollapse = new Set<string>();
      groups.forEach(([label]) => { if (label !== "Today") toCollapse.add(label); });
      setCollapsed(toCollapse);
    }
  }, [items, groups]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2
          className="font-display font-bold text-slate-900"
          style={{ fontSize: 22 }}
        >
          Activity Feed
        </h2>
        <span className="bg-slate-100 text-slate-700 rounded-full px-2 text-sm font-semibold">{total}</span>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3 p-2 bg-slate-50 rounded border border-slate-200">
        <select
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          className="h-8 text-xs px-2 rounded border border-slate-200 bg-white text-slate-700"
        >
          <option value="all">All Types</option>
          <option value="call">Calls</option>
          <option value="email">Emails</option>
          <option value="meeting">Meetings</option>
          <option value="note">Notes</option>
          <option value="linkedin">LinkedIn</option>
        </select>
        <select
          value={timeRange}
          onChange={(e) => { setTimeRange(e.target.value); setPage(1); }}
          className="h-8 text-xs px-2 rounded border border-slate-200 bg-white text-slate-700"
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
        </select>
        <Input
          placeholder="🔍 Search contact or user..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="h-8 text-xs flex-1 min-w-[160px]"
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 py-3">Loading…</p>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-sm text-slate-400">No activities match your filters.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {groups.map(([label, rows]) => {
            const isHidden = label !== "Today" && collapsed.has(label);
            return (
              <div key={label}>
                <button
                  onClick={() => toggleGroup(label)}
                  className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500 mb-1.5 hover:text-slate-700"
                >
                  <span>{isHidden ? "▶" : "▼"}</span>
                  <span>{label}</span>
                  <span className="text-slate-400 normal-case font-normal">({rows.length})</span>
                </button>
                {!isHidden && (
                  <div className="space-y-1 pl-1 border-l border-slate-100">
                    {rows.map(a => <ActivityRow key={a.id} activity={a} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500">
          <span>Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} of {total}</span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => p - 1)}
            >
              ← Prev
            </Button>
            <span>Page {page} of {totalPages}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={page >= totalPages || loading}
              onClick={() => setPage(p => p + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function ActivityRow({ activity }: { activity: ActivityItem }) {
  const icon = ACTIVITY_ICON[activity.activity_type] || "📋";
  const verb = ACTIVITY_VERB[activity.activity_type] || "Interacted with";
  return (
    <div className="pl-3 py-1.5 flex items-start gap-2 text-sm hover:bg-slate-50 rounded">
      <span className="text-xs text-slate-400 shrink-0 w-16 mt-0.5">{formatTime(activity.created_at)}</span>
      <span className="shrink-0 mt-0.5 text-slate-400">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-600">
          <span className="font-medium text-slate-800">{activity.user_name}</span>
          <span className="text-slate-400"> · </span>
          <span>{verb}{" "}
            <Link href={`/contacts?id=${activity.contact_id}`} className="text-slate-900 hover:underline">
              {activity.contact_name}
            </Link>
          </span>
        </p>
        {activity.subject && (
          <p className="text-xs text-slate-500 truncate mt-0.5">{activity.subject}</p>
        )}
      </div>
    </div>
  );
}

// ==================== AI Suggested To-Do ====================
//
// Engine-driven (CP3). Suggestions come from the rule engine, not Claude.
// Snoozes live server-side in `ai_suggestion_snoozes`, keyed by the SHA-256
// of "{rule_id}|{contact_id}". Frontend pre-fetches the active hash list
// once on mount and filters in-memory; dismiss/snooze actions POST a new
// row and immediately remove the card from view.

const URGENCY_STRIPE: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-slate-400",
};

const CATEGORY_LABEL: Record<string, string> = {
  pacing: "Pacing",
  stage: "Stage",
  data_health: "Data",
  relationship: "Relationship",
  discipline: "Discipline",
};

/** Same hash function as backend's engine. Used to prefilter snoozed cards. */
async function hashSuggestion(rule_id: string, contact_id: number | null | undefined): Promise<string> {
  const payload = `${rule_id}|${contact_id ?? ""}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function AISuggestionsSection() {
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [snoozedHashes, setSnoozedHashes] = useState<Set<string>>(new Set());
  const [hiddenHashes, setHiddenHashes] = useState<Set<string>>(new Set()); // optimistic UI
  const [message, setMessage] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      // Engine endpoint (CP3) + active snooze list, in parallel.
      const [data, snoozeData] = await Promise.all([
        aiApi.suggestTodos(force) as Promise<AISuggestionsResponse>,
        tasksApi.snoozeSuggestionList() as Promise<{ hashes: string[] }>,
      ]);
      setSuggestions(data.suggestions || []);
      if (data.message) setMessage(data.message);
      if (data.generated_at) setGeneratedAt(data.generated_at);
      setSnoozedHashes(new Set(snoozeData?.hashes || []));
      setHiddenHashes(new Set());  // reset optimistic hides on refresh
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load suggestions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Compute hashes for visibility filter once per suggestions/snooze update.
  const [computedHashes, setComputedHashes] = useState<Map<AISuggestion, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = new Map<AISuggestion, string>();
      for (const s of suggestions) {
        m.set(s, await hashSuggestion(s.rule_id, s.contact_id ?? null));
      }
      if (!cancelled) setComputedHashes(m);
    })();
    return () => { cancelled = true; };
  }, [suggestions]);

  const onHide = (s: AISuggestion) => {
    const h = computedHashes.get(s);
    if (h) setHiddenHashes(prev => new Set([...prev, h]));
  };

  const visible = suggestions.filter(s => {
    const h = computedHashes.get(s);
    if (!h) return true;  // not yet hashed; show by default
    return !snoozedHashes.has(h) && !hiddenHashes.has(h);
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2
          className="font-display font-bold text-slate-900"
          style={{ fontSize: 22 }}
        >
          Suggested to-do
        </h2>
        <Button
          size="sm"
          onClick={() => load(true)}
          disabled={loading}
          className="text-[13px] h-8 px-4 text-white"
          style={{ background: "var(--brand-navy)" }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        Top {visible.length} of {suggestions.length} based on team&apos;s last 30 days of activity
        {generatedAt && !loading && (
          <span className="ml-2" style={{ color: "var(--text-muted)" }}>
            · Last updated: {timeAgo(generatedAt)}
          </span>
        )}
      </p>

      {loading ? (
        <Card><CardContent className="py-6 text-sm text-slate-400">Analyzing your activity…</CardContent></Card>
      ) : error ? (
        <Card><CardContent className="py-4 text-sm text-red-500">{error}</CardContent></Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-slate-400">
            {suggestions.length > 0
              ? "All suggestions dismissed. Click Refresh for new ones."
              : message
                ? message
                : "No suggestions yet — start logging activities to get AI recommendations!"}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((s) => (
            <SuggestionCard
              key={`${s.rule_id}-${s.contact_id ?? "global"}`}
              suggestion={s}
              onHide={() => onHide(s)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SuggestionCard({
  suggestion: s, onHide,
}: {
  suggestion: AISuggestion;
  onHide: () => void;
}) {
  const [created, setCreated] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);

  const stripe = URGENCY_STRIPE[s.urgency] || URGENCY_STRIPE.low;
  const categoryLabel = CATEGORY_LABEL[s.category] || s.category;

  // Map engine's suggested_action → task_type for Create Task.
  const taskType = (s.suggested_action === "linkedin" || s.suggested_action === "review")
    ? "follow_up"
    : s.suggested_action;

  const createTask = async () => {
    setCreating(true);
    setError(null);
    try {
      await tasksApi.create({
        contact_id: s.contact_id ?? undefined,
        task_type: taskType,
        description: s.rationale,
        source: "ai_suggestion",
      });
      setCreated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create task");
    } finally {
      setCreating(false);
    }
  };

  const snoozeFor = async (days: number) => {
    try {
      await tasksApi.snoozeSuggestion({
        rule_id: s.rule_id,
        contact_id: s.contact_id ?? null,
        days,
      });
      onHide();  // optimistic remove from current view
    } catch (e) {
      setError(e instanceof Error ? e.message : "Snooze failed");
    }
  };

  return (
    <Card className={`border border-slate-200 transition-opacity overflow-hidden ${created ? "opacity-60" : ""}`}>
      <div className="flex">
        {/* Urgency color stripe (left edge) */}
        <div className={`${stripe} w-1 shrink-0`} />
        <CardContent className="py-3 px-4 flex-1">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-sm font-medium text-slate-900">
              {s.rationale}
            </p>
            <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
              {categoryLabel}
            </span>
          </div>

          <button
            onClick={() => setWhyOpen(v => !v)}
            className="text-[11px] text-slate-400 hover:text-slate-600 mb-2"
          >
            {whyOpen ? "▼" : "▶"} Why?
          </button>
          {whyOpen && (
            <div className="text-[11px] text-slate-500 mb-2 bg-slate-50 rounded px-2 py-1.5">
              <div>Rule: <code>{s.rule_id}</code></div>
              <div>Action: {s.suggested_action}</div>
              {s.contact_id && <div>Contact id: {s.contact_id}</div>}
            </div>
          )}

          {error && <p className="text-xs text-red-500 mb-1">{error}</p>}

          {/* Phase B: 2-button action row, matches FollowUpCard pattern.
              Log Action → navigates to the contact (then user clicks
              + Log Action in nav). Snooze pops a 3-option menu. */}
          <div
            className="flex items-center gap-2 pt-2 mt-1 flex-wrap"
            style={{ borderTop: "1px solid var(--border-faint)" }}
          >
            {created ? (
              <span className="text-[12px] px-2 py-1" style={{ color: "var(--text-secondary)" }}>
                Task created
              </span>
            ) : s.contact_id ? (
              <Link
                href={`/contacts?id=${s.contact_id}`}
                className="text-[12px] px-3 py-1 rounded-full border text-white"
                style={{
                  background: "var(--brand-blue)",
                  borderColor: "var(--brand-blue)",
                }}
              >
                Log Action
              </Link>
            ) : (
              <Button
                size="sm"
                onClick={createTask}
                disabled={creating}
                className="text-[12px] h-7 px-3 text-white"
                style={{ background: "var(--brand-blue)" }}
              >
                {creating ? "Creating..." : "Log Action"}
              </Button>
            )}
            <div className="relative">
              <button
                onClick={() => setSnoozeMenuOpen((v) => !v)}
                className="text-[12px] px-3 py-1 rounded-full border"
                style={{
                  background: "var(--bg-card)",
                  color: "var(--text-secondary)",
                  borderColor: "var(--border-strong)",
                }}
              >
                Snooze
              </button>
              {snoozeMenuOpen && (
                <div
                  className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg z-10 text-[12px] min-w-[120px] overflow-hidden"
                  style={{ border: "1px solid var(--border-strong)" }}
                >
                  <button onClick={() => snoozeFor(1)} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50">+ 1 day</button>
                  <button onClick={() => snoozeFor(3)} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50">+ 3 days</button>
                  <button onClick={() => snoozeFor(7)} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50">+ 1 week</button>
                  <button onClick={() => snoozeFor(365)} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50" style={{ color: "var(--text-muted)" }}>Forever</button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}
