/**
 * Dashboard — 2026 CRM 最佳实践版本
 *
 * 布局：
 *   - Welcome header (Welcome back, David)
 *   - Quick Stats: 4 个数字卡 (Contacts / Emails / Calls / Meetings)
 *   - 60/40 两栏：
 *       Left  (60%): Follow-Ups Needed + Activity Feed
 *       Right (40%): AI Suggested To-Do
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import AddContact from "@/components/add-contact";
import QuickEntry from "@/components/quick-entry";
import EmailCompose from "@/components/email-compose";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { dashboardApi, activitiesApi, aiApi, authApi } from "@/lib/api";
import { useAIBudget } from "@/components/ai-budget";

// ==================== Types ====================

interface FollowUp {
  lead_id: number;
  contact_id: number;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  company: string | null;
  title: string | null;
  urgency: "overdue" | "today" | "upcoming";
  follow_up_date: string;
  follow_up_reason: string | null;
  last_activity_date: string | null;
  last_activity_type: string | null;
  last_activity_summary: string | null;
  last_activity_content: string | null;
  days_since_last_contact: number | null;
  owner_name: string;
}

interface FollowUpsResponse {
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
  priority: "HIGH" | "OPPORTUNITY" | "INSIGHT";
  title: string;
  reason: string;
  action: string;
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
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [emailComposeOpen, setEmailComposeOpen] = useState(false);
  const [emailContext, setEmailContext] = useState<{ id: number; name: string; email: string | null }>({
    id: 0, name: "", email: null,
  });

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

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* === Welcome header === */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
            {currentUserName && (
              <p className="text-sm text-slate-500 mt-0.5">Welcome back, {currentUserName.split(" ")[0]}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setAddContactOpen(true)}>+ Contact</Button>
            <Button size="sm" variant="outline" onClick={() => setQuickEntryOpen(true)}>✎ Log</Button>
          </div>
        </div>

        {/* === Quick Stats === */}
        <QuickStatsRow stats={stats} />

        {/* === 60 / 40 two-column === */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: 60% (3/5) — Follow-Ups + Activity Feed */}
          <div className="lg:col-span-3 space-y-6">
            <FollowUpsSection
              loading={loadingFollowUps}
              data={followUps}
              onRefresh={loadFollowUps}
              onEmail={openEmail}
            />
            <ActivityFeedSection />
          </div>

          {/* Right: 40% (2/5) — AI Suggested To-Do */}
          <div className="lg:col-span-2 space-y-6">
            <AISuggestionsSection />
          </div>
        </div>
      </div>

      {/* Quick action dialogs */}
      <AddContact
        open={addContactOpen}
        onClose={() => setAddContactOpen(false)}
        onSuccess={() => { setAddContactOpen(false); loadFollowUps(); }}
      />
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
    </AppShell>
  );
}

// ==================== StatCard + Quick Stats Row ====================

function StatCard({ icon, label, value }: { icon: string; label: string; value: number | string }) {
  return (
    <div className="p-5 bg-white rounded-lg shadow-sm border border-slate-100">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-1.5">
        <span className="text-base">{icon}</span>
        <span>{label}</span>
      </div>
      <p className="text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function AIBudgetStatCard() {
  const { usage } = useAIBudget();
  if (!usage) {
    return <StatCard icon="🤖" label="AI Budget" value="—" />;
  }
  if (usage.unlimited) {
    return (
      <div className="p-5 bg-white rounded-lg shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 text-sm text-slate-500 mb-1.5">
          <span className="text-base">🤖</span>
          <span>AI Budget</span>
        </div>
        <p className="text-2xl font-bold text-slate-900">Unlimited</p>
        <p className="text-xs text-slate-400 mt-0.5">${usage.spent_today.toFixed(2)} today</p>
      </div>
    );
  }
  // At-limit states use red (warning color); otherwise pure slate per design.
  const amountClass = usage.at_limit ? "text-red-500" : "text-slate-900";
  return (
    <div className="p-5 bg-white rounded-lg shadow-sm border border-slate-100">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-1.5">
        <span className="text-base">🤖</span>
        <span>AI Budget</span>
      </div>
      <p className={`text-2xl font-bold ${amountClass}`}>
        ${usage.spent_today.toFixed(2)}
        <span className="text-slate-400 text-base font-normal"> / ${(usage.daily_limit ?? 0).toFixed(2)}</span>
      </p>
      <p className="text-xs text-slate-400 mt-0.5">today</p>
    </div>
  );
}

function QuickStatsRow({ stats }: { stats: QuickStats | null }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <StatCard icon="📊" label="Total Contacts" value={stats?.total_contacts ?? "—"} />
      <StatCard icon="📧" label="Emails Today" value={stats?.emails_today ?? "—"} />
      <StatCard icon="📞" label="Calls Today" value={stats?.calls_today ?? "—"} />
      <StatCard icon="🤝" label="Meetings This Week" value={stats?.meetings_this_week ?? "—"} />
      <AIBudgetStatCard />
    </div>
  );
}

