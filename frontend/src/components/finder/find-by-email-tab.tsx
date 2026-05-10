/**
 * Tab 2 — Find by Email.
 *
 * Flow:
 *   1. User pastes tim.cook@apple.com
 *   2. finderApi.lookupByEmail
 *        - { found: false }  → "No match found" empty state. NO web fallback.
 *          Backend already guards Apollo's role-based-email ghost records by
 *          checking first/last/name presence (Spec A handover §4.4).
 *        - { found: true, person } → render person card
 *   3. Below the card, ColleaguesPanel (lazy-loaded) shows other people at
 *      the same domain (extracted from the queried email).
 *   4. Per-row Import bubbles ImportStats up via onImportComplete.
 *
 * Spec B §5.2 + §6.2 + §9.9: empty state and result card NEVER mention
 * "apollo" / "web search" / "from web".
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { apolloApi, finderApi } from "@/lib/api";
import { formatFullName, getInitials } from "@/lib/utils";
import type { ImportStats } from "./shared/import-result-modal";
import ColleaguesPanel from "./shared/colleagues-panel";

interface Props {
  onImportComplete: (stats: ImportStats) => void;
}

interface Person {
  apollo_id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  organization?: { name?: string; primary_domain?: string };
  organization_name?: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

type LookupResult =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "not_found"; queriedEmail: string }
  | { state: "found"; person: Person; queriedEmail: string };

export default function FindByEmailTab({ onImportComplete }: Props) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<LookupResult>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);

  // Person main card enrich/import state. Resets on every new lookup.
  // Apollo's /people/match returns a fully-enriched person (the email IS
  // the lookup key — the row already includes email/phone/linkedin), so
  // mainEnriched starts true whenever person.email is present (PATCH-5
  // §4.4 #10 boundary case). User can click Import directly.
  const [mainEnrichedPerson, setMainEnrichedPerson] = useState<Person | null>(
    null
  );
  const [enrichingMain, setEnrichingMain] = useState(false);
  const [importing, setImporting] = useState(false);

  async function submit() {
    const raw = input.trim();
    if (!raw) return;
    setError(null);
    setResult({ state: "loading" });
    setMainEnrichedPerson(null);
    try {
      const data = await finderApi.lookupByEmail(raw);
      if (data.found && data.person) {
        const person = data.person as Person;
        setResult({
          state: "found",
          person,
          queriedEmail: raw,
        });
        // Pre-mark as enriched if the match response already carries the
        // signals we'd otherwise pay credits to fetch.
        if (person.email) setMainEnrichedPerson(person);
      } else {
        setResult({ state: "not_found", queriedEmail: raw });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
      setResult({ state: "idle" });
    }
  }

  async function enrichMain(p: Person) {
    if (!p.apollo_id) return;
    setEnrichingMain(true);
    setError(null);
    try {
      const data = (await apolloApi.enrich([p.apollo_id])) as {
        enriched?: Person[];
      };
      const updated = data.enriched?.[0];
      if (updated) {
        setMainEnrichedPerson({ ...p, ...updated });
      } else {
        // Backend returned empty — treat as already-enriched so user can
        // still proceed to Import.
        setMainEnrichedPerson(p);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enrich failed");
    } finally {
      setEnrichingMain(false);
    }
  }

  async function importMain(p: Person) {
    setImporting(true);
    setError(null);
    try {
      const report = (await apolloApi.import([
        p as unknown as Record<string, unknown>,
      ])) as { created?: number; updated?: number; skipped?: number };
      onImportComplete({
        added: report.created ?? 0,
        updated: report.updated ?? 0,
        skipped: report.skipped ?? 0,
        creditsUsed: 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
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
        <EmptyState email={result.queriedEmail} />
      )}

      {result.state === "found" && (
        <>
          <PersonCard
            person={mainEnrichedPerson ?? result.person}
            enriched={mainEnrichedPerson !== null}
            enriching={enrichingMain}
            importing={importing}
            onEnrich={() => enrichMain(result.person)}
            onImport={() =>
              importMain(mainEnrichedPerson ?? result.person)
            }
          />
          <ColleaguesPanel
            domain={domainOf(result.queriedEmail)}
            excludeApolloId={result.person.apollo_id}
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
            📧
          </span>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              Find a person by email
            </h2>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Best for known contacts. Paste an email — we look up the
              matching person profile in our 210M+ contact database.
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="email"
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) onSubmit();
            }}
            placeholder="e.g. tim.cook@apple.com"
            className="flex-1 h-11 text-sm"
          />
          <Button
            onClick={onSubmit}
            disabled={loading || !input.trim()}
            className="h-11 px-6 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {loading ? "Searching…" : "Find person"}
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
        Looking up the person…
      </CardContent>
    </Card>
  );
}

function EmptyState({ email }: { email: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <div className="text-2xl mb-2" aria-hidden>
          🔍
        </div>
        <p className="text-sm font-medium text-slate-900">No match found</p>
        <p className="text-xs text-slate-500 mt-1">
          We don&apos;t have a person profile for{" "}
          <span className="font-mono text-slate-700">{email}</span>. If this is
          a role-based address (info@, support@), try a personal email — or
          use Find by Website to browse the company.
        </p>
      </CardContent>
    </Card>
  );
}

function PersonCard({
  person,
  enriched,
  enriching,
  importing,
  onEnrich,
  onImport,
}: {
  person: Person;
  enriched: boolean;
  enriching: boolean;
  importing: boolean;
  onEnrich: () => void;
  onImport: () => void;
}) {
  const fullName = formatFullName(person);
  const initials = getInitials(person);
  const company =
    person.organization?.name || person.organization_name || null;
  const location = [person.city, person.state, person.country]
    .filter(Boolean)
    .join(", ");

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-semibold">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-slate-900 truncate">
                  {fullName}
                </h3>
                {(person.title?.trim() || company) && (
                  <p className="text-sm text-slate-600 truncate">
                    {[person.title?.trim() || null, company]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onEnrich}
                  disabled={enriched || enriching}
                  className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-300 text-slate-900 hover:border-slate-400 text-sm font-medium px-5 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-300"
                >
                  {enriching ? (
                    <>Enriching…</>
                  ) : enriched ? (
                    <>
                      <span aria-hidden>✓</span>
                      Enriched
                    </>
                  ) : (
                    <>
                      <span aria-hidden>⚡</span>
                      Enrich
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onImport}
                  disabled={!enriched || importing}
                  className="inline-flex items-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
                >
                  {importing ? (
                    <>Importing…</>
                  ) : (
                    <>
                      <span aria-hidden>→</span>
                      Import
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-slate-500">
              {person.email && (
                <Field label="Email" value={person.email} mono />
              )}
              {person.phone && <Field label="Phone" value={person.phone} mono />}
              {location && <Field label="Location" value={location} />}
              {person.linkedin_url && (
                <a
                  href={person.linkedin_url}
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

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <span>
      <span className="text-slate-400">{label}:</span>{" "}
      <span className={`text-slate-700 ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </span>
  );
}

// ====================================================================== util

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : email.toLowerCase();
}
