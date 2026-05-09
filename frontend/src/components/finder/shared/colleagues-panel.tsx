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
 *   - Each contact row has a checkbox; whole-card click also toggles.
 *   - Bulk Enrich (§3) calls apolloApi.enrich on un-enriched selected ids
 *     and marks them in enrichedIds + enrichmentData.
 *   - Bulk Import (§3) only enables when selectedIds ∩ enrichedIds is
 *     non-empty — David's "must enrich before import" rule.
 *   - Per-contact Import buttons removed (PATCH-3 §2).
 */
"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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

  // onImportComplete + apolloApi imports stay because §3 will use them.
  // Suppress the unused warning for now via an underscore-discard pattern.
  void onImportComplete;
  void enrichedIds;
  void enrichmentData;
  void setEnrichedIds;
  void setEnrichmentData;

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
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

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
  const fullName =
    colleague.name ||
    [colleague.first_name, colleague.last_name].filter(Boolean).join(" ") ||
    "Unknown";
  const initials = fullName
    .split(" ")
    .filter(Boolean)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

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
        <p className="text-xs text-slate-500 truncate">
          {colleague.title || "—"}
          {enriched && colleague.email && (
            <>
              {" · "}
              <span className="font-mono">{colleague.email}</span>
            </>
          )}
        </p>
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