// ==================== Follow-Ups Needed ====================

const URGENCY_STYLES: Record<string, { border: string; dot: string; label: string }> = {
  overdue: { border: "border-l-red-500", dot: "🔴", label: "Overdue" },
  today: { border: "border-l-slate-300", dot: "🟡", label: "Due Today" },
  upcoming: { border: "border-l-slate-300", dot: "🔵", label: "Upcoming This Week" },
};

function FollowUpsSection({
  loading, data, onRefresh, onEmail,
}: {
  loading: boolean;
  data: FollowUpsResponse | null;
  onRefresh: () => void;
  onEmail: (fu: FollowUp) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ overdue: false, today: false, upcoming: false });

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

  const sections: Array<{ key: "overdue" | "today" | "upcoming"; items: FollowUp[] }> = [
    { key: "overdue", items: data?.grouped.overdue ?? [] },
    { key: "today", items: data?.grouped.today ?? [] },
    { key: "upcoming", items: data?.grouped.upcoming ?? [] },
  ];

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold text-slate-900">Follow-Ups Needed</h2>
        <span className="bg-slate-100 text-slate-700 rounded-full px-2 text-sm font-semibold">{total}</span>
      </div>

      <div className="space-y-5">
        {sections.map(({ key, items }) => {
          if (items.length === 0) return null;
          const style = URGENCY_STYLES[key];
          const isExpanded = expanded[key];
          const shown = isExpanded ? items : items.slice(0, 3);
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-slate-700">
                  <span className="mr-1">{style.dot}</span>
                  {style.label} <span className="text-slate-400">({items.length})</span>
                </p>
                {items.length > 3 && (
                  <button
                    onClick={() => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
                    className="text-xs text-slate-600 hover:text-slate-900 hover:underline"
                  >
                    {isExpanded ? "Show Less" : `View All (${items.length})`}
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {shown.map(item => (
                  <FollowUpCard
                    key={item.lead_id}
                    fu={item}
                    borderClass={style.border}
                    onEmail={onEmail}
                    onRefresh={onRefresh}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FollowUpCard({
  fu, borderClass, onEmail, onRefresh,
}: {
  fu: FollowUp;
  borderClass: string;
  onEmail: (fu: FollowUp) => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [snoozeMenu, setSnoozeMenu] = useState(false);

  const handleSnooze = async (days: number) => {
    setBusy(true);
    setSnoozeMenu(false);
    try {
      await dashboardApi.snoozeFollowUp(fu.lead_id, days);
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Snooze failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDone = async () => {
    setBusy(true);
    try {
      await dashboardApi.completeFollowUp(fu.lead_id);
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const lastContactLine = fu.last_activity_date
    ? `Last contact: ${fu.days_since_last_contact ?? 0} days ago · ${fu.last_activity_type ?? "Activity"}`
    : "No prior contact";

  const noteLine = fu.last_activity_content || fu.last_activity_summary || fu.follow_up_reason;

  const actionBtn = "text-[11px] px-2 py-0.5 bg-slate-50 text-slate-700 border border-slate-200 rounded hover:bg-slate-100 transition-colors";
  return (
    <Card className={`border border-slate-200 border-l-4 ${borderClass} hover:shadow-sm transition-shadow`}>
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <Link
              href={`/contacts?id=${fu.contact_id}`}
              className="font-medium text-sm text-slate-900 hover:underline"
            >
              {fu.contact_name}
            </Link>
            {fu.company && <span className="text-sm text-slate-500 ml-1">· {fu.company}</span>}
            <p className="text-xs text-slate-500 mt-0.5">{lastContactLine}</p>
            {noteLine && (
              <p className="text-xs text-slate-600 mt-1 italic line-clamp-2">&ldquo;{noteLine}&rdquo;</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-100">
          {fu.contact_phone && (
            <a
              href={`tel:${fu.contact_phone}`}
              className={actionBtn}
            >
              📞 Call
            </a>
          )}
          {fu.contact_email && (
            <button
              onClick={() => onEmail(fu)}
              className={actionBtn}
            >
              📧 Email
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setSnoozeMenu(v => !v)}
              disabled={busy}
              className={actionBtn}
            >
              ⏰ Snooze
            </button>
            {snoozeMenu && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded shadow-lg z-10 text-[11px] min-w-[120px]">
                <button onClick={() => handleSnooze(1)} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50">+ 1 day</button>
                <button onClick={() => handleSnooze(3)} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50">+ 3 days</button>
                <button onClick={() => handleSnooze(7)} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50">+ 1 week</button>
              </div>
            )}
          </div>
          <button
            onClick={handleDone}
            disabled={busy}
            className={`${actionBtn} ml-auto`}
          >
            ✓ Done
          </button>
        </div>
      </CardContent>
    </Card>
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
        <h2 className="text-lg font-semibold text-slate-900">Activity Feed</h2>
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

const PRIORITY_STYLES: Record<string, { icon: string; label: string; color: string }> = {
  // Red stays for HIGH but muted — bg-red-50 + text-red-700 per spec.
  HIGH: { icon: "🔥", label: "HIGH PRIORITY", color: "bg-red-50 text-red-700 border border-red-200 rounded-full px-2 text-xs" },
  OPPORTUNITY: { icon: "💡", label: "OPPORTUNITY", color: "bg-slate-50 text-slate-700 border border-slate-200 rounded-full px-2 text-xs" },
  INSIGHT: { icon: "📊", label: "INSIGHT", color: "bg-slate-50 text-slate-700 border border-slate-200 rounded-full px-2 text-xs" },
};

function AISuggestionsSection() {
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem("ai_todos_dismissed") || "[]";
      return new Set(JSON.parse(raw));
    } catch { return new Set(); }
  });

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const data = await aiApi.suggestTodos(force) as AISuggestionsResponse;
      setSuggestions(data.suggestions || []);
      if (data.message) setMessage(data.message);
      if (data.generated_at) setGeneratedAt(data.generated_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load suggestions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dismiss = (title: string) => {
    const next = new Set(dismissed);
    next.add(title);
    setDismissed(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("ai_todos_dismissed", JSON.stringify(Array.from(next)));
    }
  };

  const visible = suggestions.filter(s => !dismissed.has(s.title));

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-slate-900">🤖 AI Suggested To-Do</h2>
        <Button
          size="sm"
          onClick={() => load(true)}
          disabled={loading}
          className="text-xs h-7 bg-blue-600 hover:bg-blue-700 text-white"
        >
          {loading ? "Generating..." : "Generate"}
        </Button>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Based on team's last 30 days of activity
        {generatedAt && !loading && (
          <span className="ml-2 text-slate-400">· Last updated: {timeAgo(generatedAt)}</span>
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
              ? "All suggestions dismissed. Click Generate for new ones."
              : message
                ? message
                : "No suggestions yet — start logging activities to get AI recommendations!"}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((s, i) => {
            const style = PRIORITY_STYLES[s.priority] || PRIORITY_STYLES.INSIGHT;
            return (
              <Card key={i} className="border border-slate-200">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-flex items-center py-0 font-medium ${style.color}`}>
                      {style.icon} {i + 1}. {style.label}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-slate-900 mb-1.5">{s.title}</p>
                  <p className="text-xs text-slate-600 mb-1.5">
                    <span className="font-medium">Reason:</span> {s.reason}
                  </p>
                  <p className="text-xs text-slate-700 mb-2">
                    <span className="font-medium">Suggested action:</span> {s.action}
                  </p>
                  <div className="flex gap-1.5 pt-2 border-t border-slate-100">
                    <button
                      onClick={() => alert("Create Task feature coming soon — for now, log the activity manually.")}
                      className="text-[11px] px-2 py-0.5 bg-slate-50 text-slate-700 border border-slate-200 rounded hover:bg-slate-100 transition-colors"
                    >
                      + Create Task
                    </button>
                    <button
                      onClick={() => dismiss(s.title)}
                      className="text-[11px] px-2 py-0.5 bg-slate-50 text-slate-500 border border-slate-200 rounded hover:bg-slate-100 ml-auto transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
