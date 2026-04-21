/**
 * Finder Page — 两层结构（参考 Apollo.io）
 *
 *  Primary Search (主搜索区，白色，始终可见):
 *    - Company Name / Company Domain / Keywords / LinkedIn URL / Person Name
 *    - State (多选) + City 与搜索按钮同行
 *    - 至少填一个才能搜
 *
 *  AI Keyword Finder (灰色，默认折叠):
 *    - 用户输入行业/类型描述 → Claude Haiku 生成 industries + keywords
 *    - 勾选后 Apply 用作 Apollo 搜索过滤
 *    - Applied 标签显示在搜索区上方，✕ 可清除
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apolloApi, aiApi } from "@/lib/api";

interface SearchResult {
  [key: string]: unknown;
  apollo_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  title: string | null;
  phone: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  company_domain: string | null;
  industry: string | null;
  industry_keywords: string[];
  company_size: string | null;
  annual_revenue: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  is_existing: boolean;
  existing_contact_id: number | null;
  last_updated: string | null;
}

interface ImportReport {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
  message: string;
}

// === Filter options ===

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming",
];

export default function FinderPage() {
  const router = useRouter();

  // === Primary Search ===
  const [companyName, setCompanyName] = useState("");
  const [domain, setDomain] = useState("");
  const [keywords, setKeywords] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [personName, setPersonName] = useState("");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [city, setCity] = useState("");

  // === AI Keyword Finder ===
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiIndustries, setAiIndustries] = useState<string[]>([]);
  const [aiKeywords, setAiKeywords] = useState<string[]>([]);
  const [selIndustries, setSelIndustries] = useState<Set<string>>(new Set());
  const [selKeywords, setSelKeywords] = useState<Set<string>>(new Set());
  // Applied = the ones actually used in the last Apply-to-Search click
  const [appliedIndustries, setAppliedIndustries] = useState<string[]>([]);
  const [appliedKeywords, setAppliedKeywords] = useState<string[]>([]);

  // Guide visibility — default expanded on first visit, persisted via localStorage
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("finder_guide_hidden") !== "1";
    return true;
  });
  const toggleGuide = (show: boolean) => {
    setShowGuide(show);
    if (typeof window !== "undefined") {
      localStorage.setItem("finder_guide_hidden", show ? "0" : "1");
    }
  };

  // Results state
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  // Selection / enrichment / import state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enrichedIds, setEnrichedIds] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [showEnrichConfirm, setShowEnrichConfirm] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);

  // === Primary Search 至少填一个 ===
  const hasPrimaryInput = Boolean(
    companyName.trim() || domain.trim() || keywords.trim() ||
    linkedinUrl.trim() || personName.trim() ||
    selectedStates.length > 0 || city.trim()
  );

  // === 有任何 AI 关键词被 Apply ===
  const hasAppliedAi = appliedIndustries.length > 0 || appliedKeywords.length > 0;

  async function handleSearch(
    page = 1,
    overrides?: { industries?: string[]; keywords?: string[] },
  ) {
    setSearching(true);
    setSearchError("");
    setImportReport(null);

    const filters: Record<string, unknown> = { page, per_page: 25 };

    // Primary
    if (companyName.trim()) filters.q_organization_name = companyName.trim();
    if (domain.trim()) filters.company_domain = domain.trim();
    const primaryKeywordTags = keywords.split(",").map(k => k.trim()).filter(Boolean);
    // LinkedIn URL + Person Name 都走 Apollo 的 free-text q_keywords
    const freeTextParts = [linkedinUrl.trim(), personName.trim()].filter(Boolean);
    if (freeTextParts.length > 0) filters.q_keywords = freeTextParts.join(" ");

    // Location (State + City)
    if (selectedStates.length > 0) {
      const locs = selectedStates.map(s => `${s}, US`);
      if (city.trim()) {
        filters.person_locations = selectedStates.map(s => `${city.trim()}, ${s}, US`);
      } else {
        filters.person_locations = locs;
      }
    } else if (city.trim()) {
      filters.person_locations = [city.trim()];
    }

    // AI-applied industries/keywords (overrides = this-click apply, else use state)
    const indUsed = overrides?.industries ?? appliedIndustries;
    const kwUsed = overrides?.keywords ?? appliedKeywords;
    if (indUsed.length) filters.organization_industry_tag_ids = indUsed;
    const mergedTags = [...primaryKeywordTags, ...kwUsed];
    if (mergedTags.length) filters.q_organization_keyword_tags = mergedTags;

    try {
      const data = await apolloApi.search(filters);
      setResults(data.people || []);
      setTotalResults(data.total || 0);
      setCurrentPage(data.page || 1);
      setSelected(new Set());
      setHasSearched(true);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleGenerateKeywords() {
    const input = aiInput.trim();
    if (!input || aiSuggesting) return;
    setAiSuggesting(true);
    setAiError("");
    try {
      const data = await aiApi.suggestKeywords(input);
      setAiIndustries(Array.isArray(data.industries) ? data.industries : []);
      setAiKeywords(Array.isArray(data.keywords) ? data.keywords : []);
      setSelIndustries(new Set());
      setSelKeywords(new Set());
      if (data.message && !data.industries?.length && !data.keywords?.length) {
        setAiError(data.message);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI keyword suggestion is unavailable. Please try again.");
      setAiIndustries([]);
      setAiKeywords([]);
    } finally {
      setAiSuggesting(false);
    }
  }

  function handleApplyAi() {
    const inds = Array.from(selIndustries);
    const kws = Array.from(selKeywords);
    setAppliedIndustries(inds);
    setAppliedKeywords(kws);
    setAiOpen(false);
    handleSearch(1, { industries: inds, keywords: kws });
  }

  function clearAppliedAi() {
    setAppliedIndustries([]);
    setAppliedKeywords([]);
    setSelIndustries(new Set());
    setSelKeywords(new Set());
    if (hasSearched) handleSearch(1, { industries: [], keywords: [] });
  }

  function toggleSelect(apolloId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(apolloId)) next.delete(apolloId);
      else next.add(apolloId);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map(r => r.apollo_id)));
    }
  }

  async function handleEnrich() {
    const ids = results
      .filter(r => selected.has(r.apollo_id) && !enrichedIds.has(r.apollo_id))
      .map(r => r.apollo_id);
    if (ids.length === 0) return;

    setEnriching(true);
    setShowEnrichConfirm(false);
    try {
      const data = await apolloApi.enrich(ids);
      const enriched = data.enriched || [];
      setResults(prev => prev.map(r => {
        const match = enriched.find((e: Record<string, unknown>) => e.apollo_id === r.apollo_id);
        if (match) return { ...r, ...match };
        return r;
      }));
      setEnrichedIds(prev => {
        const next = new Set(prev);
        enriched.forEach((e: Record<string, unknown>) => next.add(e.apollo_id as string));
        return next;
      });
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setEnriching(false);
    }
  }

  async function handleImport() {
    const toImport = results.filter(r => selected.has(r.apollo_id) && enrichedIds.has(r.apollo_id));
    if (toImport.length === 0) return;

    setImporting(true);
    setImportReport(null);
    try {
      const report = await apolloApi.import(toImport);
      setImportReport(report);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const selectedCount = selected.size;
  const newLeadsInResults = results.filter(r => !r.is_existing).length;
  const existingInResults = results.filter(r => r.is_existing).length;
  const selectedToEnrich = results.filter(r => selected.has(r.apollo_id) && !enrichedIds.has(r.apollo_id)).length;
  const selectedEnriched = results.filter(r => selected.has(r.apollo_id) && enrichedIds.has(r.apollo_id)).length;

  function clearAllPrimary() {
    setCompanyName(""); setDomain(""); setKeywords(""); setLinkedinUrl(""); setPersonName("");
    setSelectedStates([]); setCity("");
  }

  function toggleMulti(value: string, arr: string[], setter: (v: string[]) => void) {
    if (arr.includes(value)) setter(arr.filter(v => v !== value));
    else setter([...arr, value]);
  }

  function toggleSet(value: string, set: Set<string>, setter: (v: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-gray-900">Find Prospects</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Search 210M+ B2B &amp; B2C contact database. Search is free — credits are only used when importing contacts to your CRM.
            </p>
          </div>
          {!showGuide && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs shrink-0"
              onClick={() => toggleGuide(true)}
            >
              📖 Show Guide
            </Button>
          )}
        </div>

        {/* === Intro Guide (dismissible) === */}
        {showGuide && (
          <div className="relative p-5 bg-gray-50 rounded-lg border border-gray-200">
            <button
              onClick={() => toggleGuide(false)}
              className="absolute top-2 right-3 text-gray-400 hover:text-gray-600 text-lg leading-none"
              aria-label="Dismiss guide"
            >
              ✕
            </button>
            <p className="font-semibold text-sm text-gray-900 flex items-center gap-1.5">
              <span className="text-base">🔍</span> Find Your Next Prospects
            </p>
            <p className="text-xs text-gray-600 mt-2 leading-relaxed">
              Search by location to find prospects, or use AI Keyword Finder to discover
              industry-specific search terms that match real companies on Apollo&apos;s
              database of 210M+ contacts.
            </p>
            <p className="text-xs text-gray-500 mt-2">
              <span className="font-medium text-gray-700">How it works:</span>{" "}
              Select location → Search → Select prospects → Import to CRM
            </p>
          </div>
        )}

        {/* === Primary Search === */}
        <Card className="border-gray-200">
          <CardContent className="py-5 px-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                  <span className="text-base">🔍</span> Primary Search
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Fill at least one field below</p>
              </div>
              {(companyName || domain || keywords || linkedinUrl || personName ||
                selectedStates.length > 0 || city) && (
                <button
                  onClick={clearAllPrimary}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="space-y-3">
              <PrimaryField
                label="Company Name"
                placeholder="e.g. Acme Corp"
                value={companyName}
                onChange={setCompanyName}
              />
              <PrimaryField
                label="Company Domain"
                placeholder="e.g. acme.com"
                value={domain}
                onChange={setDomain}
              />
              <PrimaryField
                label="Keywords"
                placeholder="e.g. sign shop, printing"
                value={keywords}
                onChange={setKeywords}
                hint="Comma-separated industry/niche keywords"
              />
              <PrimaryField
                label="LinkedIn URL"
                placeholder="e.g. linkedin.com/in/john"
                value={linkedinUrl}
                onChange={setLinkedinUrl}
              />
              <PrimaryField
                label="Person Name"
                placeholder="e.g. John Smith"
                value={personName}
                onChange={setPersonName}
              />
            </div>

            {/* === State + City + Search button (one row) === */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="grid grid-cols-[1fr_220px_auto] gap-3 items-end">
                <div>
                  <Label className="text-xs font-medium text-gray-700">State (multi-select)</Label>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1.5 bg-white border border-gray-200 rounded mt-1">
                    {US_STATES.map(s => (
                      <button
                        key={s}
                        onClick={() => toggleMulti(s, selectedStates, setSelectedStates)}
                        className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                          selectedStates.includes(s)
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs font-medium text-gray-700">City (optional)</Label>
                  <Input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Dallas"
                    className="h-9 bg-white mt-1"
                  />
                </div>
                <Button
                  onClick={() => handleSearch(1)}
                  disabled={searching || !hasPrimaryInput}
                  className="h-9"
                >
                  {searching ? "Searching..." : "🔍 Search"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* === Applied AI filters chip row === */}
        {hasAppliedAi && (
          <div className="flex items-center flex-wrap gap-1.5 text-xs text-gray-600">
            <span className="text-gray-500 shrink-0">Filters:</span>
            {[...appliedIndustries, ...appliedKeywords].slice(0, 3).map(k => (
              <span key={k} className="bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
                {k}
              </span>
            ))}
            {(appliedIndustries.length + appliedKeywords.length) > 3 && (
              <span className="text-gray-500">
                +{appliedIndustries.length + appliedKeywords.length - 3} more
              </span>
            )}
            <button
              onClick={clearAppliedAi}
              className="ml-1 text-gray-400 hover:text-gray-700"
              title="Clear AI filters"
            >
              ✕
            </button>
          </div>
        )}

        {/* === AI Keyword Finder (collapsible) === */}
        <div className="bg-gray-50 rounded border border-gray-200">
          <button
            onClick={() => setAiOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-100 transition"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">
                {aiOpen ? "▼" : "▶"} AI Keyword Finder
              </span>
              <span className="text-xs text-gray-400">(optional)</span>
              {hasAppliedAi && (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-blue-50 text-blue-700">
                  {appliedIndustries.length + appliedKeywords.length} applied
                </Badge>
              )}
            </div>
          </button>

          {aiOpen && (
            <div className="px-5 pb-5 pt-1 space-y-4">
              <div className="text-xs text-gray-600 leading-relaxed">
                <p className="flex items-center gap-1.5 font-semibold text-gray-900 text-sm mb-1">
                  <span>🤖</span> AI Keyword Finder
                </p>
                <p>
                  Describe the industry or type of company you&apos;re looking for.
                  AI will suggest 20-40 relevant keywords that match real companies on Apollo.
                </p>
                <p className="mt-1">
                  Select the ones that fit your target, then click Apply to refine your search results.
                </p>
                <p className="mt-1 text-gray-400">
                  Example: Try &ldquo;signage&rdquo;, &ldquo;commercial printing&rdquo;, or &ldquo;LED display manufacturers&rdquo;
                </p>
              </div>

              <div className="flex gap-2">
                <Input
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleGenerateKeywords(); }
                  }}
                  placeholder="e.g. signage, printing, LED"
                  className="h-9 bg-white flex-1"
                  disabled={aiSuggesting}
                />
                <Button
                  onClick={handleGenerateKeywords}
                  disabled={aiSuggesting || !aiInput.trim()}
                  className="h-9 shrink-0"
                >
                  {aiSuggesting ? "Generating..." : "✨ Generate"}
                </Button>
              </div>

              {aiSuggesting && (
                <p className="text-xs text-gray-500 animate-pulse">Generating keywords...</p>
              )}
              {aiError && !aiSuggesting && (
                <p className="text-xs text-red-600">{aiError}</p>
              )}

              {!aiSuggesting && (aiIndustries.length > 0 || aiKeywords.length > 0) && (
                <div className="space-y-4 pt-2 border-t border-gray-200">
                  {aiIndustries.length > 0 && (
                    <div>
                      <Label className="text-xs font-medium text-gray-700 flex items-center gap-1">
                        🏭 Industries
                      </Label>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {aiIndustries.map(name => (
                          <CheckChip
                            key={name}
                            label={name}
                            checked={selIndustries.has(name)}
                            onToggle={() => toggleSet(name, selIndustries, setSelIndustries)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {aiKeywords.length > 0 && (
                    <div>
                      <Label className="text-xs font-medium text-gray-700 flex items-center gap-1">
                        🏷️ Keywords
                      </Label>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {aiKeywords.map(name => (
                          <CheckChip
                            key={name}
                            label={name}
                            checked={selKeywords.has(name)}
                            onToggle={() => toggleSet(name, selKeywords, setSelKeywords)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                    <p className="text-xs text-gray-600">
                      Selected: {selIndustries.size + selKeywords.size} keyword{(selIndustries.size + selKeywords.size) !== 1 ? "s" : ""}
                    </p>
                    <Button
                      size="sm"
                      onClick={handleApplyAi}
                      disabled={selIndustries.size + selKeywords.size === 0}
                    >
                      Apply to Search
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error */}
        {searchError && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-3 px-5">
              <p className="text-sm text-red-600">{searchError}</p>
            </CardContent>
          </Card>
        )}

        {/* Enrich Confirmation Dialog */}
        <Dialog open={showEnrichConfirm} onOpenChange={setShowEnrichConfirm}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Enrich Prospects</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-gray-600">
              Enrich {selectedToEnrich} prospect{selectedToEnrich !== 1 ? "s" : ""}?
              This will consume <strong>{selectedToEnrich} Credit{selectedToEnrich !== 1 ? "s" : ""}</strong>.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowEnrichConfirm(false)}>Cancel</Button>
              <Button onClick={handleEnrich}>Confirm Enrich</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Import Result Dialog */}
        <Dialog open={importReport !== null} onOpenChange={(v) => { if (!v) setImportReport(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Import Complete</DialogTitle>
            </DialogHeader>
            {importReport && (
              <div className="space-y-4 pt-2">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-green-600">&#10003;</span>
                    <span>New contacts created: <strong>{importReport.created}</strong></span>
                  </div>
                  {importReport.updated > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-blue-600">&#8635;</span>
                      <span>Existing contacts updated: <strong>{importReport.updated}</strong></span>
                    </div>
                  )}
                  {importReport.skipped > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">&#8212;</span>
                      <span>Skipped (no changes): <strong>{importReport.skipped}</strong></span>
                    </div>
                  )}
                  {(importReport.failed || 0) > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-red-500">&#10007;</span>
                      <span>Failed: <strong>{importReport.failed}</strong></span>
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => {
                    setImportReport(null);
                    router.push("/contacts");
                  }}>
                    View Imported Contacts
                  </Button>
                  <Button onClick={() => {
                    setImportReport(null);
                    handleSearch(currentPage);
                  }}>
                    Continue Searching
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* === Search Results === */}
        {hasSearched && (
          <div className="pt-2">
            <div className="flex items-center gap-3 mb-2">
              <p className="text-sm text-gray-600">
                {totalResults.toLocaleString()} results found
              </p>
              {results.length > 0 && (
                <div className="flex gap-2">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                    {newLeadsInResults} New
                  </Badge>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                    {existingInResults} Existing
                  </Badge>
                </div>
              )}
            </div>

            {results.length > 0 && (
              <div className="flex items-center gap-4 px-3 py-2 mb-2 bg-gray-50 rounded-md border border-gray-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={results.length > 0 && selected.size === results.length}
                    onChange={selectAll}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-600">Select All</span>
                </label>
                <span className="text-sm text-gray-400">|</span>
                <span className="text-sm text-gray-600">
                  Selected {selectedCount} / {results.length}
                </span>
                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowEnrichConfirm(true)}
                    disabled={selectedToEnrich === 0 || enriching}
                  >
                    {enriching ? "Enriching..." : `Enrich ${selectedToEnrich > 0 ? selectedToEnrich : ""}`}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleImport}
                    disabled={selectedEnriched === 0 || importing}
                    title={selectedEnriched === 0 ? "Please enrich prospects first" : ""}
                  >
                    {importing
                      ? "Importing..."
                      : `Add ${selectedEnriched > 0 ? selectedEnriched : ""} to Contacts`}
                  </Button>
                </div>
              </div>
            )}

            {results.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-gray-400">
                  No results found. Try adjusting your filters.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-1">
                {results.map((person) => (
                  <div
                    key={person.apollo_id}
                    className={`flex items-center gap-3 p-3 rounded-md border transition-colors cursor-pointer ${
                      selected.has(person.apollo_id)
                        ? "border-gray-300 bg-gray-50"
                        : "border-transparent hover:bg-gray-50"
                    }`}
                    onClick={() => toggleSelect(person.apollo_id)}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(person.apollo_id)}
                      onChange={() => toggleSelect(person.apollo_id)}
                      className="h-4 w-4 rounded border-gray-300"
                      onClick={(e) => e.stopPropagation()}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-900">
                          {person.first_name} {person.last_name}
                        </span>
                        {person.title && (
                          <span className="text-xs text-gray-500">
                            {person.title}
                            {person.company_name && ` @ ${person.company_name}`}
                          </span>
                        )}
                        {!person.title && person.company_name && (
                          <span className="text-xs text-gray-500">@ {person.company_name}</span>
                        )}
                        <div className="ml-auto flex gap-1.5 shrink-0">
                          {enrichedIds.has(person.apollo_id) ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                              Enriched
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-gray-50 text-gray-400 border-gray-200 text-xs">
                              Basic
                            </Badge>
                          )}
                          {person.is_existing && (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                              Exists
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                        <span>
                          {[person.city, person.state, person.country].filter(Boolean).join(", ") || "\u2014"}
                        </span>
                        <span>
                          {person.company_size ? `${person.company_size} employees` : "\u2014"}
                        </span>
                        <span>
                          {(person.annual_revenue as string) || "\u2014"}
                        </span>
                      </div>

                      {((person.industry_keywords && (person.industry_keywords as string[]).length > 0) || person.industry) && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(person.industry_keywords as string[] || []).slice(0, 5).map((kw, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px] py-0 px-1.5">{String(kw)}</Badge>
                          ))}
                          {(!(person.industry_keywords as string[])?.length && person.industry) && (
                            <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{String(person.industry)}</Badge>
                          )}
                        </div>
                      )}

                      {enrichedIds.has(person.apollo_id) ? (
                        <div className="flex items-center gap-3 mt-1 text-xs">
                          <span className="text-gray-600">{person.email || "No email"}</span>
                          {person.phone && <span className="text-gray-500">{String(person.phone)}</span>}
                          {person.linkedin_url && (
                            <a href={String(person.linkedin_url)} target="_blank" rel="noopener noreferrer"
                              className="text-blue-500 hover:underline"
                              onClick={(e) => e.stopPropagation()}>
                              LinkedIn
                            </a>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-300 mt-1 italic">
                          Enrich to reveal email, phone, and LinkedIn
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {totalResults > 25 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1 || searching}
                  onClick={() => handleSearch(currentPage - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-500">
                  Page {currentPage}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={results.length < 25 || searching}
                  onClick={() => handleSearch(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}


// === Helper components ===

function PrimaryField({
  label, placeholder, value, onChange, hint,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="grid grid-cols-4 gap-3 items-center">
      <Label className="text-xs text-gray-700 font-medium">{label}</Label>
      <div className="col-span-3">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-9"
        />
        {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

function CheckChip({
  label, checked, onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors ${
        checked
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="sr-only"
      />
      <span
        className={`inline-block w-3 h-3 rounded-sm border ${
          checked ? "bg-white border-white" : "bg-white border-gray-300"
        } flex items-center justify-center`}
      >
        {checked && <span className="text-gray-900 text-[10px] leading-none">✓</span>}
      </span>
      {label}
    </label>
  );
}
