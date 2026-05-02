/**
 * Quick Entry / Log Action Modal
 *
 * Phase E redesign — 680px wide, recent-contact chips, type cards,
 * quick-fill templates, outcome + temperature + duration fields,
 * smart follow-up suggestions, voice button below Notes,
 * and a success state replacement.
 *
 * Voice and lead-status fields kept from previous version.
 */
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { contactsApi, activitiesApi } from "@/lib/api";

// === Types ===

interface ContactOption {
  id: number;
  first_name: string;
  last_name: string;
  company_name: string | null;
}

interface QuickEntryProps {
  open: boolean;
  onClose: () => void;
  /** Pre-select a contact (when opened from contact detail) */
  preselectedContactId?: number | null;
  /** Called after successful submission */
  onSuccess?: () => void;
}

type Outcome = "positive" | "neutral" | "no_answer" | "negative";
type Temperature = "hot" | "warm" | "neutral" | "cold";
type ActivityTypeValue = "call" | "email" | "linkedin" | "meeting" | "note";

// Activity types: 5 equal-width cards (emoji on top, label below)
const ACTIVITY_TYPES: { value: ActivityTypeValue; label: string; icon: string }[] = [
  { value: "call",     label: "Call",     icon: "\uD83D\uDCDE" }, // 📞
  { value: "email",    label: "Email",    icon: "\u2709\uFE0F" }, // ✉
  { value: "linkedin", label: "LinkedIn", icon: "\uD83D\uDD17" }, // 🔗
  { value: "meeting",  label: "Meeting",  icon: "\uD83D\uDCC5" }, // 📅
  { value: "note",     label: "Note",     icon: "\uD83D\uDCDD" }, // 📝
];

// Quick-fill templates — clicking pill auto-fills Summary
const QUICK_FILL_TEMPLATES = [
  "Left voicemail",
  "Sent intro email",
  "Sent pricing",
  "Sent sample pack",
  "Good conversation",
  "No answer",
];

// Outcome chips — single-select pill, colour-coded
const OUTCOMES: { value: Outcome; label: string; bg: string; fg: string; bgSoft: string }[] = [
  { value: "positive",  label: "Positive",  bg: "var(--brand-green)", fg: "#ffffff", bgSoft: "var(--brand-green-soft)" },
  { value: "neutral",   label: "Neutral",   bg: "var(--brand-amber)", fg: "#ffffff", bgSoft: "var(--brand-amber-soft)" },
  { value: "no_answer", label: "No answer", bg: "var(--brand-blue)",  fg: "#ffffff", bgSoft: "var(--brand-blue-soft)" },
  { value: "negative",  label: "Negative",  bg: "var(--brand-red)",   fg: "#ffffff", bgSoft: "var(--brand-red-soft)" },
];

// Temperature cards — single-select with emoji
const TEMPERATURES: { value: Temperature; label: string; icon: string }[] = [
  { value: "hot",     label: "Hot",     icon: "\uD83D\uDD25" }, // 🔥
  { value: "warm",    label: "Warm",    icon: "\u2600\uFE0F" }, // ☀️
  { value: "neutral", label: "Neutral", icon: "\uD83D\uDE10" }, // 😐
  { value: "cold",    label: "Cold",    icon: "\uD83E\uDDCA" }, // 🧊
];

