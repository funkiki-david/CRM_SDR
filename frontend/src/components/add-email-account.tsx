/**
 * Add Email Account Modal — three provider choices.
 *
 *   1. Google Gmail      → OAuth (placeholder until OAuth credentials are wired)
 *   2. Microsoft Outlook → OAuth (same; falls back to SMTP for now)
 *   3. Other SMTP        → Generic SMTP / IMAP form
 *
 * SMTP mode:
 *   - "Test Connection" validates credentials before saving
 *   - Password is encrypted with Fernet on the backend; plaintext only crosses
 *     the wire on the save request
 */
"use client";

import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { emailsApi, authApi } from "@/lib/api";

interface AddEmailAccountProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type Provider = "picker" | "gmail" | "outlook" | "smtp";

// SMTP presets keyed by email domain — auto-fills the form once a known
// domain is entered in the Other SMTP flow.
const SMTP_PRESETS: Record<string, Partial<SmtpForm>> = {
  "gmail.com": { smtp_host: "smtp.gmail.com", smtp_port: 587, imap_host: "imap.gmail.com", imap_port: 993, smtp_encryption: "starttls" },
  "googlemail.com": { smtp_host: "smtp.gmail.com", smtp_port: 587, imap_host: "imap.gmail.com", imap_port: 993, smtp_encryption: "starttls" },
  "graphictac.biz": { smtp_host: "smtp.gmail.com", smtp_port: 587, imap_host: "imap.gmail.com", imap_port: 993, smtp_encryption: "starttls" },
  "hostinger.com": { smtp_host: "smtp.hostinger.com", smtp_port: 465, imap_host: "imap.hostinger.com", imap_port: 993, smtp_encryption: "ssl" },
  "amazonsolutions.us": { smtp_host: "smtp.hostinger.com", smtp_port: 465, imap_host: "imap.hostinger.com", imap_port: 993, smtp_encryption: "ssl" },
  "outlook.com": { smtp_host: "smtp.office365.com", smtp_port: 587, imap_host: "outlook.office365.com", imap_port: 993, smtp_encryption: "starttls" },
  "office365.com": { smtp_host: "smtp.office365.com", smtp_port: 587, imap_host: "outlook.office365.com", imap_port: 993, smtp_encryption: "starttls" },
};

// Default SMTP settings per upstream provider — used when the user clicks
// "Use SMTP Instead" on the Gmail / Outlook screens.
const PROVIDER_DEFAULTS: Record<"gmail" | "outlook", Partial<SmtpForm>> = {
  gmail: { smtp_host: "smtp.gmail.com", smtp_port: 587, imap_host: "imap.gmail.com", imap_port: 993, smtp_encryption: "starttls" },
  outlook: { smtp_host: "smtp.office365.com", smtp_port: 587, imap_host: "outlook.office365.com", imap_port: 993, smtp_encryption: "starttls" },
};

interface SmtpForm {
  email_address: string;
  display_name: string;
  smtp_host: string;
  smtp_port: number;
  imap_host: string;
  imap_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_encryption: "ssl" | "starttls" | "none";
}

