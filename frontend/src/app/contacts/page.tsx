/**
 * Contacts Page — Split layout for browsing and viewing contacts
 * Left panel (30%): Searchable, scrollable contact list
 * Right panel (70%): Selected contact's full detail view
 */
"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/app-shell";
import QuickEntry from "@/components/quick-entry";
import EmailCompose from "@/components/email-compose";
import AddContact from "@/components/add-contact";
import ImportContacts from "@/components/import-contacts";
import { useAIBudget, AIBudgetBadge, AILimitModal } from "@/components/ai-budget";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditableField } from "@/components/editable-field";
import EditActivity from "@/components/edit-activity";
import { contactsApi, activitiesApi, aiApi, tasksApi } from "@/lib/api";
import ActivityComments from "@/components/social/activity-comments";
import TeamNotes from "@/components/social/team-notes";
import { MOCK_TIMELINE_ACTIVITIES } from "@/lib/social-mock";

// === Type definitions ===

interface Contact {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  mobile_phone: string | null;
  office_phone: string | null;
  title: string | null;
  company_name: string | null;
  company_domain: string | null;
  industry: string | null;
  company_size: string | null;
  city: string | null;
  state: string | null;
  linkedin_url: string | null;
  website: string | null;
  notes: string | null;
  ai_person_report: string | null;
  ai_company_report: string | null;
  ai_tags: string | null;
  ai_person_generated_at: string | null;
  ai_company_generated_at: string | null;
  ai_report_model: string | null;
  lead_status: string | null;  // Phase C: backend now bulk-loads this
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// === Phase C helpers ====================================================

/** First letter of first + last name; falls back to email or "?". */
function getInitials(c: { first_name?: string; last_name?: string; email?: string | null }): string {
  const first = (c.first_name || "").trim();
  const last = (c.last_name || "").trim();
  if (first || last) {
    return `${first[0] || ""}${last[0] || ""}`.toUpperCase() || "?";
  }
  return (c.email || "?").trim().slice(0, 1).toUpperCase();
}

/**
 * Derive an avatar tint from a stable hash of the contact's name. We don't
 * want the colour jumping around when the contact is reloaded, so it's
 * hashed not random. Cycles through the brand 4 colours.
 */
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const palette = [
    "var(--brand-blue)",
    "var(--brand-amber)",
    "var(--brand-green)",
    "var(--brand-red)",
  ];
  return palette[Math.abs(h) % palette.length];
}