// Duration quick-set pills (minutes)
const DURATION_PRESETS = [
  { label: "5m",  minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h",  minutes: 60 },
];

// Smart follow-up suggestions
const FOLLOWUP_SUGGESTIONS = [
  { label: "3 days",   days: 3 },
  { label: "1 week",   days: 7 },
  { label: "2 weeks",  days: 14 },
  { label: "1 month",  days: 30 },
];

// Type → default follow-up days (Note has no default)
const FOLLOWUP_DEFAULTS: Partial<Record<ActivityTypeValue, number>> = {
  call: 3,
  email: 7,
  meeting: 3,
  linkedin: 7,
};

// localStorage keys
const LS_RECENT_CONTACTS = "sdr_crm_recent_contacts_v1";
const LS_TODAY_COUNT = "sdr_crm_actions_today_v1";
const RECENT_LIMIT = 5;

// === localStorage helpers ===

function loadRecentContacts(): ContactOption[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_RECENT_CONTACTS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecentContact(c: ContactOption) {
  if (typeof window === "undefined") return;
  const current = loadRecentContacts();
  const filtered = current.filter((r) => r.id !== c.id);
  const next = [c, ...filtered].slice(0, RECENT_LIMIT);
  window.localStorage.setItem(LS_RECENT_CONTACTS, JSON.stringify(next));
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function loadTodayCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(LS_TODAY_COUNT);
    if (!raw) return 0;
    const obj = JSON.parse(raw) as { date?: string; count?: number };
    return obj.date === todayKey() ? (obj.count ?? 0) : 0;
  } catch {
    return 0;
  }
}

function bumpTodayCount(): number {
  if (typeof window === "undefined") return 0;
  const next = loadTodayCount() + 1;
  window.localStorage.setItem(
    LS_TODAY_COUNT,
    JSON.stringify({ date: todayKey(), count: next })
  );
  return next;
}

function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function QuickEntry({
  open,
  onClose,
  preselectedContactId,
  onSuccess,
}: QuickEntryProps) {
  // === Form state ===
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<ContactOption | null>(null);
  const [selectedType, setSelectedType] = useState<ActivityTypeValue | null>(null);
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [temperature, setTemperature] = useState<Temperature | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | "">("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpDateTouched, setFollowUpDateTouched] = useState(false);
  const [followUpReason, setFollowUpReason] = useState("");
  const [leadStatus, setLeadStatus] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [successCount, setSuccessCount] = useState(0);

  // Recent contacts + today counter (localStorage-backed)
  const [recentContacts, setRecentContacts] = useState<ContactOption[]>([]);
  const [todayCount, setTodayCount] = useState(0);

  // Voice recording state
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // === Contact loading ===
  const loadContactsList = useCallback(async (search?: string) => {
    try {
      const data = await contactsApi.list(search, 0, 20);
      setContacts(data.contacts || []);
    } catch {
      // Silently fail — list will just be empty
    }
  }, []);

  // Reset form on open
  useEffect(() => {
    if (!open) return;
    loadContactsList();
    setRecentContacts(loadRecentContacts());
    setTodayCount(loadTodayCount());

    setSelectedType(null);
    setSubject("");
    setContent("");
    setOutcome(null);
    setTemperature(null);
    setDurationMinutes("");
    setFollowUpDate("");
    setFollowUpDateTouched(false);
    setFollowUpReason("");
    setLeadStatus("");
    setError("");
    setSuccess(false);
    setSuccessCount(0);
    setContactSearch("");

    if (!preselectedContactId) {
      setSelectedContact(null);
    }
  }, [open, loadContactsList, preselectedContactId]);

  // Apply preselected contact once contacts arrive
  useEffect(() => {
    if (preselectedContactId && contacts.length > 0) {
      const found = contacts.find((c) => c.id === preselectedContactId);
      if (found) setSelectedContact(found);
    }
  }, [preselectedContactId, contacts]);

  // Debounced contact search
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      loadContactsList(contactSearch || undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [contactSearch, open, loadContactsList]);

  // Smart follow-up: when type changes and user hasn't manually edited the date,
  // pre-fill the recommended default for that type (Call=3d, Email=1w, etc).
  useEffect(() => {
    if (!selectedType || followUpDateTouched) return;
    const days = FOLLOWUP_DEFAULTS[selectedType];
    if (days === undefined) {
      setFollowUpDate("");
    } else {
      setFollowUpDate(addDaysISO(days));
    }
  }, [selectedType, followUpDateTouched]);

  // === Voice Input (Web Speech API) ===
  function toggleVoice() {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }

  function startListening() {
    const w = window as typeof window & {
      SpeechRecognition?: typeof window.SpeechRecognition;
      webkitSpeechRecognition?: typeof window.SpeechRecognition;
    };
    const SpeechRecognitionCtor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setError("Voice input is not supported in this browser. Please use Chrome.");
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setContent(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }

  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }

  // === Submit ===
  async function handleSubmit() {
    if (!selectedContact) {
      setError("Please select a contact");
      return;
    }
    if (!selectedType) {
      setError("Please select an activity type");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await activitiesApi.create({
        contact_id: selectedContact.id,
        activity_type: selectedType,
        subject: subject || null,
        content: content || null,
        outcome: outcome || null,
        temperature: temperature || null,
        duration_minutes: typeof durationMinutes === "number" ? durationMinutes : null,
        next_follow_up: followUpDate || null,
        follow_up_reason: followUpReason || null,
        lead_status_update: leadStatus || null,
      });

      // Local-only side effects (recent + today counter)
      saveRecentContact(selectedContact);
      const newCount = bumpTodayCount();
      setSuccessCount(newCount);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save activity");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDone() {
    onSuccess?.();
    onClose();
  }

  // Submit on Enter (when not in textarea)
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA") return;
      if (success) return;
      if (!submitting) handleSubmit();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[680px] rounded-[20px] p-0 gap-0 max-h-[90vh] overflow-hidden flex flex-col"
        style={{ background: "var(--bg-card)" }}
      >
        {success ? (
          // === Success state ===
          <div className="px-8 py-12 text-center space-y-4">
            <div className="text-6xl mb-2" aria-hidden>
              {"\uD83D\uDD25"}
            </div>
            <h2
              className="font-display font-bold"
              style={{ fontSize: 28, color: "var(--text-primary)" }}
            >
              Action logged!
            </h2>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              You&rsquo;ve logged {successCount} {successCount === 1 ? "action" : "actions"} today.
            </p>
            <div className="pt-4">
              <Button
                onClick={handleDone}
                className="px-8"
                style={{ background: "var(--brand-navy)", color: "#ffffff", borderColor: "var(--brand-navy)" }}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* === Header === */}
            <div
              className="flex items-center justify-between px-6 py-5"
              style={{ borderBottom: "1px solid var(--border-faint)" }}
            >
              <div className="flex items-center gap-3">
                <h2
                  className="font-display font-bold"
                  style={{ fontSize: 22, color: "var(--text-primary)" }}
                >
                  Log action
                </h2>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
                  style={{
                    background: "var(--brand-amber-soft)",
                    color: "var(--brand-amber-dark)",
                  }}
                  title="Activities logged today (local count)"
                >
                  <span aria-hidden>{"\uD83D\uDD25"}</span>
                  {todayCount} today
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex items-center justify-center transition-colors"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  background: "var(--border-faint)",
                  color: "var(--text-secondary)",
                  fontSize: 16,
                  lineHeight: 1,
                }}
              >
                {"\u2715"}
              </button>
            </div>

            {/* === Body (scrollable) === */}
            <div
              className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
              onKeyDown={handleKeyDown}
            >
              {/* Contact */}
              <div className="space-y-2">
                <Label>Contact</Label>
                {selectedContact ? (
                  <div
                    className="flex items-center justify-between p-3 rounded-xl"
                    style={{ background: "var(--brand-blue-soft)" }}
                  >
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {selectedContact.first_name} {selectedContact.last_name}
                      {selectedContact.company_name && (
                        <span className="font-normal" style={{ color: "var(--text-secondary)" }}>
                          {" "}at {selectedContact.company_name}
                        </span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedContact(null)}
                      className="text-xs"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <div>
                    <Input
                      placeholder="Search for a contact..."
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      className="mb-2"
                    />
                    {contacts.length > 0 && contactSearch && (
                      <div className="border rounded-xl max-h-32 overflow-y-auto">
                        {contacts.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setSelectedContact(c);
                              setContactSearch("");
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b last:border-b-0"
                          >
                            <span className="font-medium">
                              {c.first_name} {c.last_name}
                            </span>
                            {c.company_name && (
                              <span style={{ color: "var(--text-muted)" }}> at {c.company_name}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Recent contacts row */}
                    {recentContacts.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap mt-2">
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          Recent:
                        </span>
                        {recentContacts.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setSelectedContact(c)}
                            className="rounded-full px-3 py-1 text-xs transition-colors"
                            style={{
                              background: "var(--brand-blue-soft)",
                              color: "var(--brand-blue)",
                            }}
                          >
                            {c.first_name} {c.last_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Type — 5 equal-width cards */}
              <div className="space-y-2">
                <Label>Type</Label>
                <div className="grid grid-cols-5 gap-2">
                  {ACTIVITY_TYPES.map((type) => {
                    const isActive = selectedType === type.value;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setSelectedType(type.value)}
                        className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl transition-all"
                        style={{
                          border: isActive
                            ? "2px solid var(--brand-blue)"
                            : "1px solid var(--border-strong)",
                          background: isActive ? "var(--brand-blue-soft)" : "var(--bg-card)",
                          color: isActive ? "var(--brand-blue)" : "var(--text-secondary)",
                        }}
                      >
                        <span className="text-2xl" aria-hidden>{type.icon}</span>
                        <span className="text-xs font-medium">{type.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quick Fill */}
              <div className="space-y-2">
                <Label>
                  Quick fill{" "}
                  <span style={{ color: "var(--text-muted)" }} className="font-normal">
                    (optional)
                  </span>
                </Label>
                <div className="flex gap-2 flex-wrap">
                  {QUICK_FILL_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => setSubject(tpl)}
                      className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        border: "1px solid var(--border-strong)",
                        background: "var(--bg-card)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {tpl}
                    </button>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="space-y-2">
                <Label>
                  Summary{" "}
                  <span style={{ color: "var(--text-muted)" }} className="font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  placeholder="e.g. Discussed Q3 pricing with John"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              {/* Outcome + Temperature (2-column grid) */}
              <div className="grid grid-cols-2 gap-5">
                {/* Outcome */}
                <div className="space-y-2">
                  <Label>
                    Outcome{" "}
                    <span style={{ color: "var(--text-muted)" }} className="font-normal">
                      (optional)
                    </span>
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {OUTCOMES.map((o) => {
                      const isActive = outcome === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => setOutcome(isActive ? null : o.value)}
                          className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
                          style={{
                            background: isActive ? o.bg : o.bgSoft,
                            color: isActive ? o.fg : o.bg,
                            border: `1px solid ${o.bg}`,
                          }}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Temperature */}
                <div className="space-y-2">
                  <Label>
                    Temperature{" "}
                    <span style={{ color: "var(--text-muted)" }} className="font-normal">
                      (optional)
                    </span>
                  </Label>
                  <div className="grid grid-cols-4 gap-2">
                    {TEMPERATURES.map((t) => {
                      const isActive = temperature === t.value;
                      return (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setTemperature(isActive ? null : t.value)}
                          className="flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition-all"
                          style={{
                            border: isActive
                              ? "2px solid var(--brand-blue)"
                              : "1px solid var(--border-strong)",
                            background: isActive ? "var(--brand-blue-soft)" : "var(--bg-card)",
                            color: isActive ? "var(--brand-blue)" : "var(--text-secondary)",
                          }}
                        >
                          <span className="text-lg" aria-hidden>{t.icon}</span>
                          <span className="text-[11px] font-medium">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Duration (optional) */}
              <div className="space-y-2">
                <Label>
                  Duration{" "}
                  <span style={{ color: "var(--text-muted)" }} className="font-normal">
                    (optional)
                  </span>
                </Label>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      placeholder="min"
                      value={durationMinutes === "" ? "" : durationMinutes}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") setDurationMinutes("");
                        else {
                          const n = parseInt(v, 10);
                          setDurationMinutes(isNaN(n) ? "" : Math.max(0, n));
                        }
                      }}
                      className="w-24"
                    />
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      minutes
                    </span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {DURATION_PRESETS.map((p) => {
                      const isActive = durationMinutes === p.minutes;
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() =>
                            setDurationMinutes(isActive ? "" : p.minutes)
                          }
                          className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
                          style={{
                            border: "1px solid",
                            borderColor: isActive ? "var(--brand-blue)" : "var(--border-strong)",
                            background: isActive ? "var(--brand-blue-soft)" : "var(--bg-card)",
                            color: isActive ? "var(--brand-blue)" : "var(--text-secondary)",
                          }}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Notes + Voice Input */}
              <div className="space-y-2">
                <Label>
                  Notes{" "}
                  <span style={{ color: "var(--text-muted)" }} className="font-normal">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  placeholder="What happened? You can type or use voice input below..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={4}
                  className={isListening ? "border-red-300 bg-red-50" : ""}
                />
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={toggleVoice}
                    className="rounded-full px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2"
                    style={{
                      background: isListening ? "var(--brand-red)" : "var(--brand-red-soft)",
                      color: isListening ? "#ffffff" : "var(--brand-red)",
                      border: `1px solid var(--brand-red)`,
                    }}
                  >
                    <span aria-hidden>{isListening ? "\u25A0" : "\uD83C\uDF99\uFE0F"}</span>
                    {isListening ? "Stop recording" : "Voice input"}
                  </button>
                  {isListening && (
                    <p className="text-xs animate-pulse" style={{ color: "var(--brand-red)" }}>
                      Listening… speak now.
                    </p>
                  )}
                </div>
              </div>

              {/* Lead status — optional bump */}
              <div className="space-y-2">
                <Label>
                  Lead status{" "}
                  <span style={{ color: "var(--text-muted)" }} className="font-normal">
                    (optional — 推进到哪一步)
                  </span>
                </Label>
                <select
                  value={leadStatus}
                  onChange={(e) => setLeadStatus(e.target.value)}
                  className="w-full h-9 px-3 rounded-full border bg-white text-sm"
                  style={{ borderColor: "var(--border-strong)" }}
                >
                  <option value="">(不更新)</option>
                  <option value="new">新线索</option>
                  <option value="contacted">已联系</option>
                  <option value="interested">有兴趣</option>
                  <option value="meeting_set">已约会议</option>
                  <option value="proposal">已发提案</option>
                  <option value="closed_won">成交</option>
                  <option value="closed_lost">失败</option>
                </select>
              </div>

              {/* Next follow-up + smart suggest */}
              <div
                className="space-y-3 p-4 rounded-xl"
                style={{ background: "var(--bg-app)" }}
              >
                <Label>
                  Next follow-up{" "}
                  <span style={{ color: "var(--text-muted)" }} className="font-normal">
                    (optional)
                  </span>
                </Label>
                <div className="flex gap-2 flex-wrap">
                  <Input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => {
                      setFollowUpDate(e.target.value);
                      setFollowUpDateTouched(true);
                    }}
                    className="w-44"
                  />
                  <Input
                    placeholder="What to do next..."
                    value={followUpReason}
                    onChange={(e) => setFollowUpReason(e.target.value)}
                    className="flex-1 min-w-[200px]"
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {FOLLOWUP_SUGGESTIONS.map((s) => {
                    const target = addDaysISO(s.days);
                    const isActive = followUpDate === target;
                    return (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => {
                          setFollowUpDate(target);
                          setFollowUpDateTouched(true);
                        }}
                        className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
                        style={{
                          border: "1px solid",
                          borderColor: isActive ? "var(--brand-blue)" : "var(--border-strong)",
                          background: isActive ? "var(--brand-blue-soft)" : "var(--bg-card)",
                          color: isActive ? "var(--brand-blue)" : "var(--text-secondary)",
                        }}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Error */}
              {error && (
                <p className="text-sm" style={{ color: "var(--brand-red)" }}>
                  {error}
                </p>
              )}
            </div>

            {/* === Footer === */}
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{
                borderTop: "1px solid var(--border-faint)",
                background: "var(--bg-app)",
              }}
            >
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Tab to move · Enter to save
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  style={{
                    background: "var(--brand-navy)",
                    color: "#ffffff",
                    borderColor: "var(--brand-navy)",
                  }}
                >
                  {submitting ? "Saving..." : "Save action"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
