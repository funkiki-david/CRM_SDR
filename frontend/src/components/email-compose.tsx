/**
 * Email Compose Dialog — Write and send cold emails from within the CRM
 * Flow: Select template (optional) → Auto-fill variables → Edit → Pick sender → Send
 * Opens from the contact detail page
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
import { Badge } from "@/components/ui/badge";
import { templatesApi, emailsApi, aiApi } from "@/lib/api";
import { useAIBudget, AIBudgetBadge, AILimitModal } from "@/components/ai-budget";

interface EmailComposeProps {
  open: boolean;
  onClose: () => void;
  contactId: number;
  contactName: string;
  contactEmail: string | null;
  onSuccess?: () => void;
}

interface Template {
  id: number;
  name: string;
  subject: string;
  body: string;
}

interface EmailAccount {
  id: number;
  email_address: string;
  display_name: string | null;
  provider_type: string;    // "smtp" | "gmail_oauth" | "outlook_oauth"
  is_active: boolean;
}

const PROVIDER_LABEL: Record<string, string> = {
  smtp: "SMTP",
  gmail_oauth: "Gmail",
  outlook_oauth: "Outlook",
};

const LAST_ACCOUNT_KEY = "email_compose_last_account_id";

export default function EmailCompose({
  open,
  onClose,
  contactId,
  contactName,
  contactEmail,
  onSuccess,
}: EmailComposeProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const { usage: aiUsage, refresh: refreshAIBudget } = useAIBudget();
  const [showLimitModal, setShowLimitModal] = useState(false);

  // Load templates and accounts when dialog opens
  useEffect(() => {
    if (!open) return;
    setSubject("");
    setBody("");
    setSelectedTemplateId(null);
    setError("");
    setSuccess(false);

    templatesApi.list().then(setTemplates).catch(() => {});
    emailsApi.listAccounts().then((accs: EmailAccount[]) => {
      // 只列 active 账号 —— 停用的不给发
      const active = accs.filter(a => a.is_active);
      setAccounts(active);
      if (active.length === 0) {
        setSelectedAccountId(null);
        return;
      }
      // 优先用上次选的账号（持久化在 localStorage）
      const lastId = typeof window !== "undefined"
        ? Number(localStorage.getItem(LAST_ACCOUNT_KEY)) || null
        : null;
      const preferred = lastId && active.find(a => a.id === lastId);
      setSelectedAccountId(preferred ? preferred.id : active[0].id);
    }).catch(() => {});
  }, [open]);

  // 选择变化时持久化
  function handleAccountChange(accountId: number) {
    setSelectedAccountId(accountId);
    if (typeof window !== "undefined") {
      localStorage.setItem(LAST_ACCOUNT_KEY, String(accountId));
    }
  }

  // When a template is selected, preview it with contact data
  async function handleSelectTemplate(templateId: number) {
    setSelectedTemplateId(templateId);
    try {
      const preview = await emailsApi.preview(contactId, templateId);
      setSubject(preview.subject);
      setBody(preview.body);
    } catch {
      // Fallback: use raw template
      const template = templates.find((t) => t.id === templateId);
      if (template) {
        setSubject(template.subject);
        setBody(template.body);
      }
    }
  }

  async function handleSend() {
    if (!subject.trim()) {
      setError("Please enter a subject line");
      return;
    }
    if (!body.trim()) {
      setError("Please enter the email body");
      return;
    }
    if (!contactEmail) {
      setError("This contact has no email address");
      return;
    }

    setSending(true);
    setError("");

    try {
      await emailsApi.send({
        contact_id: contactId,
        email_account_id: selectedAccountId,
        template_id: selectedTemplateId,
        subject,
        body,
      });
      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compose Email</DialogTitle>
          <p className="text-sm text-gray-500">
            To: {contactName} {contactEmail ? `<${contactEmail}>` : "(no email)"}
          </p>
        </DialogHeader>

        {success ? (
          <div className="py-8 text-center text-green-600 font-medium">
            Email sent successfully!
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {/* Template selector */}
            <div className="space-y-2">
              <Label>Template <span className="text-gray-400 font-normal">(optional — pick one to auto-fill)</span></Label>
              <div className="flex gap-2 flex-wrap">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleSelectTemplate(t.id)}
                    className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                      selectedTemplateId === t.id
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 text-gray-600 hover:border-gray-400"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
                {templates.length === 0 && (
                  <p className="text-sm text-gray-400">No templates yet. Create one in the Templates page.</p>
                )}
                <button
                  onClick={async () => {
                    if (aiUsage?.at_limit) { setShowLimitModal(true); return; }
                    setDrafting(true);
                    try {
                      // Pass selected account so AI uses its display_name + company in the signature
                      const draft = await aiApi.draftEmail(contactId, selectedAccountId ?? undefined);
                      setSubject(draft.subject || "");
                      setBody(draft.body || "");
                      refreshAIBudget();
                    } catch (e) {
                      if (e instanceof Error && e.message.includes("daily_limit")) {
                        setShowLimitModal(true);
                      }
                      refreshAIBudget();
                    }
                    setDrafting(false);
                  }}
                  disabled={drafting || aiUsage?.at_limit}
                  className="px-3 py-1.5 rounded-full border text-sm transition-colors border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                >
                  {drafting ? "AI writing..." : "\u2728 AI Draft"}
                </button>
                <AIBudgetBadge usage={aiUsage} compact />
              </div>
            </div>

            {/* Sender account */}
            <div className="space-y-2">
              <Label>From</Label>
              {accounts.length === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
                  No email account connected.{" "}
                  <a href="/settings" className="underline font-medium">Go to Settings</a>{" "}
                  to add one.
                </div>
              ) : (
                <select
                  value={selectedAccountId ?? ""}
                  onChange={(e) => handleAccountChange(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-md border border-input bg-transparent text-sm"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.email_address} ({PROVIDER_LABEL[acc.provider_type] ?? acc.provider_type})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Subject */}
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                placeholder="Email subject line..."
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>

            {/* Body */}
            <div className="space-y-2">
              <Label>Body</Label>
              <Textarea
                placeholder="Write your email here..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                className="font-mono text-sm"
              />
            </div>

            {/* Variable hints */}
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-gray-400">Variables:</span>
              {["{{first_name}}", "{{last_name}}", "{{company_name}}", "{{title}}", "{{industry}}", "{{sender_name}}"].map((v) => (
                <Badge key={v} variant="outline" className="text-xs font-mono cursor-pointer hover:bg-gray-100"
                  onClick={() => setBody(body + v)}
                >
                  {v}
                </Badge>
              ))}
            </div>

            {/* Error */}
            {error && <p className="text-sm text-red-500">{error}</p>}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={handleSend}
                disabled={sending || !contactEmail || !selectedAccountId}
                title={!selectedAccountId ? "Connect an email account in Settings first" : undefined}
              >
                {sending ? "Sending..." : "Send Email"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
      <AILimitModal open={showLimitModal} usage={aiUsage} onClose={() => setShowLimitModal(false)} />
    </Dialog>
  );
}
