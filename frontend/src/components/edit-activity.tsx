/**
 * EditActivity — full modal for editing a logged Activity row.
 *
 * Replaces the earlier `prompt()` quick-edit with a proper dialog that
 * mirrors Log Activity's footprint (sm:max-w-lg). Pre-fills every field
 * from the existing record and PATCHes the changed fields back.
 *
 * Uses the project Dialog wrapper, which already blocks outside-press /
 * Escape close (Problem 2 rule).
 */
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { activitiesApi, contactsApi } from "@/lib/api";

interface ActivityShape {
  id: number;
  activity_type: string;
  subject: string | null;
  content: string | null;
  contact_id: number;
  contact_name?: string | null;
  created_at: string;
}

interface ContactOption {
  id: number;
  first_name: string;
  last_name: string;
  company_name: string | null;
}

interface EditActivityProps {
  open: boolean;
  activity: ActivityShape | null;
  onClose: () => void;
  onSaved: (updated: ActivityShape) => void;
}

const ACTIVITY_TYPES = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "meeting", label: "Meeting" },
  { value: "note", label: "Note" },
];

/** Convert ISO timestamp → "YYYY-MM-DD" for the date input. */
function isoToDateInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** Combine date input "YYYY-MM-DD" + the original time-of-day into ISO. */
function dateInputToIso(dateStr: string, originalIso: string): string | null {
  if (!dateStr) return null;
  const orig = new Date(originalIso);
  const isOrigValid = !isNaN(orig.getTime());
  // Keep original HH:MM:SS so re-saving without changing the date is a no-op.
  const [y, m, d] = dateStr.split("-").map(n => parseInt(n, 10));
  const out = new Date(Date.UTC(
    y, m - 1, d,
    isOrigValid ? orig.getUTCHours() : 12,
    isOrigValid ? orig.getUTCMinutes() : 0,
    isOrigValid ? orig.getUTCSeconds() : 0,
  ));
  return out.toISOString();
}

export default function EditActivity({ open, activity, onClose, onSaved }: EditActivityProps) {
  const [type, setType] = useState("note");
  const [contactId, setContactId] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // v1.3 § 11.4: optional lead.status update on edit. Default "(no change)".
  const [leadStatus, setLeadStatus] = useState<string>("");

  // Prefill whenever the dialog opens with a fresh activity
  useEffect(() => {
    if (!open || !activity) return;
    setType(activity.activity_type || "note");
    setContactId(activity.contact_id);
    setDate(isoToDateInput(activity.created_at));
    setSubject(activity.subject || "");
    setContent(activity.content || "");
    setLeadStatus("");  // edits default to "no change", to avoid stomping
    setError("");
  }, [open, activity]);

  // Pull a small page of contacts for the picker. The user can still type
  // search to refine — but for editing we mostly need the current contact
  // visible by default.
  useEffect(() => {
    if (!open) return;
    contactsApi.list(undefined, 0, 100)
      .then((d: { contacts: ContactOption[] }) => setContacts(d.contacts || []))
      .catch(() => setContacts([]));
  }, [open]);

  async function handleSave() {
    if (!activity) return;
    setSaving(true);
    setError("");
    try {
      const isoDate = activity.created_at && date
        ? dateInputToIso(date, activity.created_at)
        : null;
      const payload: Record<string, unknown> = {
        activity_type: type,
        subject: subject.trim() || null,
        content: content.trim() || null,
        contact_id: contactId,
      };
      if (isoDate) payload.created_at = isoDate;
      if (leadStatus) payload.lead_status_update = leadStatus;
      const updated = await activitiesApi.update(activity.id, payload) as ActivityShape;
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Activity</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Activity Type</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-sm"
            >
              {ACTIVITY_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Contact</Label>
            <select
              value={contactId ?? ""}
              onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : null)}
              className="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-sm"
            >
              {/* Always include the current contact so it's selectable even
                  if the search-scoped /api/contacts page doesn't include it. */}
              {activity && !contacts.some(c => c.id === activity.contact_id) && (
                <option value={activity.contact_id}>
                  {activity.contact_name || `Contact #${activity.contact_id}`}
                </option>
              )}
              {contacts.map(c => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}
                  {c.company_name ? ` — ${c.company_name}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief subject line..."
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What happened during this activity..."
              className="min-h-[140px] text-sm"
              rows={6}
            />
          </div>

          {/* v1.3 § 11.4: optional lead status bump */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              Lead Status <span className="text-slate-400">(optional — advance to which stage)</span>
            </Label>
            <select
              value={leadStatus}
              onChange={(e) => setLeadStatus(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-sm"
            >
              <option value="">(no change)</option>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="interested">Interested</option>
              <option value="meeting_set">Meeting set</option>
              <option value="proposal">Proposal sent</option>
              <option value="closed_won">Closed-won</option>
              <option value="closed_lost">Closed-lost</option>
            </select>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