export default function AddEmailAccount({ open, onClose, onSuccess }: AddEmailAccountProps) {
  const [provider, setProvider] = useState<Provider>("picker");
  const [form, setForm] = useState<SmtpForm>({
    email_address: "",
    display_name: "",
    smtp_host: "",
    smtp_port: 465,
    imap_host: "",
    imap_port: 993,
    smtp_username: "",
    smtp_password: "",
    smtp_encryption: "ssl",
  });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setProvider("picker");
    setForm({
      email_address: "",
      display_name: "",
      smtp_host: "",
      smtp_port: 465,
      imap_host: "",
      imap_port: 993,
      smtp_username: "",
      smtp_password: "",
      smtp_encryption: "ssl",
    });
    setTesting(false);
    setSaving(false);
    setTestResult(null);
    setSaveError(null);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // When the email is typed, mirror it into username and try to apply a preset.
  const handleEmailChange = (val: string) => {
    const domain = val.split("@")[1]?.toLowerCase() || "";
    const preset = SMTP_PRESETS[domain] || {};
    setForm(prev => ({
      ...prev,
      email_address: val,
      smtp_username: val, // default username = email
      ...preset,
    }));
  };

  // Required-field validation; the UI shows "Missing: X, Y" using this list.
  const missingFields: string[] = [];
  if (!form.email_address.trim()) missingFields.push("Email");
  if (!form.smtp_host.trim()) missingFields.push("SMTP Server");
  if (!form.smtp_port) missingFields.push("SMTP Port");
  if (!form.smtp_username.trim()) missingFields.push("Username");
  if (!form.smtp_password.trim()) missingFields.push("Password");
  const allFilled = missingFields.length === 0;

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await emailsApi.testSmtp({
        smtp_host: form.smtp_host.trim(),
        smtp_port: form.smtp_port,
        smtp_username: form.smtp_username.trim(),
        smtp_password: form.smtp_password,
        smtp_encryption: form.smtp_encryption,
      });
      setTestResult({ ok: true, msg: "Connected and authenticated successfully ✓" });
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveSmtp = async () => {
    setSaving(true);
    setSaveError(null);
    setTestResult(null);
    try {
      // Test connection first — only save if authentication succeeds.
      try {
        await emailsApi.testSmtp({
          smtp_host: form.smtp_host.trim(),
          smtp_port: form.smtp_port,
          smtp_username: form.smtp_username.trim(),
          smtp_password: form.smtp_password,
          smtp_encryption: form.smtp_encryption,
        });
      } catch (e) {
        setSaveError(
          `Connection test failed — not saving. ${e instanceof Error ? e.message : ""}`
        );
        setSaving(false);
        return;
      }

      await emailsApi.addAccount({
        email_address: form.email_address.trim(),
        display_name: form.display_name.trim() || form.email_address.trim(),  // fallback to email
        provider_type: "smtp",
        smtp_host: form.smtp_host.trim(),
        smtp_port: form.smtp_port,
        imap_host: form.imap_host.trim() || undefined,
        imap_port: form.imap_port || undefined,
        smtp_username: form.smtp_username.trim(),
        smtp_password: form.smtp_password,
        smtp_encryption: form.smtp_encryption,
      });
      onSuccess?.();
      close();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {provider === "picker" && "Add Email Account"}
            {provider === "gmail" && "Connect Google Gmail"}
            {provider === "outlook" && "Connect Microsoft Outlook"}
            {provider === "smtp" && "Add Email (SMTP/IMAP)"}
          </DialogTitle>
        </DialogHeader>

        {/* === Step 1: Provider picker === */}
        {provider === "picker" && (
          <div className="py-4 space-y-4">
            <p className="text-sm text-gray-600">Choose your email provider:</p>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setProvider("gmail")}
                className="p-4 border rounded-lg hover:border-blue-500 hover:bg-blue-50 text-center transition"
              >
                <div className="text-2xl mb-1">📧</div>
                <p className="text-sm font-medium">Google</p>
                <p className="text-xs text-gray-500">Gmail</p>
              </button>
              <button
                onClick={() => setProvider("outlook")}
                className="p-4 border rounded-lg hover:border-blue-500 hover:bg-blue-50 text-center transition"
              >
                <div className="text-2xl mb-1">✉️</div>
                <p className="text-sm font-medium">Microsoft</p>
                <p className="text-xs text-gray-500">Outlook</p>
              </button>
              <button
                onClick={() => setProvider("smtp")}
                className="p-4 border rounded-lg hover:border-blue-500 hover:bg-blue-50 text-center transition"
              >
                <div className="text-2xl mb-1">⚙️</div>
                <p className="text-sm font-medium">Other</p>
                <p className="text-xs text-gray-500">SMTP</p>
              </button>
            </div>
          </div>
        )}

        {/* === Gmail OAuth === */}
        {provider === "gmail" && (
          <div className="py-4 space-y-3">
            <p className="text-sm text-gray-600">
              Connect your Gmail account using Google OAuth. You&rsquo;ll be redirected to
              Google to authorize, then sent back here automatically.
            </p>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800 space-y-1">
              <p className="font-medium">What we request:</p>
              <ul className="list-disc list-inside space-y-0.5 pl-1">
                <li>Send email on your behalf (<code>gmail.send</code>)</li>
                <li>Read your primary email address (<code>userinfo.email</code>)</li>
              </ul>
              <p className="mt-1.5 text-[11px]">
                We never read your inbox. Tokens are encrypted in the database.
              </p>
            </div>
            {saveError && (
              <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                {saveError}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  setSaveError(null);
                  try {
                    const { auth_url } = await authApi.googleOAuthStart();
                    window.location.href = auth_url;
                  } catch (e) {
                    setSaveError(
                      e instanceof Error
                        ? e.message
                        : "Google OAuth is not configured yet. Ask Admin to set GOOGLE_CLIENT_ID."
                    );
                  }
                }}
              >
                Connect with Google
              </Button>
              <Button variant="outline" onClick={() => {
                setForm(prev => ({ ...prev, ...PROVIDER_DEFAULTS.gmail }));
                setProvider("smtp");
              }}>
                Use App Password (SMTP) Instead
              </Button>
            </div>
          </div>
        )}

        {/* === Outlook OAuth placeholder === */}
        {provider === "outlook" && (
          <div className="py-4 space-y-3">
            <p className="text-sm text-gray-600">
              Microsoft Outlook OAuth (via Azure AD) requires future configuration.
            </p>
            <p className="text-sm text-gray-600">
              For now, connect using SMTP (Office 365 supports SMTP AUTH):
            </p>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 space-y-1">
              <p className="font-medium">ℹ️ Office 365 SMTP settings:</p>
              <p>Host: <code>smtp.office365.com</code> · Port: <code>587</code> · STARTTLS</p>
              <p className="text-[11px] mt-1">
                Note: SMTP AUTH must be enabled in your Microsoft 365 Admin Center
                (Users → Active users → select user → Mail → Manage email apps → Authenticated SMTP).
              </p>
            </div>
            <Button variant="outline" onClick={() => {
              setForm(prev => ({ ...prev, ...PROVIDER_DEFAULTS.outlook }));
              setProvider("smtp");
            }}>
              Use SMTP Instead
            </Button>
          </div>
        )}

        {/* === SMTP form === */}
        {provider === "smtp" && (
          <div className="py-2 space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <Label className="text-xs">Email Address</Label>
              <Input
                value={form.email_address}
                onChange={(e) => handleEmailChange(e.target.value)}
                placeholder="info@amazonsolutions.us"
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Display Name</Label>
              <Input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="David Zheng"
                className="h-9"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label className="text-xs">SMTP Server</Label>
                <Input
                  value={form.smtp_host}
                  onChange={(e) => setForm({ ...form, smtp_host: e.target.value })}
                  placeholder="smtp.hostinger.com"
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">SMTP Port</Label>
                <Input
                  type="number"
                  value={form.smtp_port}
                  onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value) })}
                  className="h-9"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label className="text-xs">IMAP Server (optional)</Label>
                <Input
                  value={form.imap_host}
                  onChange={(e) => setForm({ ...form, imap_host: e.target.value })}
                  placeholder="imap.hostinger.com"
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">IMAP Port</Label>
                <Input
                  type="number"
                  value={form.imap_port}
                  onChange={(e) => setForm({ ...form, imap_port: Number(e.target.value) })}
                  className="h-9"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Username</Label>
              <Input
                value={form.smtp_username}
                onChange={(e) => setForm({ ...form, smtp_username: e.target.value })}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Password</Label>
              <Input
                type="password"
                value={form.smtp_password}
                onChange={(e) => setForm({ ...form, smtp_password: e.target.value })}
                className="h-9"
                autoComplete="new-password"
              />
            </div>
            <div>
              <Label className="text-xs">Encryption</Label>
              <select
                value={form.smtp_encryption}
                onChange={(e) => setForm({ ...form, smtp_encryption: e.target.value as SmtpForm["smtp_encryption"] })}
                className="w-full h-9 px-3 rounded-md border border-input bg-transparent text-sm"
              >
                <option value="ssl">SSL/TLS (implicit, port 465)</option>
                <option value="starttls">STARTTLS (port 587)</option>
                <option value="none">None (not recommended)</option>
              </select>
            </div>

            {testResult && (
              <div className={`text-xs p-2 rounded border ${
                testResult.ok
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}>
                {testResult.msg}
              </div>
            )}
            {saveError && (
              <div className="text-xs p-2 rounded border bg-red-50 border-red-200 text-red-700">
                {saveError}
              </div>
            )}

            <p className="text-xs text-gray-400">
              Your password is encrypted with Fernet in the database. It is never stored in plaintext or exposed to the frontend.
            </p>
          </div>
        )}

        {/* === Footer === */}
        <DialogFooter className="flex items-center justify-between gap-2">
          {provider === "picker" ? (
            <Button variant="outline" onClick={close}>Cancel</Button>
          ) : provider === "smtp" ? (
            <div className="w-full flex items-center justify-between">
              <div className="flex flex-col">
                <Button variant="ghost" onClick={() => setProvider("picker")}>← Back</Button>
                {!allFilled && (
                  <p className="text-[11px] text-amber-600 mt-1">
                    Missing: {missingFields.join(", ")}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={testing || !allFilled}
                  title={!allFilled ? `Fill: ${missingFields.join(", ")}` : "Validate credentials without saving"}
                >
                  {testing ? "Testing..." : "Test Connection"}
                </Button>
                <Button
                  onClick={handleSaveSmtp}
                  disabled={saving || !allFilled}
                  title={!allFilled ? `Fill: ${missingFields.join(", ")}` : "Test + save"}
                >
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setProvider("picker")}>← Back</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
