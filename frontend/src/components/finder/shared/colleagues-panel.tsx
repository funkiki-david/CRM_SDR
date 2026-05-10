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
 *
 * Selection model (PATCH-3 §2 + §3):
 *   - Each row has a checkbox; whole-card click also toggles.
 *   - Bulk Enrich calls apolloApi.enrich on un-enriched selected ids and
 *     marks them in enrichedIds + enrichmentData.
 *   - Bulk Import enables only when selectedIds ∩ enrichedIds is non-empty —
 *     David's "must enrich before import" rule. Per-contact Import buttons
 *     intentionally absent.
 */
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { apolloApi } from "@/lib/api";
import { formatFullName, getInitials } from "@/lib/utils";
import type { ImportStats } from "./import-result-modal";

export interface Colleague {
  apollo_id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
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

  // Selection / enrichment state — survives expand/collapse cycles because
  // it lives at the component top level, not inside the {open && (...)} branch.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enrichedIds, setEnrichedIds] = useState<Set<string>>(new Set());
  const [enrichmentData, setEnrichmentData] = useState<Map<string, Colleague>>(
    new Map()
  );

  const [enriching, setEnriching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // ────────────────────────────────────────────────── derived counts
  const selectedCount = selectedIds.size;
  const selectedAndEnrichedCount = useMemo(() => {
    let n = 0;
    selectedIds.forEach((id) => {
      if (enrichedIds.has(id)) n += 1;
    });
    return n;
  }, [selectedIds, enrichedIds]);

  // ────────────────────────────────────────────────── handlers
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

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkEnrich() {
    // Already-enriched ids are filtered out client-side — do not waste credits.
    const idsToEnrich: string[] = [];
    selectedIds.forEach((id) => {
      if (!enrichedIds.has(id)) idsToEnrich.push(id);
    });
    if (idsToEnrich.length === 0) return;

    setEnriching(true);
    setError(null);
    try {
      const data = (await apolloApi.enrich(idsToEnrich)) as {
        enriched?: Colleague[];
      };
      const list = data.enriched ?? [];
      setEnrichmentData((prev) => {
        const next = new Map(prev);
        list.forEach((p) => next.set(p.apollo_id, p));
        return next;
      });
      setEnrichedIds((prev) => {
        const next = new Set(prev);
        list.forEach((p) => next.add(p.apollo_id));
        return next;
      });
      const n = list.length;
      setToast(
        `${n} ${n === 1 ? "contact" : "contacts"} enriched · ${n} ${n === 1 ? "credit" : "credits"} used`
      );
      window.setTimeout(() => setToast(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enrichment failed");
    } finally {
      setEnriching(false);
    }
  }

  async function handleBulkImport() {
    if (!colleagues || selectedAndEnrichedCount === 0) return;

    // Build the people payload from enriched data merged onto the original row.
    const payload = colleagues
      .filter(
        (c) => selectedIds.has(c.apollo_id) && enrichedIds.has(c.apollo_id)
      )
      .map((c) => {
        const enrichedFields = enrichmentData.get(c.apollo_id) ?? {};
        return { ...c, ...enrichedFields } as unknown as Record<string, unknown>;
      });
    if (payload.length === 0) return;

    setImporting(true);
    setError(null);
    try {
      const report = (await apolloApi.import(payload)) as {
        created?: number;
        updated?: number;
        skipped?: number;
      };
      onImportComplete({
        added: report.created ?? 0,
        updated: report.updated ?? 0,
        skipped: report.skipped ?? 0,
        creditsUsed: 0, // already enriched — import itself does not bill credits
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  // ────────────────────────────────────────────────── render
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
            {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
            {!loading && !error && colleagues && colleagues.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">
                No public contacts found at this company.
              </p>
            )}
            {!loading && colleagues && colleagues.length > 0 && (
              <>
                <ul className="space-y-2">
                  {colleagues.map((c) => {
                    const selected = selectedIds.has(c.apollo_id);
                    const enriched = enrichedIds.has(c.apollo_id);
                    const merged = enriched
                      ? { ...c, ...(enrichmentData.get(c.apollo_id) ?? {}) }
                      : c;
                    return (
                      <ColleagueRow
                        key={c.apollo_id}
                        colleague={merged}
                        selected={selected}
                        enriched={enriched}
                        onToggle={() => toggleSelect(c.apollo_id)}
                      />
                    );
                  })}
                </ul>

                <BulkActionsBar
                  selectedCount={selectedCount}
                  selectedAndEnrichedCount={selectedAndEnrichedCount}
                  enriching={enriching}
                  importing={importing}
                  onEnrich={handleBulkEnrich}
                  onImport={handleBulkImport}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 rounded-xl bg-emerald-600 text-white px-4 py-3 text-sm shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────── ColleagueRow

function ColleagueRow({
  colleague,
  selected,
  enriched,
  onToggle,
}: {
  colleague: Colleague;
  selected: boolean;
  enriched: boolean;
  onToggle: () => void;
}) {
  const fullName = formatFullName(colleague);
  const initials = getInitials(colleague);

  return (
    <li
      onClick={onToggle}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer border transition-colors ${
        selected
          ? "bg-blue-50 border-blue-200"
          : "bg-slate-50 border-transparent hover:bg-slate-100"
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${fullName}`}
        className="h-4 w-4 rounded border-slate-300 text-blue-600 shrink-0"
      />
      <div
        className="flex items-center justify-center rounded-full bg-slate-200 text-slate-600 font-semibold shrink-0"
        style={{ width: 32, height: 32, fontSize: 12 }}
        aria-hidden
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-slate-900 truncate">
            {fullName}
          </p>
          {enriched && (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 text-[10px]">
              enriched
            </Badge>
          )}
        </div>
        <ColleagueMetaLine
          title={colleague.title}
          email={enriched ? colleague.email : null}
        />
      </div>
      {!enriched && (
        <span
          aria-label="Locked — enrich to reveal contact details"
          title="Enrich to reveal contact details"
          className="text-slate-400 text-base shrink-0"
        >
          🔒
        </span>
      )}
    </li>
  );
}

/** Title · email line that hides when both are missing and skips the dash
 *  separator when one side is empty (PATCH-5 §2). */
function ColleagueMetaLine({
  title,
  email,
}: {
  title?: string | null;
  email?: string | null;
}) {
  const cleanTitle = (title || "").trim();
  const cleanEmail = (email || "").trim();
  if (!cleanTitle && !cleanEmail) return null;
  return (
    <p className="text-xs text-slate-500 truncate">
      {cleanTitle && <span>{cleanTitle}</span>}
      {cleanTitle && cleanEmail && " · "}
      {cleanEmail && <span className="font-mono">{cleanEmail}</span>}
    </p>
  );
}

// ────────────────────────────────────────────────── BulkActionsBar

function BulkActionsBar({
  selectedCount,
  selectedAndEnrichedCount,
  enriching,
  importing,
  onEnrich,
  onImport,
}: {
  selectedCount: number;
  selectedAndEnrichedCount: number;
  enriching: boolean;
  importing: boolean;
  onEnrich: () => void;
  onImport: () => void;
}) {
  const enrichDisabled = selectedCount === 0 || enriching;
  const importDisabled = selectedAndEnrichedCount === 0 || importing;

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-end gap-2 flex-wrap">
      <Button
        type="button"
        variant="outline"
        onClick={onEnrich}
        disabled={enrichDisabled}
      >
        {enriching ? (
          <>Enriching…</>
        ) : (
          <>
            <span aria-hidden className="mr-1">
              ⚡
            </span>
            Enrich selected ({selectedCount})
          </>
        )}
      </Button>
      <Button
        type="button"
        onClick={onImport}
        disabled={importDisabled}
        className="bg-blue-600 hover:bg-blue-700 text-white"
      >
        {importing ? (
          <>Importing…</>
        ) : (
          <>
            <span aria-hidden className="mr-1">
              →
            </span>
            Import ({selectedAndEnrichedCount})
          </>
        )}
      </Button>
    </div>
  );
}
