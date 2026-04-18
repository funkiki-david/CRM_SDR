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
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { emailsApi, settingsApi } from "@/lib/api";

interface EmailAccount {
  id: number;
  email_address: string;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
}

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Apollo API key
  const [apolloKey, setApolloKey] = useState("");
  const [apolloConfigured, setApolloConfigured] = useState(false);
  const [apolloPreview, setApolloPreview] = useState<string | null>(null);
  const [savingApollo, setSavingApollo] = useState(false);
  const [apolloMessage, setApolloMessage] = useState("");

  // Anthropic API key (single AI provider)
  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicConfigured, setAnthropicConfigured] = useState(false);
  const [anthropicPreview, setAnthropicPreview] = useState<string | null>(null);
  const [savingAnthropic, setSavingAnthropic] = useState(false);
  const [anthropicMessage, setAnthropicMessage] = useState("");
  const [anthropicValid, setAnthropicValid] = useState<boolean | null>(null);

  // Add account form
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

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
      setApolloMessage("Apollo API key saved successfully!");
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
  }, []);

  async function handleAdd() {
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      await emailsApi.addAccount({
        email_address: newEmail,
        display_name: newName || undefined,
      });
      setNewEmail("");
      setNewName("");
      loadAccounts();
    } catch {
      // ignore
    } finally {
      setAdding(false);
    }
  }

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
                        {acc.display_name && (
                          <p className="text-xs text-gray-400">{acc.display_name}</p>
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

            {/* Add new account */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Add Email Account</p>
              <div className="flex gap-2">
                <Input
                  placeholder="email@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder="Display name (optional)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={handleAdd} disabled={adding || !newEmail.trim()}>
                  {adding ? "Adding..." : "Add"}
                </Button>
              </div>
              <p className="text-xs text-gray-400">
                Note: Full Gmail OAuth integration will be configured when Google Cloud credentials are set up.
                For now, emails are recorded in the system but not delivered via Gmail API.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* === Apollo.io API Key === */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Apollo.io</CardTitle>
            <p className="text-sm text-gray-500">
              Connect your Apollo.io API key to search and import prospects.
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

            {/* Input for new key */}
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Paste your Apollo API key here..."
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

            <p className="text-xs text-gray-400">
              Find your API key at Apollo.io &rarr; Settings &rarr; Integrations &rarr; API Keys.
              The key is stored securely and never exposed to the frontend.
            </p>
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
            <div className="flex gap-2">
              <Input type="password" placeholder="sk-ant-..." value={anthropicKey}
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

        {/* === Team Members (placeholder) === */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team Members</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-400">
              Team member management (add Managers and SDRs) will be added in a future update.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
