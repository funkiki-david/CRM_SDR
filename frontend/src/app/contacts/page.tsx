/**
 * Contacts Page — Split layout for browsing and viewing contacts
 * Left panel (30%): Searchable, scrollable contact list
 * Right panel (70%): Selected contact's full detail view
 */
"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/app-shell";
import QuickEntry from "@/components/quick-entry";
import EmailCompose from "@/components/email-compose";
import AddContact from "@/components/add-contact";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { contactsApi, activitiesApi, aiApi } from "@/lib/api";

// === Type definitions ===

interface Contact {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  company_name: string | null;
  company_domain: string | null;
  industry: string | null;
  company_size: string | null;
  city: string | null;
  state: string | null;
  linkedin_url: string | null;
  website: string | null;
  ai_person_report: string | null;
  ai_company_report: string | null;
  ai_tags: string | null;
  ai_person_generated_at: string | null;
  ai_company_generated_at: string | null;
  ai_report_model: string | null;
  created_at: string;
  updated_at: string;
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

/** "Generated 3 days ago" / "Generated today" — 相对时间 */
function relativeDays(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days < 1) return "Generated today";
  if (days === 1) return "Generated 1 day ago";
  return `Generated ${days} days ago`;
}

export default function ContactsPage() {
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
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [generatingPersonReport, setGeneratingPersonReport] = useState(false);
  const [generatingCompanyReport, setGeneratingCompanyReport] = useState(false);

  // Load contact list
  const loadContacts = useCallback(async (searchTerm?: string) => {
    try {
      const data = await contactsApi.list(searchTerm);
      setContacts(data.contacts || []);
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

  // Search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      loadContacts(search || undefined);
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
              <Button size="sm" variant="outline" className="text-xs h-7" disabled>
                ↓ Import
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-7" disabled>
                ↑ Export
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
            </div>
          )}

          {/* Contact list */}
          <div className="flex-1 overflow-y-auto">
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
                  <h2 className="text-xl font-semibold text-gray-900">
                    {selectedContact.first_name} {selectedContact.last_name}
                  </h2>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEmailComposeOpen(true)}>
                      Send Email
                    </Button>
                    <Button size="sm" onClick={() => setQuickEntryOpen(true)}>
                      + Log Activity
                    </Button>
                  </div>
                </div>
                {selectedContact.title && (
                  <p className="text-gray-600">
                    {selectedContact.title}
                    {selectedContact.company_name && ` at ${selectedContact.company_name}`}
                  </p>
                )}
                <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm text-gray-500">
                  {selectedContact.email && (
                    <span>
                      <span className="text-gray-400">Email:</span>{" "}
                      <a href={`mailto:${selectedContact.email}`} className="text-blue-600 hover:underline">
                        {selectedContact.email}
                      </a>
                    </span>
                  )}
                  {selectedContact.phone && (
                    <span>
                      <span className="text-gray-400">Phone:</span> {selectedContact.phone}
                    </span>
                  )}
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
                  {(selectedContact.city || selectedContact.state) && (
                    <span>
                      <span className="text-gray-400">Location:</span> {[selectedContact.city, selectedContact.state].filter(Boolean).join(", ")}
                    </span>
                  )}
                </div>
              </div>

              {/* --- LinkedIn & Website --- */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400 w-16 shrink-0">LinkedIn:</span>
                  {selectedContact.linkedin_url ? (
                    <a href={selectedContact.linkedin_url} target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 hover:underline truncate">
                      {selectedContact.linkedin_url.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : (
                    <span className="text-gray-300 flex items-center gap-1.5">
                      Not available
                      <button
                        onClick={() => {
                          const url = prompt("Enter LinkedIn URL:");
                          if (url) contactsApi.update(selectedContact.id, { linkedin_url: url }).then(() => {
                            setSelectedContact({ ...selectedContact, linkedin_url: url });
                          });
                        }}
                        className="text-xs text-blue-500 hover:underline"
                      >[+ Add]</button>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400 w-16 shrink-0">Website:</span>
                  {selectedContact.website ? (
                    <a href={selectedContact.website} target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 hover:underline truncate">
                      {selectedContact.website.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : (
                    <span className="text-gray-300 flex items-center gap-1.5">
                      Not available
                      <button
                        onClick={() => {
                          const url = prompt("Enter website URL:");
                          if (url) contactsApi.update(selectedContact.id, { website: url }).then(() => {
                            setSelectedContact({ ...selectedContact, website: url });
                          });
                        }}
                        className="text-xs text-blue-500 hover:underline"
                      >[+ Add]</button>
                    </span>
                  )}
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

              <Separator />

              {/* --- AI Person Research Report --- */}
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-medium text-gray-700">
                      AI Person Report
                    </CardTitle>
                    {selectedContact.ai_person_generated_at && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {relativeDays(selectedContact.ai_person_generated_at)}
                        {selectedContact.ai_report_model
                          ? ` · ${selectedContact.ai_report_model.replace("-20251001", "")}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    disabled={generatingPersonReport}
                    onClick={async () => {
                      setGeneratingPersonReport(true);
                      try {
                        // 已有报告则强制刷新（Regenerate 按钮行为）
                        const hasReport = !!selectedContact.ai_person_report;
                        const data = await aiApi.personReport(selectedContact.id, hasReport);
                        setSelectedContact({
                          ...selectedContact,
                          ai_person_report: data.report,
                          ai_tags: data.tags || selectedContact.ai_tags,
                          ai_person_generated_at: data.meta?.generated_at ?? selectedContact.ai_person_generated_at,
                          ai_report_model: data.meta?.model ?? selectedContact.ai_report_model,
                        });
                      } catch { /* ignore */ }
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
                    {selectedContact.ai_company_generated_at && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {relativeDays(selectedContact.ai_company_generated_at)}
                        {selectedContact.ai_report_model
                          ? ` · ${selectedContact.ai_report_model.replace("-20251001", "")}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    disabled={generatingCompanyReport}
                    onClick={async () => {
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
                      } catch { /* ignore */ }
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
