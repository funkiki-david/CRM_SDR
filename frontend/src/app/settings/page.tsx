/**
 * Settings Page — Manage email accounts and system configuration
 * Currently supports:
 *   - Connect/disconnect Gmail accounts
 * Future:
 *   - Apollo API Key
 *   - Team member management
 */
"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { emailsApi, settingsApi, authApi } from "@/lib/api";
import AddEmailAccount from "@/components/add-email-account";
import TeamMembers from "@/components/team-members";
import AIUsageAdmin from "@/components/ai-usage-admin";

interface EmailAccount {
  id: number;
  email_address: string;
  display_name: string | null;
  provider_type: string;
  is_active: boolean;
  smtp_host?: string | null;
  last_test_error?: string | null;
  created_at: string;
}

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Apollo API key
  const [apolloKey, setApolloKey] = useState("");
  const [apolloConfigured, setApolloConfigured] = useState(false);
  const [apolloPreview, setApolloPreview] = useState<string | null>(null);
  const [apolloSource, setApolloSource] = useState<string>("none");
  const [savingApollo, setSavingApollo] = useState(false);
  const [apolloMessage, setApolloMessage] = useState("");

  // Anthropic API key (single AI provider)
  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicConfigured, setAnthropicConfigured] = useState(false);
  const [anthropicPreview, setAnthropicPreview] = useState<string | null>(null);
  const [anthropicSource, setAnthropicSource] = useState<string>("none");
  const [savingAnthropic, setSavingAnthropic] = useState(false);
  const [anthropicMessage, setAnthropicMessage] = useState("");
  const [anthropicValid, setAnthropicValid] = useState<boolean | null>(null);

  // Add email account modal
  const [addModalOpen, setAddModalOpen] = useState(false);

  // OAuth callback toast（?gmail=connected 或 ?gmail=error 回来）
  const [oauthMessage, setOauthMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Current user (for Team Members Admin-only controls)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<"admin" | "manager" | "sdr" | null>(null);

  async function loadAccounts() {
    try {
      const data = await emailsApi.listAccounts();
      setAccounts(data);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadApolloStatus() {
    try {
      const data = await settingsApi.apolloKeyStatus();
      setApolloConfigured(data.configured);
      setApolloPreview(data.key_preview);
      setApolloSource(data.source || "none");
    } catch {
      // ignore
    }
  }

  async function handleSaveApolloKey() {
    if (!apolloKey.trim()) return;
    setSavingApollo(true);
    setApolloMessage("");
    try {
      await settingsApi.setApolloKey(apolloKey.trim());
      setApolloMessage("API key saved successfully!");
      setApolloKey("");
      loadApolloStatus();
    } catch (err) {
      setApolloMessage(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSavingApollo(false);
    }
  }

  async function loadAnthropicStatus() {
    try {
      const data = await settingsApi.anthropicKeyStatus();
      setAnthropicConfigured(data.configured);
      setAnthropicPreview(data.key_preview);
      setAnthropicSource(data.source || "none");
    } catch { /* ignore */ }
  }

  async function handleSaveAnthropicKey() {
    if (!anthropicKey.trim()) return;
    setSavingAnthropic(true);
    setAnthropicMessage("");
    setAnthropicValid(null);
    try {
      const result = await settingsApi.setAnthropicKey(anthropicKey.trim());
      if (result.valid) {
        setAnthropicMessage("API Key is valid and working");
        setAnthropicValid(true);
        setAnthropicKey("");
      } else {
        setAnthropicMessage("Invalid key. Please check and try again.");
        setAnthropicValid(false);
      }
      loadAnthropicStatus();
    } catch (err) {
      setAnthropicMessage(err instanceof Error ? err.message : "Failed to save key");
      setAnthropicValid(false);
    } finally {
      setSavingAnthropic(false);
    }
  }

  useEffect(() => {
    loadAccounts();
    loadApolloStatus();
    loadAnthropicStatus();
    authApi.getMe().then((u: { id: number; role: "admin" | "manager" | "sdr" }) => {
      setCurrentUserId(u.id);
      setCurrentUserRole(u.role);
    }).catch(() => { /* ignore */ });

    // 读 URL query — 从 Google OAuth 回来时会带 ?gmail=connected|error
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const status = params.get("gmail");
      if (status === "connected") {
        const email = params.get("email") || "your Gmail account";
        setOauthMessage({ ok: true, text: `✓ Connected ${email} via Google OAuth.` });
        window.history.replaceState({}, "", "/settings");
      } else if (status === "error") {
        const reason = params.get("reason") || "unknown error";
        setOauthMessage({ ok: false, text: `Gmail connection failed: ${reason}` });
        window.history.replaceState({}, "", "/settings");
      }
    }
  }, []);

  async function handleRemove(id: number) {
    if (!confirm("Remove this email account?")) return;
    try {
      await emailsApi.removeAccount(id);
      loadAccounts();
    } catch {
      // ignore
    }
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-8">
        <h2 className="text-lg font-semibold text-gray-900">Settings</h2>

        {/* === Email Accounts === */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Email Accounts</CardTitle>
            <p className="text-sm text-gray-500">
              Connect Gmail accounts for sending cold emails from within the CRM.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* OAuth callback toast */}
            {oauthMessage && (
              <div
                className={`p-3 rounded border text-sm ${
                  oauthMessage.ok
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-red-50 border-red-200 text-red-700"
                }`}
              >
                {oauthMessage.text}
                <button
                  onClick={() => setOauthMessage(null)}
                  className="float-right text-xs opacity-70 hover:opacity-100"
                >
                  ×
                </button>
              </div>
            )}

            {/* Current accounts */}
            {loading ? (
              <p className="text-sm text-gray-400">Loading...</p>
            ) : accounts.length === 0 ? (
              <p className="text-sm text-gray-400">No email accounts connected.</p>
            ) : (
              <div className="space-y-2">
                {accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-md"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-sm font-medium">{acc.email_address}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {acc.display_name && (
                            <p className="text-xs text-gray-400">{acc.display_name}</p>
                          )}
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                            {acc.provider_type === "smtp" ? "SMTP" :
                             acc.provider_type === "gmail_oauth" ? "Gmail" :
                             acc.provider_type === "outlook_oauth" ? "Outlook" :
                             acc.provider_type}
                          </Badge>
                          {acc.smtp_host && (
                            <span className="text-[10px] text-gray-400">{acc.smtp_host}</span>
                          )}
                        </div>
                        {acc.last_test_error && (
                          <p className="text-[10px] text-red-500 mt-1">⚠ {acc.last_test_error}</p>
                        )}
                      </div>
                      <Badge variant={acc.is_active ? "secondary" : "outline"} className="text-xs">
                        {acc.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-500 hover:text-red-700"
                      onClick={() => handleRemove(acc.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Add Email Account</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Gmail / Outlook / any SMTP server
                </p>
              </div>
              <Button onClick={() => setAddModalOpen(true)}>
                + Add Account
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* === Contact Database API Key === */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact Database</CardTitle>
            <p className="text-sm text-gray-500">
              Connect your contact database API key to search and import prospects in the Finder.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current status */}
            <div className="flex items-center gap-2">
              <Badge variant={apolloConfigured ? "secondary" : "outline"} className="text-xs">
                {apolloConfigured ? "Connected" : "Not configured"}
              </Badge>
              {apolloPreview && (
                <span className="text-xs text-gray-400">Key ending in {apolloPreview}</span>
              )}
            </div>

            {apolloSource === "env" ? (
              <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
                ✓ API Key configured via environment variable
                <p className="text-xs text-green-600 mt-1">
                  Override below if you want to use a different key at runtime.
                </p>
              </div>
            ) : null}

            {/* Input for new key — 只在没从 env 加载时强制显示 */}
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={apolloSource === "env" ? "Override key (optional)" : "Paste your contact database API key here..."}
                value={apolloKey}
                onChange={(e) => setApolloKey(e.target.value)}
                className="flex-1"
              />
              <Button onClick={handleSaveApolloKey} disabled={savingApollo || !apolloKey.trim()}>
                {savingApollo ? "Saving..." : "Save Key"}
              </Button>
            </div>

            {apolloMessage && (
              <p className={`text-sm ${apolloMessage.includes("success") ? "text-green-600" : "text-red-500"}`}>
                {apolloMessage}
              </p>
            )}

            {apolloSource !== "env" && (
              <p className="text-xs text-gray-400">
                Get your API key from your contact database provider&rsquo;s Settings → Integrations → API Keys.
                The key is stored securely and never exposed to the frontend.
              </p>
            )}
          </CardContent>
        </Card>

        {/* === Anthropic (Claude) API Key === */}
        {/* === Anthropic (Claude AI) — single AI provider === */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Anthropic (Claude AI)</CardTitle>
            <p className="text-sm text-gray-500">
              Powers all AI features: research reports, email drafting, and intelligent search.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={anthropicConfigured ? "secondary" : "outline"} className="text-xs">
                {anthropicConfigured ? "Connected" : "Not configured"}
              </Badge>
              {anthropicPreview && (
                <span className="text-xs text-gray-400">Key ending in {anthropicPreview}</span>
              )}
            </div>

            {anthropicSource === "env" ? (
              <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
                ✓ API Key configured via environment variable (<code>ANTHROPIC_API_KEY</code> in <code>backend/.env</code>)
                <p className="text-xs text-green-600 mt-1">
                  Override below if you want to use a different key at runtime.
                </p>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Input type="password"
                placeholder={anthropicSource === "env" ? "Override key (optional)" : "sk-ant-..."}
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)} className="flex-1" />
              <Button onClick={handleSaveAnthropicKey} disabled={savingAnthropic || !anthropicKey.trim()}>
                {savingAnthropic ? "Validating..." : "Save Key"}
              </Button>
            </div>
            {anthropicMessage && (
              <p className={`text-sm ${anthropicValid === true ? "text-green-600" : "text-red-500"}`}>
                {anthropicValid === true ? "\u2713 " : anthropicValid === false ? "\u2717 " : ""}{anthropicMessage}
              </p>
            )}
          </CardContent>
        </Card>

        {/* === AI Usage Limits (Admin only) === */}
        {currentUserRole === "admin" && <AIUsageAdmin />}

        {/* === Team Members === */}
        <TeamMembers currentUserId={currentUserId} currentUserRole={currentUserRole} />
      </div>

      {/* Add Email Account modal */}
      <AddEmailAccount
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSuccess={() => loadAccounts()}
      />
    </AppShell>
  );
}
