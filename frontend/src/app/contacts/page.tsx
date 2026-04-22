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
import { contactsApi, activitiesApi, aiApi } from "@/lib/api";

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
  created_at: string;
  updated_at: string;
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

/** "Generated 3 days ago" / "Generated today" — 相对时间 */
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
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [emailComposeOpen, setEmailComposeOpen] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<EnrichResponse | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  // PATCH one field then merge the response back into selectedContact
  // 失败抛异常，让 <EditableField> 的 onSave 捕获显示红边框
  const updateField = async (field: keyof Contact, value: string): Promise<void> => {
    if (!selectedContact) return;
    const payload = { [field]: value || null } as Record<string, string | null>;
    const updated = await contactsApi.update(selectedContact.id, payload) as Contact;
    setSelectedContact(updated);
    // Also refresh left-panel list so name/company changes reflect there
    loadContacts();
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

  // 列表分页：每页 50，滚到底加载下一页
  // Pagination: 50 per page, infinite scroll at bottom.
  const PAGE_SIZE = 50;
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  /**
   * 加载联系人：append=false 重置列表（首次或搜索变化时用），append=true 追加下一页。
   * Backend 已支持 search（first/last/email/company/title ilike）+ skip + limit。
   */
  const loadContacts = useCallback(async (
    searchTerm?: string,
    append = false,
    skip = 0,
  ) => {
    if (append) setLoadingMore(true);
    try {
      const data = await contactsApi.list(searchTerm, skip, PAGE_SIZE);
      if (append) {
        setContacts(prev => [...prev, ...(data.contacts || [])]);
      } else {
        setContacts(data.contacts || []);
      }
      setTotalCount(data.total || 0);
    } catch {
      if (!append) setContacts([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // 滚到底部自动加载下一页
  const handleListScroll = useCallback(() => {
    const el = listScrollRef.current;
    if (!el || loadingMore) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    // 距底部 120px 内触发
    if (scrollHeight - scrollTop - clientHeight < 120) {
      if (contacts.length < totalCount) {
        loadContacts(search || undefined, true, contacts.length);
      }
    }
  }, [loadingMore, contacts.length, totalCount, search, loadContacts]);

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

  // Initial load
  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // If a contact ID is in the URL, select it
  useEffect(() => {
    if (preselectedId && contacts.length > 0) {
      const found = contacts.find((c) => c.id === Number(preselectedId));
      if (found) {
        setSelectedContact(found);
        loadActivities(found.id);
      }
    }
  }, [preselectedId, contacts, loadActivities]);

  // Search with debounce — 重置列表，从 skip=0 开始
  // Debounce search → reload page 1 (server-side filter)
  useEffect(() => {
    const timer = setTimeout(() => {
      // Reset scroll + reload from start
      if (listScrollRef.current) listScrollRef.current.scrollTop = 0;
      loadContacts(search || undefined, false, 0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, loadContacts]);

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

          {/* Contact list */}
          <div
            ref={listScrollRef}
            onScroll={handleListScroll}
            className="flex-1 overflow-y-auto"
          >
            {loading ? (
              <p className="text-sm text-gray-400 p-4">Loading...</p>
            ) : contacts.length === 0 ? (
              <p className="text-sm text-gray-400 p-4">
                No contacts found. Click &quot;+ Add&quot; to create one.
              </p>
            ) : (
              contacts.map((contact) => (
                <div
                  key={contact.id}
                  className={`flex items-center gap-2 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer ${
                    selectedContact?.id === contact.id ? "bg-gray-100" : ""
                  }`}
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
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-gray-900">
                      {contact.first_name} {contact.last_name}
                    </p>
                    {contact.title && (
                      <p className="text-xs text-gray-500 truncate">
                        {contact.title}
                      </p>
                    )}
                    {contact.company_name && (
                      <p className="text-xs text-gray-400 truncate">
                        {contact.company_name}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
            {loadingMore && (
              <p className="text-xs text-gray-400 text-center py-3">Loading more…</p>
            )}
          </div>
        </div>

        {/* === Right Panel: Contact Detail (70%) === */}
        <div className="w-[70%] overflow-y-auto">
          {selectedContact === null ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              Select a contact to view details
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* --- Basic Info + Log Activity button --- */}
              <div>
                <div className="flex items-start justify-between">
                  <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-1">
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
                  <div className="flex gap-2">
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
                      title="Coming soon — please send emails from your Gmail directly"
                      className="cursor-not-allowed bg-slate-100 text-slate-400"
                    >
                      Send Email
                    </Button>
                    <Button size="sm" onClick={() => setQuickEntryOpen(true)}>
                      + Log Activity
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
                      AI Person Report
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
                        // 403 = limit hit, pop the alert modal
                        if (e instanceof Error && e.message.includes("daily_limit")) {
                          setShowLimitModal(true);
                        }
                        refreshAIBudget();
                      }
                      setGeneratingPersonReport(false);
                    }}
                  >
                    {generatingPersonReport ? "Generating..." : selectedContact.ai_person_report ? "Regenerate" : "Generate"}
                  </Button>
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
                      AI Company Report
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
                    {generatingCompanyReport ? "Generating..." : selectedContact.ai_company_report ? "Regenerate" : "Generate"}
                  </Button>
                </CardHeader>
                <CardContent>
                  {generatingCompanyReport ? (
                    <p className="text-sm text-gray-400 animate-pulse">AI is researching this company...</p>
                  ) : selectedContact.ai_company_report ? (
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">
                      {selectedContact.ai_company_report}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400 italic">
                      Click &quot;Generate&quot; to create an AI company analysis.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Separator />

              {/* --- Activity Timeline --- */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  Activity Timeline
                </h3>
                {activitiesLoading ? (
                  <p className="text-sm text-gray-400">Loading activities...</p>
                ) : activities.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">
                    No activities recorded yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {activities.map((activity) => (
                      <div
                        key={activity.id}
                        className="flex items-start gap-3 p-3 rounded-md bg-gray-50"
                      >
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
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* --- AI Suggestions Panel (placeholder) --- */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-700">
                    AI Suggestions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-400 italic">
                    AI-powered follow-up suggestions will appear here once there are enough activities logged.
                  </p>
                </CardContent>
              </Card>
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
          loadContacts();
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
        onSuccess={() => loadContacts()}
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
    </AppShell>
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
