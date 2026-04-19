/**
 * Add Email Account Modal — 三种邮箱服务商选择
 *
 *   1. Google Gmail    → OAuth（暂为占位，OAuth credentials 配置后启用）
 *   2. Microsoft Outlook → OAuth（同上，暂走 SMTP 作为替代）
 *   3. Other SMTP     → 通用 SMTP/IMAP 表单
 *
 * SMTP 模式：
 *   - 保存前可点 "Test Connection" 验证凭据
 *   - 密码后端 Fernet 加密存储，前端明文只在提交的一瞬间经过网络
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
import { emailsApi } from "@/lib/api";

interface AddEmailAccountProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type Provider = "picker" | "gmail" | "outlook" | "smtp";

// 常见邮箱的 SMTP 预设 —— 选完 Other SMTP 可以按邮箱域名自动填
const SMTP_PRESETS: Record<string, Partial<SmtpForm>> = {
  "hostinger.com": { smtp_host: "smtp.hostinger.com", smtp_port: 465, imap_host: "imap.hostinger.com", imap_port: 993, smtp_encryption: "ssl" },
  "amazonsolutions.us": { smtp_host: "smtp.hostinger.com", smtp_port: 465, imap_host: "imap.hostinger.com", imap_port: 993, smtp_encryption: "ssl" },
  "outlook.com": { smtp_host: "smtp.office365.com", smtp_port: 587, imap_host: "outlook.office365.com", imap_port: 993, smtp_encryption: "starttls" },
  "office365.com": { smtp_host: "smtp.office365.com", smtp_port: 587, imap_host: "outlook.office365.com", imap_port: 993, smtp_encryption: "starttls" },
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

  // 填邮箱时同步 username + 尝试套预设
  const handleEmailChange = (val: string) => {
    const domain = val.split("@")[1]?.toLowerCase() || "";
    const preset = SMTP_PRESETS[domain] || {};
    setForm(prev => ({
      ...prev,
      email_address: val,
      smtp_username: val, // 默认 username = email
      ...preset,
    }));
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await emailsApi.testSmtp({
        smtp_host: form.smtp_host,
        smtp_port: form.smtp_port,
        smtp_username: form.smtp_username,
        smtp_password: form.smtp_password,
        smtp_encryption: form.smtp_encryption,
      });
      setTestResult({ ok: true, msg: "连接成功，凭据有效 ✓" });
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveSmtp = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await emailsApi.addAccount({
        email_address: form.email_address,
        display_name: form.display_name || undefined,
        provider_type: "smtp",
        smtp_host: form.smtp_host,
        smtp_port: form.smtp_port,
        imap_host: form.imap_host || undefined,
        imap_port: form.imap_port || undefined,
        smtp_username: form.smtp_username,
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
            <p className="text-sm text-gray-600">选择邮箱服务商：</p>
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

        {/* === Gmail OAuth placeholder === */}
        {provider === "gmail" && (
          <div className="py-4 space-y-3">
            <p className="text-sm text-gray-600">
              Google Gmail OAuth 需要配置 Google Cloud 凭据。
              目前尚未启用，你可以先用 &quot;Other SMTP&quot; 连接（Gmail 也支持 SMTP —
              在 Google 账号安全里生成 App Password）。
            </p>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
              ⚠ Gmail 需要在 Google 账号 → 安全 → 两步验证 → 应用专用密码
              生成 16 位 App Password，然后用 SMTP 模式：
              <br />Host: <code>smtp.gmail.com</code> · Port: <code>465</code> · SSL
            </div>
            <Button variant="outline" onClick={() => setProvider("smtp")}>
              Use SMTP Instead
            </Button>
          </div>
        )}

        {/* === Outlook OAuth placeholder === */}
        {provider === "outlook" && (
          <div className="py-4 space-y-3">
            <p className="text-sm text-gray-600">
              Microsoft Outlook OAuth (via Azure AD) 需要以后配置。
              目前先用 SMTP 连接（Office 365 支持 SMTP AUTH）。
            </p>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
              ℹ Office 365 SMTP：
              <br />Host: <code>smtp.office365.com</code> · Port: <code>587</code> · STARTTLS
              <br />注意需要在 Microsoft 365 Admin 里启用 SMTP AUTH。
            </div>
            <Button variant="outline" onClick={() => setProvider("smtp")}>
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
              密码通过 Fernet 加密存储在数据库，不会明文保存或暴露给前端。
            </p>
          </div>
        )}

        {/* === Footer === */}
        <DialogFooter className="flex items-center justify-between gap-2">
          {provider === "picker" ? (
            <Button variant="outline" onClick={close}>Cancel</Button>
          ) : provider === "smtp" ? (
            <>
              <Button variant="ghost" onClick={() => setProvider("picker")}>← Back</Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={testing || !form.smtp_host || !form.smtp_username || !form.smtp_password}
                >
                  {testing ? "Testing..." : "Test Connection"}
                </Button>
                <Button
                  onClick={handleSaveSmtp}
                  disabled={saving || !form.email_address || !form.smtp_host || !form.smtp_password}
                >
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setProvider("picker")}>← Back</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
