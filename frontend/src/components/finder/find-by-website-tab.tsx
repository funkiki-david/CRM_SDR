/**
 * Tab 1 — Find by Website.
 *
 * Flow:
 *   1. User pastes apple.com OR https://www.apple.com/about → backend cleans
 *   2. finderApi.lookupByDomain → { found: false } shows empty state (NO web fallback)
 *   3. { found: true, organization } → render company card
 *   4. Below the card, lazy-loaded "Show key contacts at <domain>" panel
 *      uses apolloApi.search({ organization_domains: [domain] })
 *   5. Per-colleague Import → apolloApi.import → onImportComplete
 *
 * Spec B §5.1 + §6.1 + §9.9 — empty state and result card NEVER mention
 * "apollo" / "web search" / "from web".
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { apolloApi, finderApi } from "@/lib/api";
import type { ImportStats } from "./shared/import-result-modal";

interface Props {
  onImportComplete: (stats: ImportStats) => void;
}

interface Organization {
  name?: string;
  website_url?: string;
  primary_domain?: string;
  short_description?: string;
  industry?: string;
  estimated_num_employees?: number;
  founded_year?: number;
  city?: string;
  state?: string;
  country?: string;
  linkedin_url?: string;
  logo_url?: string;
}

interface Colleague {
  apollo_id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
}

type LookupResult =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "not_found"; queriedDomain: string }
  | { state: "found"; org: Organization; queriedDomain: string };

export default function FindByWebsiteTab({ onImportComplete }: Props) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<LookupResult>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const raw = input.trim();
    if (!raw) return;
    setError(null);
    setResult({ state: "loading" });
    try {
      const data = await finderApi.lookupByDomain(raw);
      // Backend returns the cleaned domain back via organization.primary_domain;
      // fall back to raw input for the colleagues panel header.
      const queriedDomain =
        (data.organization as Organization | undefined)?.primary_domain ??
        cleanDomain(raw);
      if (data.found && data.organization) {
        setResult({
          state: "found",
          org: data.organization as Organization,
          queriedDomain,
        });
      } else {
        setResult({ state: "not_found", queriedDomain });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
      setResult({ state: "idle" });
    }
  }

  return (
    <div className="space-y-6">
      <Hero
        input={input}
        onInput={setInput}
        loading={result.state === "loading"}
        onSubmit={submit}
        error={error}
      />

      {result.state === "loading" && <LoadingCard />}

      {result.state === "not_found" && (
        <EmptyState domain={result.queriedDomain} />
      )}

      {result.state === "found" && (
        <>
          <CompanyCard org={result.org} />
          <ColleaguesPanel
            domain={result.queriedDomain}
            onImportComplete={onImportComplete}
          />
        </>
      )}
    </div>
  );
}

// =================================================================== UI bits

function Hero({
  input,
  onInput,
  loading,
  onSubmit,
  error,
}: {
  input: string;
  onInput: (v: string) => void;
  loading: boolean;
  onSubmit: () => void;
  error: string | null;
}) {
  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-start gap-3 mb-4">
          <span className="text-3xl leading-none" aria-hidden>
            🌐
          </span>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              Find a company by website
            </h2>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Best for company URL / cold outreach prep / account research.
              Paste a homepage URL or just the domain.
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) onSubmit();
            }}
            placeholder="e.g. apple.com or https://www.apple.com"
            className="flex-1 h-11 text-sm"
          />
          <Button
            onClick={onSubmit}
            disabled={loading || !input.trim()}
            className="h-11 px-6 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {loading ? "Searching…" : "Find company"}
          </Button>
        </div>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-slate-400">
        Looking up the company…
      </CardContent>
    </Card>
  );
}

function EmptyState({ domain }: { domain: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <div className="text-2xl mb-2" aria-hidden>
          🔍
        </div>
        <p className="text-sm font-medium text-slate-900">No company found</p>
        <p className="text-xs text-slate-500 mt-1">
          We couldn&apos;t find a company match for{" "}
          <span className="font-mono text-slate-700">{domain}</span>. Double-check
          the URL, or try Browse Companies for a wider search.
        </p>
      </CardContent>
    </Card>
  );
}

function CompanyCard({ org }: { org: Organization }) {
  const location = [org.city, org.state, org.country]
    .filter(Boolean)
    .join(", ");
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          {org.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={org.logo_url}
              alt=""
              className="w-14 h-14 rounded-lg border border-slate-200 object-contain bg-white"
            />
          ) : (
            <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 text-xl">
              ◇
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-slate-900 truncate">
              {org.name || org.primary_domain || "Company"}
            </h3>
            {org.short_description && (
              <p className="text-sm text-slate-600 mt-1 line-clamp-3">
                {org.short_description}
              </p>
            )}
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-slate-500">
              {org.industry && <Field label="Industry" value={org.industry} />}
              {org.estimated_num_employees != null && (
                <Field
                  label="Size"
                  value={`${org.estimated_num_employees.toLocaleString()} employees`}
                />
              )}
              {org.founded_year && (
                <Field label="Founded" value={String(org.founded_year)} />
              )}
              {location && <Field label="Location" value={location} />}
              {org.website_url && (
                <a
                  href={org.website_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Website ↗
                </a>
              )}
              {org.linkedin_url && (
                <a
                  href={org.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  LinkedIn ↗
                </a>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-slate-400">{label}:</span>{" "}
      <span className="text-slate-700">{value}</span>
    </span>
  );
}

// =============================================================== Colleagues

function ColleaguesPanel({
  domain,
  onImportComplete,
}: {
  domain: string;
  onImportComplete: (stats: ImportStats) => void;
}) {
  const [open, setOpen] = useState(false);
  const [colleagues, setColleagues] = useState<Colleague[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  async function ensureLoaded() {
    if (colleagues !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apolloApi.search({
        organization_domains: [domain],
        per_page: 10,
        page: 1,
      });
      setColleagues(((data.people as Colleague[]) || []).slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next) await ensureLoaded();
  }

  async function importOne(c: Colleague) {
    setImportingId(c.apollo_id);
    try {
      const report = (await apolloApi.import([c as unknown as Record<string, unknown>])) as {
        created?: number;
        updated?: number;
        skipped?: number;
      };
      onImportComplete({
        added: report.created ?? 0,
        updated: report.updated ?? 0,
        skipped: report.skipped ?? 0,
        creditsUsed: 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportingId(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={handleToggle}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <span>
            {open ? "Hide" : "Show"} key contacts at{" "}
            <span className="font-mono text-slate-900">{domain}</span>
          </span>
          <span className="text-slate-400 text-xs">{open ? "▲" : "▼"}</span>
        </button>

        {open && (
          <div className="border-t border-slate-100 px-5 py-4">
            {loading && (
              <p className="text-sm text-slate-400 text-center py-4">
                Loading contacts…
              </p>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
            {!loading && !error && colleagues && colleagues.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">
                No public contacts found at this company.
              </p>
            )}
            {!loading && colleagues && colleagues.length > 0 && (
              <ul className="space-y-2">
                {colleagues.map((c) => (
                  <ColleagueRow
                    key={c.apollo_id}
                    colleague={c}
                    importing={importingId === c.apollo_id}
                    onImport={() => importOne(c)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ColleagueRow({
  colleague,
  importing,
  onImport,
}: {
  colleague: Colleague;
  importing: boolean;
  onImport: () => void;
}) {
  const fullName =
    colleague.name ||
    [colleague.first_name, colleague.last_name].filter(Boolean).join(" ") ||
    "Unknown";
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900 truncate">{fullName}</p>
        <p className="text-xs text-slate-500 truncate">
          {colleague.title || "—"}
          {colleague.email && (
            <>
              {" · "}
              <span className="font-mono">{colleague.email}</span>
            </>
          )}
        </p>
      </div>
      <Button
        onClick={onImport}
        disabled={importing}
        size="sm"
        variant="outline"
        className="shrink-0"
      >
        {importing ? "…" : "Import"}
      </Button>
    </li>
  );
}

function cleanDomain(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0];
  s = s.split("?")[0];
  return s;
}
