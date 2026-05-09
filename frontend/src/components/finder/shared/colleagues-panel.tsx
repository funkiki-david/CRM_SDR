/**
 * ColleaguesPanel — shared by Tab 1 (Website) + Tab 2 (Email).
 *
 * Toggle is a standalone blue pill button (PATCH-3 §1):
 *   collapsed → "+ Find more contacts at <domain>"
 *   expanded  → "× Hide contacts"
 *
 * On first expand, lazy-loads via apolloApi.search({
 *   organization_domains: [domain], per_page: 10
 * }). Subsequent expand/collapse cycles do NOT refetch
 * (colleagues !== null guard, per Spec B §5.5 + §6.1 network-panel test).
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apolloApi } from "@/lib/api";
import type { ImportStats } from "./import-result-modal";

export interface Colleague {
  apollo_id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
}

interface Props {
  domain: string;
  /** Optional. If provided, this person is hidden from the list (so we don't
   *  duplicate the row already shown above the panel). */
  excludeApolloId?: string;
  onImportComplete: (stats: ImportStats) => void;
}

export default function ColleaguesPanel({
  domain,
  excludeApolloId,
  onImportComplete,
}: Props) {
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
      let list = ((data.people as Colleague[]) || []).slice(0, 10);
      if (excludeApolloId) {
        list = list.filter((c) => c.apollo_id !== excludeApolloId);
      }
      setColleagues(list);
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
      const report = (await apolloApi.import([
        c as unknown as Record<string, unknown>,
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
      setImportingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleToggle}
        className="inline-flex items-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 transition-colors whitespace-nowrap max-w-full"
      >
        <span aria-hidden className="text-base leading-none">
          {open ? "×" : "+"}
        </span>
        {open ? (
          <span>Hide contacts</span>
        ) : (
          <span className="truncate">
            Find more contacts at{" "}
            <span className="font-mono">{domain}</span>
          </span>
        )}
      </button>

      {open && (
        <Card>
          <CardContent className="px-5 py-4">
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
          </CardContent>
        </Card>
      )}
    </div>
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
