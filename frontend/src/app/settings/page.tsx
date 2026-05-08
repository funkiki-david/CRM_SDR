/**
 * Settings Page — API keys, team members, AI usage budget
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { settingsApi, authApi, aiApi } from "@/lib/api";
import TeamMembers from "@/components/team-members";
import AIUsageAdmin from "@/components/ai-usage-admin";

interface MyUsage {
  spent_today: number;
  daily_limit: number | null;
  percent: number | null;
  unlimited: boolean;
}

const NAV_SECTIONS = [
  { id: "team", label: "Team" },
  { id: "integrations", label: "Integrations" },
  { id: "budget", label: "Budget" },
  { id: "danger", label: "Danger zone" },
] as const;

export default function SettingsPage() {
  const router = useRouter();

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

  // Current user (for Team Members Admin-only controls)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<"admin" | "manager" | "sdr" | null>(null);

  // Personal AI budget (for the Budget section bar)
  const [myUsage, setMyUsage] = useState<MyUsage | null>(null);

  // Active nav section — anchor highlight
  const [activeSection, setActiveSection] = useState<string>("team");

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

  async function loadMyUsage() {
    try {
      const data = await aiApi.getUsage() as MyUsage;
      setMyUsage(data);
    } catch { /* ignore */ }
  }

  function handleSignOut() {
    if (!confirm("Sign out of the CRM?")) return;
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("sdr_crm_remembered_email");
    }
    router.push("/login");
  }

  useEffect(() => {
    loadApolloStatus();
    loadAnthropicStatus();
    loadMyUsage();
    authApi.getMe().then((u: { id: number; role: "admin" | "manager" | "sdr" }) => {
      setCurrentUserId(u.id);
      setCurrentUserRole(u.role);
    }).catch(() => { /* ignore */ });
  }, []);

  // Highlight the nav item for whichever section is closest to the top
  // of the viewport while scrolling.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sections = NAV_SECTIONS
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-6">
        <h1
          className="font-display font-bold mb-6"
          style={{ fontSize: 28, color: "var(--text-primary)" }}
        >
          Settings
        </h1>
        <div className="grid grid-cols-[220px_1fr] gap-8">
          {/* === Left nav === */}
          <aside className="sticky top-6 self-start">
            <nav className="flex flex-col gap-1 text-sm">
              {NAV_SECTIONS.map((s) => {
                const isActive = activeSection === s.id;
                return (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    onClick={() => setActiveSection(s.id)}
                    className="rounded-full px-4 py-2 transition-colors"
                    style={{
                      background: isActive ? "var(--brand-blue-soft)" : "transparent",
                      color: isActive ? "var(--brand-blue)" : "var(--text-secondary)",
                      fontWeight: isActive ? 600 : 500,
                    }}
                  >
                    {s.label}
                  </a>
                );
              })}
            </nav>
          </aside>

          {/* === Right content === */}
          <main className="space-y-8 min-w-0">

        {/* === Team === */}
        <section id="team" className="scroll-mt-6">
          <TeamMembers currentUserId={currentUserId} currentUserRole={currentUserRole} />
        </section>

        {/* === Integrations: Apollo + Anthropic === */}
        <section id="integrations" className="scroll-mt-6 space-y-6">

        {/* === Contact Database API Key === */}
        <Card>
          <CardHeader>
            <CardTitle
              className="font-display font-bold"
              style={{ fontSize: 18, color: "var(--text-primary)" }}
            >
              Contact Database
            </CardTitle>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
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

            {/* Input for new key — only shown when no env-provided key is active. */}
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

        {/* === Anthropic (Claude AI) — single AI provider === */}
        <Card>
          <CardHeader>
            <CardTitle
              className="font-display font-bold"
              style={{ fontSize: 18, color: "var(--text-primary)" }}
            >
              Anthropic (Claude AI)
            </CardTitle>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
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

        </section>

        {/* === Budget === */}
        <section id="budget" className="scroll-mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle
                className="font-display font-bold"
                style={{ fontSize: 18, color: "var(--text-primary)" }}
              >
                Your AI Budget Today
              </CardTitle>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Daily AI spend resets every day at midnight UTC.
              </p>
            </CardHeader>
            <CardContent>
              {myUsage === null ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>
              ) : myUsage.unlimited ? (
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
                    style={{ background: "var(--brand-blue-soft)", color: "var(--brand-blue)" }}
                  >
                    Unlimited
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>
                    Spent today: ${myUsage.spent_today.toFixed(2)}
                  </span>
                </div>
              ) : (
                (() => {
                  const pct = Math.min(100, Math.max(0, myUsage.percent ?? 0));
                  const limit = myUsage.daily_limit ?? 0;
                  const barColor =
                    pct >= 90 ? "var(--brand-red)"
                    : pct >= 70 ? "var(--brand-amber)"
                    : "var(--brand-green)";
                  return (
                    <div className="space-y-3">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                          ${myUsage.spent_today.toFixed(2)} of ${limit.toFixed(2)}
                        </span>
                        <span
                          className="text-sm font-semibold"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                      <div
                        className="h-2 rounded-full overflow-hidden"
                        style={{ background: "var(--border-faint)" }}
                      >
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: barColor }}
                        />
                      </div>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        Remaining today: ${Math.max(0, limit - myUsage.spent_today).toFixed(2)}
                      </p>
                    </div>
                  );
                })()
              )}
            </CardContent>
          </Card>

          {/* Admin-only: per-user daily limit controls + team usage table */}
          {currentUserRole === "admin" && <AIUsageAdmin />}
        </section>

        {/* === Danger zone === */}
        <section id="danger" className="scroll-mt-6">
          <Card style={{ borderColor: "var(--brand-red)", borderWidth: 1 }}>
            <CardHeader>
              <CardTitle
                className="font-display font-bold"
                style={{ fontSize: 18, color: "var(--brand-red)" }}
              >
                Danger zone
              </CardTitle>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Sign out of this device. You will need to log back in to access the CRM.
              </p>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handleSignOut}
                style={{
                  background: "var(--brand-red)",
                  color: "#ffffff",
                  borderColor: "var(--brand-red)",
                }}
                className="hover:opacity-90"
              >
                Sign out
              </Button>
            </CardContent>
          </Card>
        </section>

          </main>
        </div>
      </div>
    </AppShell>
  );
}
