/**
 * Tab 3 — Browse Companies.
 *
 * Spec B §5.3 base + PATCH-1 §2 (AI Keyword Finder removed from DOM):
 *   - 4 primary fields: companyName, companyWebsite, companyEmail, linkedinUrl
 *   - 50-state multi-select pill row
 *   - Apollo → Claude web_search silent fallback. NO banner / badge / toast
 *     about the source (Spec B §5.3 + §9.9 + §9.10).
 *
 * AI Keyword Finder was removed in 2026-05-09 (PATCH-1 §2). When unfrozen,
 * it will be reimplemented fresh — no groundwork preserved.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { apolloApi, finderApi } from "@/lib/api";
import type { ImportStats } from "./shared/import-result-modal";

interface Props {
  onImportComplete: (stats: ImportStats) => void;
}

interface SearchResult {
  apollo_id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string | null;
  title?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
  industry?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  is_existing?: boolean;
  /** Set when the row came from the silent web_search fallback. UI never
   *  surfaces this — only used internally to gate Enrich/Import (no apollo_id
   *  on web results). */
  _isWeb?: boolean;
  _summary?: string;
}

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

export default function BrowseCompaniesTab({ onImportComplete }: Props) {
  // ─── Primary search fields (4) ───
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());

  // ─── Search / results / selection ───
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enrichedIds, setEnrichedIds] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const hasAnyInput =
    Boolean(
      companyName.trim() ||
        companyWebsite.trim() ||
        companyEmail.trim() ||
        linkedinUrl.trim()
    ) || selectedStates.size > 0;

  function toggleState(state: string) {
    setSelectedStates((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
  }

  function clearAll() {
    setCompanyName("");
    setCompanyWebsite("");
    setCompanyEmail("");
    setLinkedinUrl("");
    setSelectedStates(new Set());
  }

  async function handleSearch() {
    if (!hasAnyInput || searching) return;
    setSearching(true);
    setSearchError("");
    setHasSearched(true);
    setSelected(new Set());
    setEnrichedIds(new Set());

    const filters: Record<string, unknown> = { page: 1, per_page: 25 };
    if (companyName.trim()) filters.q_organization_name = companyName.trim();
    if (companyWebsite.trim()) filters.company_domain = companyWebsite.trim();

    // Apollo's free-text q_keywords carries email + linkedin context.
    const freeTextParts = [
      companyEmail.trim(),
      linkedinUrl.trim(),
    ].filter(Boolean);
    if (freeTextParts.length > 0) {
      filters.q_keywords = freeTextParts.join(" ");
    }

    if (selectedStates.size > 0) {
      filters.person_locations = Array.from(selectedStates).map(
        (s) => `${s}, US`
      );
    }

    try {
      const data = (await apolloApi.search(filters)) as {
        people?: SearchResult[];
        total?: number;
      };
      const apolloPeople = data.people || [];
      if (apolloPeople.length > 0) {
        setResults(apolloPeople);
      } else {
        // Silent fallback — no banner, no badge, no message.
        const query = buildQueryFromFilters(
          companyName,
          companyWebsite,
          companyEmail,
          linkedinUrl,
          selectedStates
        );
        if (query) {
          const web = await finderApi.webSearch(query);
          setResults(
            web.candidates.map((c) => normalizeWebToResult(c))
          );
        } else {
          setResults([]);
        }
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Toggle every Apollo row's selection. Web fallback rows are excluded
  // because their synthetic ids can't be enriched/imported.
  function toggleSelectAll() {
    const apolloIds = results.filter((r) => !r._isWeb).map((r) => r.apollo_id);
    setSelected((prev) => {
      const allSelected = apolloIds.length > 0 && apolloIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(apolloIds);
    });
  }

  async function handleBulkEnrich() {
    // Only enrich rows with a real Apollo id (web rows have synthetic ids).
    const ids = results
      .filter(
        (r) =>
          selected.has(r.apollo_id) &&
          !r._isWeb &&
          !enrichedIds.has(r.apollo_id)
      )
      .map((r) => r.apollo_id);
    if (ids.length === 0) return;

    setEnriching(true);
    setSearchError("");
    try {
      const data = (await apolloApi.enrich(ids)) as {
        enriched?: SearchResult[];
      };
      const enriched = data.enriched || [];
      setResults((prev) =>
        prev.map((r) => {
          const match = enriched.find((e) => e.apollo_id === r.apollo_id);
          return match ? { ...r, ...match } : r;
        })
      );
      setEnrichedIds((prev) => {
        const next = new Set(prev);
        enriched.forEach((e) => next.add(e.apollo_id));
        return next;
      });
      const n = enriched.length;
      setToast(`${n} ${n === 1 ? "contact" : "contacts"} enriched · ${n} ${n === 1 ? "credit" : "credits"} used`);
      window.setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setEnriching(false);
    }
  }

  async function handleBulkImport() {
    const toImport = results.filter(
      (r) => selected.has(r.apollo_id) && !r._isWeb
    );
    if (toImport.length === 0) return;

    setImporting(true);
    setSearchError("");
    try {
      const report = (await apolloApi.import(
        toImport.map((r) => r as unknown as Record<string, unknown>)
      )) as { created?: number; updated?: number; skipped?: number };
      onImportComplete({
        added: report.created ?? 0,
        updated: report.updated ?? 0,
        skipped: report.skipped ?? 0,
        creditsUsed: 0,
      });
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const selectableCount = useMemo(
    () =>
      results.filter((r) => selected.has(r.apollo_id) && !r._isWeb).length,
    [results, selected]
  );
  const enrichableCount = useMemo(
    () =>
      results.filter(
        (r) =>
          selected.has(r.apollo_id) &&
          !r._isWeb &&
          !enrichedIds.has(r.apollo_id)
      ).length,
    [results, selected, enrichedIds]
  );

  return (
    <div className="space-y-6">
      <PrimarySearchCard
        companyName={companyName}
        companyWebsite={companyWebsite}
        companyEmail={companyEmail}
        linkedinUrl={linkedinUrl}
        selectedStates={selectedStates}
        onCompanyName={setCompanyName}
        onCompanyWebsite={setCompanyWebsite}
        onCompanyEmail={setCompanyEmail}
        onLinkedinUrl={setLinkedinUrl}
        onToggleState={toggleState}
        onClearAll={clearAll}
        hasAnyInput={hasAnyInput}
        searching={searching}
        onSearch={handleSearch}
      />

      {searchError && (
        <Card>
          <CardContent className="py-3 text-sm text-red-600">
            {searchError}
          </CardContent>
        </Card>
      )}

      {hasSearched && (
        <ResultsBlock
          results={results}
          selected={selected}
          enrichedIds={enrichedIds}
          searching={searching}
          enriching={enriching}
          importing={importing}
          selectableCount={selectableCount}
          enrichableCount={enrichableCount}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onBulkEnrich={handleBulkEnrich}
          onBulkImport={handleBulkImport}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 rounded-xl bg-emerald-600 text-white px-4 py-3 text-sm shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────── Primary search card

function PrimarySearchCard({
  companyName,
  companyWebsite,
  companyEmail,
  linkedinUrl,
  selectedStates,
  onCompanyName,
  onCompanyWebsite,
  onCompanyEmail,
  onLinkedinUrl,
  onToggleState,
  onClearAll,
  hasAnyInput,
  searching,
  onSearch,
}: {
  companyName: string;
  companyWebsite: string;
  companyEmail: string;
  linkedinUrl: string;
  selectedStates: Set<string>;
  onCompanyName: (v: string) => void;
  onCompanyWebsite: (v: string) => void;
  onCompanyEmail: (v: string) => void;
  onLinkedinUrl: (v: string) => void;
  onToggleState: (s: string) => void;
  onClearAll: () => void;
  hasAnyInput: boolean;
  searching: boolean;
  onSearch: () => void;
}) {
  // Enter from any input inside the <form> → submit if enabled, no-op if not.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasAnyInput || searching) return;
    onSearch();
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none" aria-hidden>
            🔍
          </span>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              Browse companies
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Discover new companies from scratch. Combine fields to narrow
              the field. Bulk enrich and import in one go.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldRow
              label="Company name"
              value={companyName}
              onChange={onCompanyName}
              placeholder="e.g. Burton Snowboards"
            />
            <FieldRow
              label="Company website"
              value={companyWebsite}
              onChange={onCompanyWebsite}
              placeholder="e.g. burton.com"
            />
            <FieldRow
              label="Company email"
              value={companyEmail}
              onChange={onCompanyEmail}
              placeholder="e.g. info@burton.com"
            />
            <FieldRow
              label="LinkedIn URL"
              value={linkedinUrl}
              onChange={onLinkedinUrl}
              placeholder="e.g. linkedin.com/company/burton-snowboards"
            />
          </div>

          <div>
            <Label className="text-xs text-slate-500 mb-2 block">
              State (multi-select)
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {US_STATES.map((s) => {
                const active = selectedStates.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onToggleState(s)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      active
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            {selectedStates.size > 0 && (
              <p className="text-xs text-slate-400 mt-2">
                {selectedStates.size} state{selectedStates.size === 1 ? "" : "s"}{" "}
                selected
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClearAll}
              disabled={!hasAnyInput && selectedStates.size === 0}
              className="text-xs text-slate-500 hover:text-slate-700 disabled:text-slate-300 disabled:cursor-not-allowed"
            >
              Clear all
            </button>
            <Button
              type="submit"
              disabled={!hasAnyInput || searching}
              className="h-11 px-7 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <span aria-hidden className="mr-1.5">
                🔍
              </span>
              {searching
                ? "Searching…"
                : hasAnyInput
                  ? "Search Now"
                  : "Fill at least one field to enable search"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FieldRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-slate-500 mb-1 block">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 text-sm"
      />
    </div>
  );
}

// ───────────────────────────────────────── Results block

function ResultsBlock({
  results,
  selected,
  enrichedIds,
  searching,
  enriching,
  importing,
  selectableCount,
  enrichableCount,
  onToggleSelect,
  onToggleSelectAll,
  onBulkEnrich,
  onBulkImport,
}: {
  results: SearchResult[];
  selected: Set<string>;
  enrichedIds: Set<string>;
  searching: boolean;
  enriching: boolean;
  importing: boolean;
  selectableCount: number;
  enrichableCount: number;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onBulkEnrich: () => void;
  onBulkImport: () => void;
}) {
  // ───── Select-All / indeterminate calculation (only over Apollo rows; web
  //       rows have synthetic ids and can't be selected anyway).
  const apolloRows = useMemo(() => results.filter((r) => !r._isWeb), [results]);
  const allSelected =
    apolloRows.length > 0 && apolloRows.every((r) => selected.has(r.apollo_id));
  const someSelected =
    !allSelected && apolloRows.some((r) => selected.has(r.apollo_id));

  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  if (searching) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-400">
          Searching…
        </CardContent>
      </Card>
    );
  }
  if (results.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <div className="text-2xl mb-2" aria-hidden>
            🔍
          </div>
          <p className="text-sm font-medium text-slate-900">No results</p>
          <p className="text-xs text-slate-500 mt-1">
            Try broadening your filters or removing a state.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Top toolbar — same pill pattern as ColleaguesPanel (PATCH-5 §3) */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm text-slate-600 mr-auto">
          Found {results.length}{" "}
          {results.length === 1 ? "person" : "people"}
        </span>
        <button
          type="button"
          onClick={onBulkEnrich}
          disabled={enrichableCount === 0 || enriching}
          className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-300 text-slate-900 hover:border-slate-400 text-sm font-medium px-5 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-300"
        >
          {enriching ? (
            <>Enriching…</>
          ) : (
            <>
              <span aria-hidden>⚡</span>
              Enrich selected ({enrichableCount})
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onBulkImport}
          disabled={selectableCount === 0 || importing}
          className="inline-flex items-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
        >
          {importing ? (
            <>Importing…</>
          ) : (
            <>
              <span aria-hidden>→</span>
              Import ({selectableCount})
            </>
          )}
        </button>
      </div>

      {/* Results table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50">
                <th className="px-3 py-3 w-10">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleSelectAll}
                    aria-label="Select all rows"
                    disabled={apolloRows.length === 0}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-30"
                  />
                </th>
                <th className="px-3 py-3 font-medium">First Name</th>
                <th className="px-3 py-3 font-medium">Last Name</th>
                <th className="px-3 py-3 font-medium">Title</th>
                <th className="px-3 py-3 font-medium">Company</th>
                <th className="px-3 py-3 font-medium">Email</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <ResultRow
                  key={r.apollo_id}
                  row={r}
                  selected={selected.has(r.apollo_id)}
                  enriched={enrichedIds.has(r.apollo_id)}
                  onToggle={() => onToggleSelect(r.apollo_id)}
                />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function ResultRow({
  row,
  selected,
  enriched,
  onToggle,
}: {
  row: SearchResult;
  selected: boolean;
  enriched: boolean;
  onToggle: () => void;
}) {
  // Web rows (fallback when Apollo returns 0) carry only company info — show
  // it under the Company column with empty cells elsewhere. Checkbox stays
  // disabled because there's no Apollo id to enrich/import.
  const isWeb = row._isWeb === true;
  return (
    <tr
      onClick={isWeb ? undefined : onToggle}
      className={`border-b border-slate-100 transition-colors ${
        isWeb ? "text-slate-500" : "cursor-pointer hover:bg-slate-50"
      } ${selected ? "bg-blue-50" : ""}`}
    >
      <td className="px-3 py-3 w-10">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          disabled={isWeb}
          aria-label={`Select ${row.first_name || row.company_name || "row"}`}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-30"
        />
      </td>
      <td className="px-3 py-3 font-medium text-slate-900">
        {row.first_name || (isWeb ? "" : "—")}
      </td>
      <td className="px-3 py-3 text-slate-700">
        <LockedOrValue
          value={row.last_name}
          enriched={enriched}
          actionable={!isWeb}
        />
      </td>
      <td
        className="px-3 py-3 text-slate-600 truncate max-w-[280px]"
        title={row.title || undefined}
      >
        {row.title || (isWeb ? "" : "—")}
      </td>
      <td className="px-3 py-3 text-slate-600 truncate max-w-[180px]">
        {row.company_name || row.company_domain || "—"}
      </td>
      <td className="px-3 py-3 text-slate-600 truncate max-w-[220px] font-mono text-xs">
        <LockedOrValue
          value={row.email}
          enriched={enriched}
          actionable={!isWeb}
        />
      </td>
    </tr>
  );
}

/** Render real value when the row is enriched. Show 🔒 placeholder when
 *  the row could be enriched but hasn't been. Web fallback rows
 *  (actionable=false) just show blank — they can't be unlocked. */
function LockedOrValue({
  value,
  enriched,
  actionable,
}: {
  value: string | null | undefined;
  enriched: boolean;
  actionable: boolean;
}) {
  if (enriched) {
    const trimmed = (value || "").trim();
    return <>{trimmed || "—"}</>;
  }
  if (!actionable) return null;
  return (
    <span
      className="text-slate-400"
      title="Enrich to reveal"
      aria-label="Hidden — enrich to reveal"
    >
      🔒
    </span>
  );
}

// ───────────────────────────────────────── helpers

function buildQueryFromFilters(
  companyName: string,
  companyWebsite: string,
  companyEmail: string,
  linkedinUrl: string,
  selectedStates: Set<string>
): string {
  const parts = [
    companyName.trim(),
    companyWebsite.trim(),
    companyEmail.trim(),
    linkedinUrl.trim(),
    ...Array.from(selectedStates),
  ].filter(Boolean);
  return parts.join(" ");
}

function normalizeWebToResult(c: {
  company_name: string;
  domain: string;
  summary: string;
}): SearchResult {
  return {
    apollo_id: `web-${c.domain}`,
    company_name: c.company_name,
    company_domain: c.domain,
    _isWeb: true,
    _summary: c.summary,
  };
}