interface AvatarProps {
  contact: { first_name?: string; last_name?: string; email?: string | null };
  size?: number;  // px
}
function Avatar({ contact, size = 36 }: AvatarProps) {
  const initials = getInitials(contact);
  const fontSize = Math.round(size * 0.4);
  const colour = avatarColor(`${contact.first_name || ""}${contact.last_name || ""}${contact.email || ""}`);
  return (
    <div
      className="flex items-center justify-center rounded-full text-white font-semibold shrink-0"
      style={{ width: size, height: size, fontSize, background: colour }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

/**
 * Pill-shaped status badge for the contact's most recent lead. The label
 * matches the dashboard's status-bucket vocabulary so UI feels coherent.
 */
const STATUS_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Waiting",
  interested: "Sample sent",
  meeting_set: "Hot",
  proposal: "Negotiation",
  closed_won: "Won",
  closed_lost: "Lost",
};

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  new:          { bg: "var(--bg-app)",          fg: "var(--text-muted)" },
  contacted:    { bg: "var(--brand-amber-soft)", fg: "var(--brand-amber-dark)" },
  interested:   { bg: "var(--brand-blue-soft)",  fg: "var(--brand-blue)" },
  meeting_set:  { bg: "var(--brand-red-soft)",   fg: "var(--brand-red)" },
  proposal:     { bg: "var(--brand-green-soft)", fg: "var(--brand-green)" },
  closed_won:   { bg: "var(--brand-green-soft)", fg: "var(--brand-green)" },
  closed_lost:  { bg: "var(--bg-app)",           fg: "var(--text-muted)" },
};

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const label = STATUS_LABEL[status] || status;
  const style = STATUS_STYLE[status] || { bg: "var(--bg-app)", fg: "var(--text-muted)" };
  return (
    <span
      className="rounded-full"
      style={{
        background: style.bg,
        color: style.fg,
        padding: "1px 8px",
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// 5 fields the enrich endpoint tries to fill
const ENRICH_FIELDS = ["mobile_phone", "office_phone", "email", "linkedin_url", "website"] as const;
type EnrichField = (typeof ENRICH_FIELDS)[number];

interface EnrichResponse {
  enriched_fields: EnrichField[];
  skipped_fields: EnrichField[];
  credits_used: number;
  used_today?: number;
  daily_limit?: number;
  message?: string;
  contact?: {
    id: number;
    mobile_phone: string | null;
    office_phone: string | null;
    email: string | null;
    linkedin_url: string | null;
    website: string | null;
  };
}

interface Activity {
  id: number;
  activity_type: string;
  subject: string | null;
  content: string | null;
  user_name: string | null;
  created_at: string;
  contact_id: number;
  contact_name?: string | null;
}

// === Display helpers ===

const activityIcons: Record<string, string> = {
  call: "\u260E",
  email: "\u2709",
  linkedin: "\uD83D\uDD17",
  meeting: "\uD83D\uDCC5",
  note: "\uD83D\uDCDD",
};

const activityLabels: Record<string, string> = {
  call: "Call",
  email: "Email",
  linkedin: "LinkedIn",
  meeting: "Meeting",
  note: "Note",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function enrichFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    mobile_phone: "📱 Mobile Phone",
    office_phone: "☎️ Office Phone",
    email: "✉️ Email",
    linkedin_url: "🔗 LinkedIn",
    website: "🌐 Website",
  };
  return labels[field] || field;
}

/** "Generated 3 days ago" / "Generated today" — relative-time formatter */
function relativeDays(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days < 1) return "Generated today";
  if (days === 1) return "Generated 1 day ago";
  return `Generated ${days} days ago`;
}

function ContactsContent() {
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("id");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [emailComposeOpen, setEmailComposeOpen] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<EnrichResponse | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  // PATCH one field then merge the response back into selectedContact.
  // Problem 1: don't reload the entire list — splice the updated contact in
  // place so the left panel doesn't reorder / scroll-jump.
  const updateField = async (field: keyof Contact, value: string): Promise<void> => {
    if (!selectedContact) return;
    const payload = { [field]: value || null } as Record<string, string | null>;
    const updated = await contactsApi.update(selectedContact.id, payload) as Contact;
    setSelectedContact(updated);
    setContacts(prev => prev.map(c => (c.id === updated.id ? updated : c)));
  };
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [generatingPersonReport, setGeneratingPersonReport] = useState(false);
  const [generatingCompanyReport, setGeneratingCompanyReport] = useState(false);

  // AI budget status — shared via hook
  const { usage: aiUsage, refresh: refreshAIBudget } = useAIBudget();
  const [showLimitModal, setShowLimitModal] = useState(false);

  // Phase C pagination: 30 per page, explicit Prev/Next + numbered pages.
  // Replaced the previous infinite-scroll with offset-based pagination so
  // Manager always knows exactly what page they're on (mockup spec).
  const PAGE_SIZE = 30;
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  const loadContacts = useCallback(async (
    searchTerm: string | undefined,
    page: number,
    includeArchived: boolean,
  ) => {
    const skip = (page - 1) * PAGE_SIZE;
    try {
      const data = await contactsApi.list(searchTerm, skip, PAGE_SIZE, includeArchived);
      setContacts(data.contacts || []);
      setTotalCount(data.total || 0);
    } catch {
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load activities for selected contact
  const loadActivities = useCallback(async (contactId: number) => {
    setActivitiesLoading(true);
    try {
      const data = await activitiesApi.listByContact(contactId);
      setActivities(data || []);
    } catch {
      setActivities([]);
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  // Initial + page change — load whatever page we're currently on.
  useEffect(() => {
    loadContacts(search || undefined, currentPage, showArchived);
    if (listScrollRef.current) listScrollRef.current.scrollTop = 0;
    // intentionally NOT depending on `search` or `showArchived` — those are
    // handled by the debounced effect below to avoid double-fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, loadContacts]);

  // Search with debounce → reset to page 1 + reload
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentPage !== 1) {
        setCurrentPage(1);  // triggers the effect above
      } else {
        loadContacts(search || undefined, 1, showArchived);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, showArchived]);

  // If a contact ID is in the URL, select it (might land on a different page)
  useEffect(() => {
    if (preselectedId && contacts.length > 0) {
      const found = contacts.find((c) => c.id === Number(preselectedId));
      if (found) {
        setSelectedContact(found);
        loadActivities(found.id);
      }
    }
  }, [preselectedId, contacts, loadActivities]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Select a contact
  function handleSelectContact(contact: Contact) {
    setSelectedContact(contact);
    loadActivities(contact.id);
  }

  // Parse AI tags (stored as JSON string)
  function parseTags(tagsStr: string | null): string[] {
    if (!tagsStr) return [];
    try {
      return JSON.parse(tagsStr);
    } catch {
      return tagsStr.split(",").map((t) => t.trim()).filter(Boolean);
    }
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-57px)]">
        {/* === Left Panel: Contact List (30%) === */}
        <div className="w-[30%] border-r border-gray-200 flex flex-col">
          {/* Toolbar: Search + Action buttons */}
          <div className="p-3 border-b border-gray-100 space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder="Search contacts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 flex-1"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="text-xs h-7" onClick={() => setAddContactOpen(true)}>
                + Add
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7"
                onClick={() => setImportOpen(true)}
              >
                ↓ Import
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true);
                  try { await contactsApi.exportCsv(); } catch { /* noop */ }
                  setExporting(false);
                }}
              >
                {exporting ? "Exporting..." : "↑ Export"}
              </Button>
            </div>
            <label
              className="flex items-center gap-1.5 text-xs select-none cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300"
              />
              Show archived
            </label>
          </div>

          {/* Select all checkbox */}
          {contacts.length > 0 && (
            <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
              <input
                type="checkbox"
                checked={contacts.length > 0 && selectedIds.size === contacts.length}
                onChange={() => {
                  if (selectedIds.size === contacts.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(contacts.map(c => c.id)));
                  }
                }}
                className="h-3.5 w-3.5 rounded border-gray-300"
              />
              <span className="text-xs text-gray-500">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
              </span>
              <span className="text-xs text-gray-400 ml-auto">
                Showing {contacts.length} of {totalCount}
              </span>
            </div>
          )}

          {/* Phase C: contact list — avatar + status badge per row */}
          <div ref={listScrollRef} className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="text-sm p-4" style={{ color: "var(--text-muted)" }}>Loading...</p>
            ) : contacts.length === 0 ? (
              <p className="text-sm p-4" style={{ color: "var(--text-muted)" }}>
                No contacts found. Click &quot;+ Add&quot; to create one.
              </p>
            ) : (
              contacts.map((contact) => (
                <div
                  key={contact.id}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    selectedContact?.id === contact.id ? "bg-slate-100" : "hover:bg-slate-50"
                  }`}
                  style={{ borderBottom: "1px solid var(--border-faint)" }}
                  onClick={() => handleSelectContact(contact)}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(contact.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (next.has(contact.id)) next.delete(contact.id);
                        else next.add(contact.id);
                        return next;
                      });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-3.5 w-3.5 rounded border-gray-300 shrink-0"
                  />
                  <Avatar contact={contact} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm" style={{ color: "var(--text-primary)" }}>
                      {contact.first_name} {contact.last_name}
                    </p>
                    {contact.title && (
                      <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                        {contact.title}
                      </p>
                    )}
                    {contact.company_name && (
                      <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                        {contact.company_name}
                      </p>
                    )}
                  </div>
                  {contact.lead_status && contact.lead_status !== "new" && (
                    <StatusBadge status={contact.lead_status} />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Phase C: bottom pagination — "Showing X-Y of Z" + Prev / pages / Next */}
          {totalCount > 0 && (
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderTop: "1px solid var(--border-faint)" }}
            >
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, totalCount)} of {totalCount}
              </p>
              <div className="flex items-center gap-1">
                <button
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="rounded-full px-3 py-1 text-xs font-medium border disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: "var(--bg-card)",
                    color: "var(--text-secondary)",
                    borderColor: "var(--border-strong)",
                  }}
                >
                  Prev
                </button>
                {/* Compact page numbers (max 5 visible). */}
                {(() => {
                  const pages: (number | "…")[] = [];
                  const max = totalPages;
                  if (max <= 5) {
                    for (let i = 1; i <= max; i++) pages.push(i);
                  } else if (currentPage <= 3) {
                    pages.push(1, 2, 3, "…", max);
                  } else if (currentPage >= max - 2) {
                    pages.push(1, "…", max - 2, max - 1, max);
                  } else {
                    pages.push(1, "…", currentPage, "…", max);
                  }
                  return pages.map((p, i) =>
                    p === "…" ? (
                      <span key={`e${i}`} className="px-1 text-xs" style={{ color: "var(--text-muted)" }}>…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p as number)}
                        className="rounded-full text-xs font-medium"
                        style={{
                          width: 28,
                          height: 28,
                          background: currentPage === p ? "var(--brand-blue)" : "var(--bg-card)",
                          color: currentPage === p ? "#fff" : "var(--text-secondary)",
                          border: `1px solid ${currentPage === p ? "var(--brand-blue)" : "var(--border-strong)"}`,
                        }}
                      >
                        {p}
                      </button>
                    )
                  );
                })()}
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  className="rounded-full px-3 py-1 text-xs font-medium border disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: "var(--bg-card)",
                    color: "var(--text-secondary)",
                    borderColor: "var(--border-strong)",
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* === Right Panel: Contact Detail (70%) === */}
        <div className="w-[70%] overflow-y-auto">
          {selectedContact === null ? (
            <PriorityContactsLanding onPick={handleSelectContact} />
          ) : (
            <div className="p-6 space-y-6">
              {/* --- Header: Back / Avatar + Fraunces name / actions --- */}
              <div>
                <button
                  onClick={() => {
                    setSelectedContact(null);
                    setActivities([]);
                  }}
                  className="text-sm rounded-full px-3 py-1 mb-3 border transition-colors hover:bg-slate-50"
                  style={{
                    color: "var(--text-secondary)",
                    borderColor: "var(--border-strong)",
                    background: "var(--bg-card)",
                  }}
                >
                  ← Back
                </button>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Avatar contact={selectedContact} size={48} />
                    <div>
                      <h2
                        className="font-display font-bold flex items-center gap-1"
                        style={{ fontSize: 24, color: "var(--text-primary)", lineHeight: 1.2 }}
                      >
                        <EditableField
                          value={selectedContact.first_name}
                          onSave={(v) => updateField("first_name", v)}
                          placeholder="First name"
                          emptyLabel="(first)"
                        />
                        <EditableField
                          value={selectedContact.last_name}
                          onSave={(v) => updateField("last_name", v)}
                          placeholder="Last name"
                          emptyLabel="(last)"
                        />
                      </h2>
                      {selectedContact.lead_status && (
                        <div className="mt-1.5">
                          <StatusBadge status={selectedContact.lead_status} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    {(() => {
                      const fullyEnriched = ENRICH_FIELDS.every(
                        (f) => Boolean(selectedContact[f])
                      );
                      return (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={enriching || fullyEnriched}
                          onClick={async () => {
                            setEnriching(true);
                            setEnrichError(null);
                            try {
                              const res = await contactsApi.enrich(selectedContact.id) as EnrichResponse;
                              setEnrichResult(res);
                              if (res.contact) {
                                setSelectedContact({
                                  ...selectedContact,
                                  mobile_phone: res.contact.mobile_phone,
                                  office_phone: res.contact.office_phone,
                                  email: res.contact.email,
                                  linkedin_url: res.contact.linkedin_url,
                                  website: res.contact.website,
                                });
                              }
                            } catch (e) {
                              const msg = e instanceof Error ? e.message : "Enrich failed";
                              // Surface budget + no-match specifically
                              setEnrichError(msg);
                            } finally {
                              setEnriching(false);
                            }
                          }}
                        >
                          {enriching
                            ? "Enriching..."
                            : fullyEnriched
                              ? "✓ Enriched"
                              : "Enrich"}
                        </Button>
                      );
                    })()}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled
                      title="Email sending paused"
                      className="cursor-not-allowed bg-slate-100 text-slate-400"
                    >
                      Send Email
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const archiving = selectedContact.is_active !== false;
                        const verb = archiving ? "Archive" : "Restore";
                        if (!confirm(`${verb} ${selectedContact.first_name} ${selectedContact.last_name}?`)) return;
                        try {
                          const updated = await contactsApi.update(selectedContact.id, {
                            is_active: !archiving ? true : false,
                          }) as Contact;
                          setSelectedContact(updated);
                          // Refresh list — archived contact may drop out of view
                          loadContacts(search || undefined, currentPage, showArchived);
                        } catch (e) {
                          alert(e instanceof Error ? e.message : `${verb} failed`);
                        }
                      }}
                      title={
                        selectedContact.is_active === false
                          ? "Restore this contact to the active list"
                          : "Hide this contact from the default list"
                      }
                    >
                      {selectedContact.is_active === false ? "Restore" : "Archive"}
                    </Button>
                    <Button size="sm" onClick={() => setQuickEntryOpen(true)}>
                      + Log Action
                    </Button>
                  </div>
                </div>
                <p className="text-gray-600 mt-1">
                  <EditableField
                    value={selectedContact.title}
                    onSave={(v) => updateField("title", v)}
                    placeholder="Title"
                    emptyLabel="Add title"
                  />
                  <span className="text-gray-400 mx-1">@</span>
                  <EditableField
                    value={selectedContact.company_name}
                    onSave={(v) => updateField("company_name", v)}
                    placeholder="Company"
                    emptyLabel="Add company"
                  />
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm text-gray-500">
                  <span>
                    <span className="text-gray-400">Email:</span>{" "}
                    <EditableField
                      value={selectedContact.email}
                      onSave={(v) => updateField("email", v)}
                      placeholder="name@company.com"
                      emptyLabel="Add email"
                      type="email"
                      validate={(v) => v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? "Invalid email" : null}
                    />
                  </span>
                  <span>
                    <span className="text-gray-400">📱 Mobile:</span>{" "}
                    <EditableField
                      value={selectedContact.mobile_phone}
                      onSave={(v) => updateField("mobile_phone", v)}
                      placeholder="+1-555-0100"
                      emptyLabel="Add mobile"
                      validate={(v) => v && !/^[\d\s+\-().x]+$/.test(v) ? "Digits and +-() only" : null}
                    />
                  </span>
                  <span>
                    <span className="text-gray-400">☎️ Office:</span>{" "}
                    <EditableField
                      value={selectedContact.office_phone}
                      onSave={(v) => updateField("office_phone", v)}
                      placeholder="+1-800-0000"
                      emptyLabel="Add office"
                      validate={(v) => v && !/^[\d\s+\-().x]+$/.test(v) ? "Digits and +-() only" : null}
                    />
                  </span>
                  {selectedContact.industry && (
                    <span>
                      <span className="text-gray-400">Industry:</span> {selectedContact.industry}
                    </span>
                  )}
                  {selectedContact.company_size && (
                    <span>
                      <span className="text-gray-400">Company size:</span> {selectedContact.company_size}
                    </span>
                  )}
                  <span>
                    <span className="text-gray-400">City:</span>{" "}
                    <EditableField
                      value={selectedContact.city}
                      onSave={(v) => updateField("city", v)}
                      placeholder="Dallas"
                      emptyLabel="Add city"
                    />
                  </span>
                  <span>
                    <span className="text-gray-400">State:</span>{" "}
                    <EditableField
                      value={selectedContact.state}
                      onSave={(v) => updateField("state", v)}
                      placeholder="TX"
                      emptyLabel="—"
                      maxLength={50}
                    />
                  </span>
                </div>
              </div>

              {/* --- LinkedIn & Website --- */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400 w-16 shrink-0">LinkedIn:</span>
                  <EditableField
                    value={selectedContact.linkedin_url}
                    onSave={(v) => updateField("linkedin_url", v)}
                    placeholder="https://linkedin.com/in/..."
                    emptyLabel="Add LinkedIn"
                    type="url"
                    validate={(v) => v && !v.toLowerCase().includes("linkedin.com") ? "Must contain linkedin.com" : null}
                  />
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400 w-16 shrink-0">Website:</span>
                  <EditableField
                    value={selectedContact.website}
                    onSave={(v) => updateField("website", v)}
                    placeholder="https://company.com"
                    emptyLabel="Add website"
                    type="url"
                  />
                </div>
              </div>

              {/* --- Industry Tags --- */}
              {selectedContact.ai_tags && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Tags</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {parseTags(selectedContact.ai_tags).map((tag, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* --- Notes (inline editable multiline) --- */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Notes</h3>
                <div className="text-sm text-gray-700 whitespace-pre-wrap">
                  <EditableField
                    value={selectedContact.notes}
                    onSave={(v) => updateField("notes", v)}
                    placeholder="Add notes about this contact..."
                    emptyLabel="Click to add notes"
                    multiline
                    maxLength={2000}
                    className="block w-full"
                    inputClassName="w-full min-h-[5rem]"
                  />
                </div>
              </div>

              <Separator />

              {/* --- AI Person Research Report --- */}
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-medium text-gray-700">
                      Person Report
                    </CardTitle>
                    <div className="flex items-center gap-2 mt-0.5">
                      {selectedContact.ai_person_generated_at && (
                        <p className="text-xs text-gray-400">
                          {relativeDays(selectedContact.ai_person_generated_at)}
                          {selectedContact.ai_report_model
                            ? ` · ${selectedContact.ai_report_model.replace("-20251001", "")}`
                            : ""}
                        </p>
                      )}
                      <AIBudgetBadge usage={aiUsage} compact />
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {selectedContact.ai_person_report && (
                      <button
                        onClick={async () => {
                          if (!confirm("Delete this report? You can regenerate it later.")) return;
                          await aiApi.deletePersonReport(selectedContact.id);
                          setSelectedContact({
                            ...selectedContact,
                            ai_person_report: null,
                            ai_person_generated_at: null,
                          });
                        }}
                        title="Delete report"
                        className="text-slate-400 hover:text-slate-600 text-xs px-1"
                      >
                        🗑️
                      </button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      disabled={generatingPersonReport || aiUsage?.at_limit}
                      onClick={async () => {
                        if (aiUsage?.at_limit) { setShowLimitModal(true); return; }
                        setGeneratingPersonReport(true);
                        try {
                          const hasReport = !!selectedContact.ai_person_report;
                          const data = await aiApi.personReport(selectedContact.id, hasReport);
                          setSelectedContact({
                            ...selectedContact,
                            ai_person_report: data.report,
                            ai_tags: data.tags || selectedContact.ai_tags,
                            ai_person_generated_at: data.meta?.generated_at ?? selectedContact.ai_person_generated_at,
                            ai_report_model: data.meta?.model ?? selectedContact.ai_report_model,
                          });
                          refreshAIBudget();
                        } catch (e) {
                          if (e instanceof Error && e.message.includes("daily_limit")) {
                            setShowLimitModal(true);
                          }
                          refreshAIBudget();
                        }
                        setGeneratingPersonReport(false);
                      }}
                    >
                      {generatingPersonReport ? "Generating..." : selectedContact.ai_person_report ? "🔄 Regenerate" : "Generate"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {generatingPersonReport ? (
                    <p className="text-sm text-gray-400 animate-pulse">AI is researching this person...</p>
                  ) : selectedContact.ai_person_report ? (
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">
                      {selectedContact.ai_person_report}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400 italic">
                      Click &quot;Generate&quot; to create an AI research report.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* --- AI Company Research Report --- */}
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-medium text-gray-700">
                      Company Report
                    </CardTitle>
                    <div className="flex items-center gap-2 mt-0.5">
                      {selectedContact.ai_company_generated_at && (
                        <p className="text-xs text-gray-400">
                          {relativeDays(selectedContact.ai_company_generated_at)}
                          {selectedContact.ai_report_model
                            ? ` · ${selectedContact.ai_report_model.replace("-20251001", "")}`
                            : ""}
                        </p>
                      )}
                      <AIBudgetBadge usage={aiUsage} compact />
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {selectedContact.ai_company_report && (
                      <button
                        onClick={async () => {
                          if (!confirm("Delete this report? You can regenerate it later.")) return;
                          await aiApi.deleteCompanyReport(selectedContact.id);
                          setSelectedContact({
                            ...selectedContact,
                            ai_company_report: null,
                            ai_company_generated_at: null,
                          });
                        }}
                        title="Delete report"
                        className="text-slate-400 hover:text-slate-600 text-xs px-1"
                      >
                        🗑️
                      </button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      disabled={generatingCompanyReport || aiUsage?.at_limit}
                      onClick={async () => {
                        if (aiUsage?.at_limit) { setShowLimitModal(true); return; }
                        setGeneratingCompanyReport(true);
                        try {
                          const hasReport = !!selectedContact.ai_company_report;
                          const data = await aiApi.companyReport(selectedContact.id, hasReport);
                          setSelectedContact({
                            ...selectedContact,
                            ai_company_report: data.report,
                            ai_company_generated_at: data.meta?.generated_at ?? selectedContact.ai_company_generated_at,
                            ai_report_model: data.meta?.model ?? selectedContact.ai_report_model,
                          });
                          refreshAIBudget();
                        } catch (e) {
                          if (e instanceof Error && e.message.includes("daily_limit")) {
                            setShowLimitModal(true);
                          }
                          refreshAIBudget();
                        }
                        setGeneratingCompanyReport(false);
                      }}
                    >
                      {generatingCompanyReport ? "Generating..." : selectedContact.ai_company_report ? "🔄 Regenerate" : "Generate"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {generatingCompanyReport ? (
                    <p className="text-sm text-gray-400 animate-pulse">AI is researching this company...</p>
                  ) : selectedContact.ai_company_report ? (
                    <CompanyReportBody report={selectedContact.ai_company_report} />
                  ) : (
                    <p className="text-sm text-gray-400 italic">
                      Click &quot;Generate&quot; to create an AI company analysis.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Separator />

              {/* --- Team Notes (internal post-its for the team) --- */}
              <TeamNotes contactId={selectedContact.id} />

              {/* --- Activity Timeline --- */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  Activity Timeline
                </h3>
                {activitiesLoading ? (
                  <p className="text-sm text-gray-400">Loading activities...</p>
                ) : (
                  // Social mockup \u00A73.4: empty real list \u2192 fall back to
                  // MOCK_TIMELINE_ACTIVITIES so the comments / reactions
                  // toolbar has rows to demonstrate.
                  <div className="space-y-3">
                    {activities.length === 0 && (
                      <p className="text-xs text-slate-400 italic">
                        No activities recorded yet \u2014 showing a sample timeline so you can preview teammate reactions.
                      </p>
                    )}
                    {(activities.length === 0 ? MOCK_TIMELINE_ACTIVITIES : activities).map((activity) => (
                      <div
                        key={activity.id}
                        className="group p-3 rounded-md bg-gray-50 relative"
                      >
                        <div className="flex items-start gap-3">
                        <span className="text-base mt-0.5">
                          {activityIcons[activity.activity_type] || "\uD83D\uDCCB"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {activityLabels[activity.activity_type] || activity.activity_type}
                            </Badge>
                            <span className="text-xs text-gray-400">
                              {formatDateTime(activity.created_at)}
                            </span>
                            {activity.user_name && (
                              <span className="text-xs text-gray-400">
                                by {activity.user_name}
                              </span>
                            )}
                          </div>
                          {activity.subject && (
                            <p className="text-sm font-medium text-gray-700 mt-1">
                              {activity.subject}
                            </p>
                          )}
                          {activity.content && (
                            <p className="text-sm text-gray-500 mt-0.5 whitespace-pre-wrap">
                              {activity.content}
                            </p>
                          )}
                        </div>
                        {/* Edit / Delete (Problem 3) — appear on hover.
                            Hidden for mock rows (id < 0). */}
                        {activity.id >= 0 && (
                          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                            <button
                              onClick={() => setEditingActivity(activity as Activity)}
                              title="Edit activity"
                              className="text-slate-400 hover:text-slate-600 text-xs px-1"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={async () => {
                                if (!confirm("Delete this activity? This cannot be undone.")) return;
                                try {
                                  await activitiesApi.delete(activity.id);
                                  setActivities(prev => prev.filter(a => a.id !== activity.id));
                                } catch (e) {
                                  alert(e instanceof Error ? e.message : "Delete failed");
                                }
                              }}
                              title="Delete activity"
                              className="text-slate-400 hover:text-slate-600 text-xs px-1"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                        </div>
                        {/* Social toolbar — stars + reactions + comments */}
                        <ActivityComments activityId={activity.id} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* --- Phase C: contact-specific Suggestions panel --- */}
              <ContactSuggestions
                contactId={selectedContact.id}
                onLogAction={() => setQuickEntryOpen(true)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Email compose dialog */}
      {selectedContact && (
        <EmailCompose
          open={emailComposeOpen}
          onClose={() => setEmailComposeOpen(false)}
          contactId={selectedContact.id}
          contactName={`${selectedContact.first_name} ${selectedContact.last_name}`}
          contactEmail={selectedContact.email}
          onSuccess={() => {
            if (selectedContact) loadActivities(selectedContact.id);
            setEmailComposeOpen(false);
          }}
        />
      )}

      {/* Add Contact modal */}
      <AddContact
        open={addContactOpen}
        onClose={() => setAddContactOpen(false)}
        onSuccess={(newId) => {
          setAddContactOpen(false);
          loadContacts(search || undefined, currentPage, showArchived);
          // Auto-select the new contact
          contactsApi.get(newId).then((c: Contact) => {
            setSelectedContact(c);
            loadActivities(c.id);
          }).catch(() => {});
        }}
      />

      {/* Import Contacts modal */}
      <ImportContacts
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => loadContacts(search || undefined, currentPage, showArchived)}
      />

      {/* AI Limit Reached modal — shown when user tries AI while at limit */}
      <AILimitModal
        open={showLimitModal}
        usage={aiUsage}
        onClose={() => setShowLimitModal(false)}
      />

      {/* Enrichment Result modal */}
      <Dialog open={enrichResult !== null || !!enrichError} onOpenChange={(o) => { if (!o) { setEnrichResult(null); setEnrichError(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {enrichError ? "⚠️ Enrichment failed" : "✓ Enrichment complete"}
            </DialogTitle>
          </DialogHeader>
          {enrichError ? (
            <p className="text-sm text-red-600 py-3">{enrichError}</p>
          ) : enrichResult && (
            <div className="py-2 space-y-3 text-sm">
              {enrichResult.enriched_fields.length > 0 && (
                <div>
                  <p className="font-medium text-gray-700 mb-1">Updated:</p>
                  <ul className="space-y-0.5">
                    {enrichResult.enriched_fields.map(f => (
                      <li key={f} className="text-green-700">
                        ✓ {enrichFieldLabel(f)}: <span className="text-gray-900">{String(enrichResult.contact?.[f] ?? "")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {enrichResult.skipped_fields.length > 0 && (
                <div>
                  <p className="font-medium text-gray-700 mb-1">Skipped:</p>
                  <ul className="space-y-0.5 text-gray-500">
                    {enrichResult.skipped_fields.map(f => (
                      <li key={f}>— {enrichFieldLabel(f)}: already existed or no Apollo data</li>
                    ))}
                  </ul>
                </div>
              )}
              {enrichResult.message && (
                <p className="text-xs text-gray-500 italic">{enrichResult.message}</p>
              )}
              {enrichResult.credits_used > 0 && enrichResult.used_today !== undefined && (
                <p className="text-xs text-gray-500 pt-2 border-t">
                  Credits used: {enrichResult.credits_used}{" "}
                  <span className="text-gray-400">
                    (Today: {enrichResult.used_today}/{enrichResult.daily_limit})
                  </span>
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => { setEnrichResult(null); setEnrichError(null); }}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Entry dialog for logging activities from contact detail */}
      <QuickEntry
        open={quickEntryOpen}
        onClose={() => setQuickEntryOpen(false)}
        preselectedContactId={selectedContact?.id}
        onSuccess={() => {
          // Reload activities for the selected contact
          if (selectedContact) {
            loadActivities(selectedContact.id);
          }
          setQuickEntryOpen(false);
        }}
      />

      {/* Activity edit dialog (replaces the old prompt() flow) */}
      <EditActivity
        open={editingActivity !== null}
        activity={editingActivity}
        onClose={() => setEditingActivity(null)}
        onSaved={(updated) => {
          setActivities(prev => prev.map(a => a.id === updated.id ? updated as Activity : a));
        }}
      />
    </AppShell>
  );
}


/**
 * Renders an AI Company Report with a "data source" badge parsed from the
 * first line. Backend asks Claude to emit either:
 *   DATA_SOURCE: website (calitho.com)   → 🌐 grounded report
 *   DATA_SOURCE: ai_only                  → ⚠️ name-only fallback
 */
function CompanyReportBody({ report }: { report: string }) {
  const firstNL = report.indexOf("\n");
  const firstLine = (firstNL >= 0 ? report.slice(0, firstNL) : report).trim();
  let badge: { kind: "website" | "ai_only" | "unknown"; domain?: string } = { kind: "unknown" };
  let body = report;
  if (firstLine.startsWith("DATA_SOURCE: website")) {
    const m = firstLine.match(/\(([^)]+)\)/);
    badge = { kind: "website", domain: m ? m[1] : undefined };
    body = firstNL >= 0 ? report.slice(firstNL + 1).trimStart() : "";
  } else if (firstLine.startsWith("DATA_SOURCE: ai_only")) {
    badge = { kind: "ai_only" };
    body = firstNL >= 0 ? report.slice(firstNL + 1).trimStart() : "";
  }
  return (
    <div className="space-y-2">
      {badge.kind === "website" && (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1 inline-flex items-center gap-1">
          🌐 Based on {badge.domain || "company website"}
        </div>
      )}
      {badge.kind === "ai_only" && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 inline-flex items-center gap-1">
          ⚠️ AI-generated · No website data · May be inaccurate
        </div>
      )}
      <p className="text-sm text-gray-600 whitespace-pre-wrap">{body}</p>
    </div>
  );
}

/**
 * Phase C: Priority contacts landing page (right pane when no contact is
 * selected). Pulls top suggestions from the rule engine and renders the
 * unique contacts behind them as 2-column cards. Picking one opens the
 * full contact detail.
 */
function PriorityContactsLanding({ onPick }: { onPick: (c: Contact) => void }) {
  const [items, setItems] = useState<{ contact: Contact; rationale: string; urgency: string; created_at?: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await aiApi.suggestTodos() as {
          suggestions: { contact_id: number | null; rule_id: string; rationale: string; urgency: string }[];
          generated_at?: string;
        };
        const suggestions = (data.suggestions || []).filter(s => s.contact_id != null);
        // Take first occurrence per contact_id (engine already sorted by urgency)
        const seen = new Set<number>();
        const top: typeof suggestions = [];
        for (const s of suggestions) {
          const cid = s.contact_id as number;
          if (seen.has(cid)) continue;
          seen.add(cid);
          top.push(s);
          if (top.length >= 10) break;
        }
        // Bulk-load contact rows. We hit /api/contacts/{id} per contact —
        // 10 round-trips is fine for a landing page.
        const contacts: typeof items = [];
        for (const s of top) {
          try {
            const c = await contactsApi.get(s.contact_id as number) as Contact;
            contacts.push({
              contact: c,
              rationale: s.rationale,
              urgency: s.urgency,
              created_at: data.generated_at,
            });
          } catch { /* skip if missing */ }
        }
        if (alive) setItems(contacts);
      } catch { /* silent */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="p-6">
      <h2
        className="font-display font-bold mb-1"
        style={{ fontSize: 24, color: "var(--text-primary)" }}
      >
        Priority contacts
      </h2>
      <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
        Top {items.length} contacts that need your attention — click to view details
      </p>
      {loading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading priority contacts…</p>
      ) : items.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No priority contacts right now. Pick one from the left to view details.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map(({ contact, rationale, urgency }) => (
            <button
              key={contact.id}
              onClick={() => onPick(contact)}
              className="text-left rounded-xl p-4 transition-shadow hover:shadow-sm bg-white"
              style={{ border: "1px solid var(--border-faint)" }}
            >
              <div className="flex items-start gap-3">
                <Avatar contact={contact} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm" style={{ color: "var(--text-primary)" }}>
                    {contact.first_name} {contact.last_name}
                  </p>
                  {contact.company_name && (
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                      {contact.company_name}
                    </p>
                  )}
                  <p
                    className="text-xs mt-1.5 line-clamp-2"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {rationale}
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {contact.lead_status && contact.lead_status !== "new" && (
                      <StatusBadge status={contact.lead_status} />
                    )}
                    <span
                      className="rounded-full"
                      style={{
                        background:
                          urgency === "high" ? "var(--brand-red-soft)" :
                          urgency === "medium" ? "var(--brand-amber-soft)" :
                          "var(--bg-app)",
                        color:
                          urgency === "high" ? "var(--brand-red)" :
                          urgency === "medium" ? "var(--brand-amber-dark)" :
                          "var(--text-muted)",
                        padding: "1px 8px",
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                      }}
                    >
                      {urgency}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


/**
 * Phase C: per-contact Suggestions panel at the bottom of the detail view.
 * Filters the global rule engine output to only this contact_id; renders
 * each suggestion with a Log Action / Snooze button row.
 */
function ContactSuggestions({
  contactId, onLogAction,
}: { contactId: number; onLogAction: () => void }) {
  const [items, setItems] = useState<{ rule_id: string; rationale: string; urgency: string; suggested_action: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await aiApi.suggestTodos() as {
          suggestions: { rule_id: string; contact_id: number | null; rationale: string; urgency: string; suggested_action: string }[];
        };
        const filtered = (data.suggestions || []).filter(s => s.contact_id === contactId);
        if (alive) setItems(filtered);
      } catch { /* silent */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [contactId]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle
          className="font-display font-bold"
          style={{ fontSize: 18, color: "var(--text-primary)" }}
        >
          Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
            No suggestions right now — log activity to seed new ones.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((s) => (
              <li
                key={s.rule_id}
                className="rounded-lg p-3"
                style={{ background: "var(--bg-app)" }}
              >
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                  {s.rationale}
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={onLogAction}
                    className="text-[12px] px-3 py-1 rounded-full text-white"
                    style={{ background: "var(--brand-blue)" }}
                  >
                    Log Action
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await tasksApi.snoozeSuggestion({
                          rule_id: s.rule_id,
                          contact_id: contactId,
                          days: 7,
                        });
                        setItems(prev => prev.filter(x => x.rule_id !== s.rule_id));
                      } catch { /* silent */ }
                    }}
                    className="text-[12px] px-3 py-1 rounded-full border"
                    style={{
                      background: "var(--bg-card)",
                      color: "var(--text-secondary)",
                      borderColor: "var(--border-strong)",
                    }}
                  >
                    Snooze 7d
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}


// Wrap in <Suspense> — useSearchParams() requires it per Next.js 16
// prerender rules. Without this, `npm run build` fails for this route.
export default function ContactsPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        </AppShell>
      }
    >
      <ContactsContent />
    </Suspense>
  );
}
