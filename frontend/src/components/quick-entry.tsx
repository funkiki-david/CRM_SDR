/**
 * Quick Entry Dialog — Log a new activity in seconds
 * Flow: Select contact → Select type → Write notes (or speak) → Submit
 * Can be opened from anywhere via the "+" button in the nav bar
 */
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
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

// Activity types with display labels and icons
const activityTypes = [
  { value: "call", label: "Call", icon: "\u260E" },
  { value: "email", label: "Email", icon: "\u2709" },
  { value: "linkedin", label: "LinkedIn", icon: "\uD83D\uDD17" },
  { value: "meeting", label: "Meeting", icon: "\uD83D\uDCC5" },
  { value: "note", label: "Note", icon: "\uD83D\uDCDD" },
];

export default function QuickEntry({
  open,
  onClose,
  preselectedContactId,
  onSuccess,
}: QuickEntryProps) {
  // Form state
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<ContactOption | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpReason, setFollowUpReason] = useState("");
  // v1.3 § 11.4: optional lead.status update via Log Activity dropdown.
  // Default empty string = "(不更新)" — sent as null to backend.
  const [leadStatus, setLeadStatus] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Voice recording state
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Load contacts for search
  const loadContacts = useCallback(async (search?: string) => {
    try {
      const data = await contactsApi.list(search, 0, 20);
      setContacts(data.contacts || []);
    } catch {
      // Silently fail — contacts will just be empty
    }
  }, []);

  // Load contacts on open
  useEffect(() => {
    if (open) {
      loadContacts();
      // Reset form
      setSelectedType(null);
      setSubject("");
      setContent("");
      setFollowUpDate("");
      setFollowUpReason("");
      setLeadStatus("");  // v1.3 default "(不更新)"
      setError("");
      setSuccess(false);
      setContactSearch("");

      // If a contact was preselected, don't clear it
      if (!preselectedContactId) {
        setSelectedContact(null);
      }
    }
  }, [open, loadContacts, preselectedContactId]);

  // Handle preselected contact
  useEffect(() => {
    if (preselectedContactId && contacts.length > 0) {
      const found = contacts.find((c) => c.id === preselectedContactId);
      if (found) setSelectedContact(found);
    }
  }, [preselectedContactId, contacts]);

  // Search contacts with debounce
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      loadContacts(contactSearch || undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [contactSearch, open, loadContacts]);

  // === Voice Input (Web Speech API) ===
  function toggleVoice() {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }

  function startListening() {
    // Check browser support
    const SpeechRecognition =
      (window as typeof window & { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition ||
      (window as typeof window & { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Voice input is not supported in this browser. Please use Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
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

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

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
        next_follow_up: followUpDate || null,
        follow_up_reason: followUpReason || null,
        // v1.3: empty string = SDR didn't choose, leave lead alone
        lead_status_update: leadStatus || null,
      });

      setSuccess(true);
      // Auto-close after a brief pause
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save activity");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log Activity</DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="py-8 text-center text-green-600 font-medium">
            Activity saved!
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {/* Step 1: Select Contact */}
            <div className="space-y-2">
              <Label>Contact</Label>
              {selectedContact ? (
                <div className="flex items-center justify-between p-2 bg-gray-50 rounded-md">
                  <span className="text-sm font-medium">
                    {selectedContact.first_name} {selectedContact.last_name}
                    {selectedContact.company_name && (
                      <span className="text-gray-400 font-normal">
                        {" "}at {selectedContact.company_name}
                      </span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedContact(null)}
                    className="text-xs text-gray-400"
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
                    className="mb-1"
                  />
                  {contacts.length > 0 && (
                    <div className="border rounded-md max-h-32 overflow-y-auto">
                      {contacts.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setSelectedContact(c);
                            setContactSearch("");
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b last:border-b-0"
                        >
                          <span className="font-medium">
                            {c.first_name} {c.last_name}
                          </span>
                          {c.company_name && (
                            <span className="text-gray-400"> at {c.company_name}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: Select Activity Type */}
            <div className="space-y-2">
              <Label>Type</Label>
              <div className="flex gap-2 flex-wrap">
                {activityTypes.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setSelectedType(type.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors ${
                      selectedType === type.value
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 text-gray-600 hover:border-gray-400"
                    }`}
                  >
                    <span>{type.icon}</span>
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 3: Subject (one-line summary) */}
            <div className="space-y-2">
              <Label>Summary <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Input
                placeholder="e.g. Discussed Q3 pricing with John"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>

            {/* Step 4: Notes with voice input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Notes <span className="text-gray-400 font-normal">(optional)</span></Label>
                <Button
                  type="button"
                  variant={isListening ? "destructive" : "outline"}
                  size="sm"
                  onClick={toggleVoice}
                  className="text-xs h-7 px-2"
                >
                  {isListening ? "\uD83D\uDD34 Stop Recording" : "\uD83C\uDF99\uFE0F Voice Input"}
                </Button>
              </div>
              <Textarea
                placeholder="What happened? You can type or use voice input..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                className={isListening ? "border-red-300 bg-red-50" : ""}
              />
              {isListening && (
                <p className="text-xs text-red-500 animate-pulse">
                  Listening... Speak now. Click &quot;Stop Recording&quot; when done.
                </p>
              )}
            </div>

            {/* Step 4.5 (v1.3 § 11.4): Lead status — optional bump */}
            <div className="space-y-2">
              <Label>
                Lead Status{" "}
                <span className="text-gray-400 font-normal">(optional — 推进到哪一步)</span>
              </Label>
              <select
                value={leadStatus}
                onChange={(e) => setLeadStatus(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-sm"
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

            {/* Step 5: Next follow-up (optional) */}
            <div className="space-y-2 p-3 bg-gray-50 rounded-md">
              <Label>Next Follow-up <span className="text-gray-400 font-normal">(optional)</span></Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className="w-40"
                />
                <Input
                  placeholder="What to do next..."
                  value={followUpReason}
                  onChange={(e) => setFollowUpReason(e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>

            {/* Error message */}
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            {/* Submit button */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Saving..." : "Save Activity"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
