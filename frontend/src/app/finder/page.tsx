/**
 * Finder Page — 两层结构（参考 Apollo.io）
 *
 *  Primary Search (主搜索区，白色，始终可见):
 *    - Company Name / Company Domain / Keywords / LinkedIn URL / Person Name
 *    - 至少填一个才能搜
 *
 *  Refine Results (筛选项，灰色，默认折叠):
 *    - Location (多选 State + City)
 *    - Industry / Seniority / Company Size / Annual Revenue (全部 checkbox 多选)
 *    - 改动时自动重新搜索（首次 Search Prospects 之后）
 */
"use client";

import { useEffect, useRef, useState } from "react";
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
import { apolloApi } from "@/lib/api";

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

const INDUSTRIES = [
  { id: "printing", label: "Printing" },
  { id: "signage", label: "Signage" },
  { id: "manufacturing", label: "Manufacturing" },
  { id: "marketing", label: "Marketing" },
];

const SENIORITIES = [
  { val: "manager", label: "Manager" },
  { val: "director", label: "Director" },
  { val: "vp", label: "VP" },
  { val: "c_suite", label: "C-Suite" },
  { val: "founder", label: "Founder" },
];

const COMPANY_SIZES = [
  { val: "1,10", label: "1-10" },
  { val: "11,50", label: "11-50" },
  { val: "51,200", label: "51-200" },
  { val: "201,500", label: "201-500" },
  { val: "501,10000", label: "500+" },
];

const REVENUES = [
  { val: "0,1000000", label: "<$1M" },
  { val: "1000000,10000000", label: "$1M-$10M" },
  { val: "10000000,50000000", label: "$10M-$50M" },
  { val: "50000000,10000000000", label: "$50M+" },
];

export default function FinderPage() {
  const router = useRouter();

  // === Primary Search ===
  const [companyName, setCompanyName] = useState("");
  const [domain, setDomain] = useState("");
  const [keywords, setKeywords] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [personName, setPersonName] = useState("");

  // === Refine Filters ===
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [city, setCity] = useState("");
  const [industry, setIndustry] = useState<string[]>([]);
  const [seniority, setSeniority] = useState<string[]>([]);
  const [employeeRange, setEmployeeRange] = useState<string[]>([]);
  const [revenueRange, setRevenueRange] = useState<string[]>([]);
  const [refineOpen, setRefineOpen] = useState(false);

  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("finder_guide_dismissed") !== "1";
    return true;
  });

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
    linkedinUrl.trim() || personName.trim()
  );

  // === 有任何筛选项被改 ===
  const hasRefineFilters = selectedStates.length > 0 || city.trim() ||
    industry.length > 0 || seniority.length > 0 ||
    employeeRange.length > 0 || revenueRange.length > 0;

  async function handleSearch(page = 1) {
    setSearching(true);
    setSearchError("");
    setImportReport(null);

    const filters: Record<string, unknown> = { page, per_page: 25 };

    // Primary
    if (companyName.trim()) filters.q_organization_name = companyName.trim();
    if (domain.trim()) filters.company_domain = domain.trim();
    if (keywords.trim()) filters.q_organization_keyword_tags = keywords.split(",").map(k => k.trim()).filter(Boolean);
    // LinkedIn URL + Person Name 都走 Apollo 的 free-text q_keywords
    const freeTextParts = [linkedinUrl.trim(), personName.trim()].filter(Boolean);
    if (freeTextParts.length > 0) filters.q_keywords = freeTextParts.join(" ");

    // Refine (AND 关系，每加一个缩小范围)
    if (selectedStates.length > 0) {
      const locs = selectedStates.map(s => `${s}, US`);
      if (city.trim()) {
        // 城市和州组合，Apollo 会按每个 location 做 OR
        filters.person_locations = selectedStates.map(s => `${city.trim()}, ${s}, US`);
      } else {
        filters.person_locations = locs;
      }
    } else if (city.trim()) {
      filters.person_locations = [city.trim()];
    }
    if (industry.length) filters.organization_industry_tag_ids = industry;
    if (seniority.length) filters.person_seniorities = seniority;
    if (employeeRange.length) filters.employee_ranges = employeeRange;
    if (revenueRange.length) filters.revenue_ranges = revenueRange;

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

  // === 首次搜索后，Refine 改动自动重搜 ===
  // 用 ref 记录上一次 refine 状态，避免重复搜索
  const firstSearchDone = useRef(false);
  const refineKey = JSON.stringify({
    selectedStates, city, industry, seniority, employeeRange, revenueRange,
  });

  useEffect(() => {
    if (!hasSearched) { firstSearchDone.current = true; return; }
    if (!firstSearchDone.current) { firstSearchDone.current = true; return; }
    // 防抖：城市输入时避免每次按键都搜索
    const timer = setTimeout(() => handleSearch(1), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refineKey]);

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
  }

  function clearRefineFilters() {
    setSelectedStates([]); setCity("");
    setIndustry([]); setSeniority([]); setEmployeeRange([]); setRevenueRange([]);
  }

  function dismissGuide() {
    setShowGuide(false);
    localStorage.setItem("finder_guide_dismissed", "1");
  }

  function toggleMulti(value: string, arr: string[], setter: (v: string[]) => void) {
    if (arr.includes(value)) setter(arr.filter(v => v !== value));
    else setter([...arr, value]);
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Find Prospects</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Search Apollo&rsquo;s 210M+ contact database. Search is free — credits only used on enrichment.
          </p>
        </div>

        {/* === Guide Banner === */}
        {showGuide && (
          <div className="relative p-3 bg-blue-50 rounded border border-blue-100">
            <button onClick={dismissGuide} className="absolute top-2 right-3 text-gray-400 hover:text-gray-600 text-sm">&times;</button>
            <p className="text-xs text-gray-600">
              <b>Primary Search</b>（白色区域）填至少一个就能搜 ·
              <b className="ml-1">Refine Results</b>（灰色区域）用于进一步缩小结果范围
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
              {(companyName || domain || keywords || linkedinUrl || personName) && (
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

            <div className="flex justify-end mt-4 pt-3 border-t border-gray-100">
              <Button
                onClick={() => handleSearch(1)}
                disabled={searching || !hasPrimaryInput}
              >
                {searching ? "Searching..." : "Search Prospects"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* === Refine Results (collapsible) === */}
        <div className="bg-gray-50 rounded border border-gray-200">
          <button
            onClick={() => setRefineOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-100 transition"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">
                {refineOpen ? "▼" : "▶"} Refine Results
              </span>
              <span className="text-xs text-gray-400">(optional filters)</span>
              {hasRefineFilters && (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-blue-50 text-blue-700">
                  {selectedStates.length + (city ? 1 : 0) + industry.length +
                   seniority.length + employeeRange.length + revenueRange.length} active
                </Badge>
              )}
            </div>
            {hasRefineFilters && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); clearRefineFilters(); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); clearRefineFilters(); }
                }}
                className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                Clear Filters
              </span>
            )}
          </button>

          {refineOpen && (
            <div className="px-5 pb-5 space-y-5">
              {/* Location */}
              <div>
                <Label className="text-xs font-medium text-gray-700">Location</Label>
                <div className="grid grid-cols-2 gap-3 mt-1.5">
                  <div>
                    <p className="text-[10px] text-gray-500 mb-1">State (multi-select)</p>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 bg-white border border-gray-200 rounded">
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
                    <p className="text-[10px] text-gray-500 mb-1">City (optional)</p>
                    <Input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="e.g. Dallas"
                      className="h-9 bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Industry */}
              <FilterGroup
                label="Industry"
                options={INDUSTRIES.map(i => ({ val: i.id, label: i.label }))}
                selected={industry}
                onToggle={(v) => toggleMulti(v, industry, setIndustry)}
              />

              {/* Seniority */}
              <FilterGroup
                label="Seniority"
                options={SENIORITIES}
                selected={seniority}
                onToggle={(v) => toggleMulti(v, seniority, setSeniority)}
              />

              {/* Company Size */}
              <FilterGroup
                label="Company Size (employees)"
                options={COMPANY_SIZES}
                selected={employeeRange}
                onToggle={(v) => toggleMulti(v, employeeRange, setEmployeeRange)}
              />

              {/* Revenue */}
              <FilterGroup
                label="Annual Revenue"
                options={REVENUES}
                selected={revenueRange}
                onToggle={(v) => toggleMulti(v, revenueRange, setRevenueRange)}
              />

              {hasSearched && (
                <p className="text-[11px] text-gray-400 pt-2 border-t border-gray-200">
                  Filters apply automatically — results update as you select.
                </p>
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
              This will consume <strong>{selectedToEnrich} Apollo Credit{selectedToEnrich !== 1 ? "s" : ""}</strong>.
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

function FilterGroup({
  label, options, selected, onToggle,
}: {
  label: string;
  options: { val: string; label: string }[];
  selected: string[];
  onToggle: (val: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs font-medium text-gray-700">{label}</Label>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {options.map(o => (
          <label
            key={o.val}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors ${
              selected.includes(o.val)
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            }`}
          >
            <input
              type="checkbox"
              checked={selected.includes(o.val)}
              onChange={() => onToggle(o.val)}
              className="sr-only"
            />
            <span
              className={`inline-block w-3 h-3 rounded-sm border ${
                selected.includes(o.val) ? "bg-white border-white" : "bg-white border-gray-300"
              } flex items-center justify-center`}
            >
              {selected.includes(o.val) && (
                <span className="text-gray-900 text-[10px] leading-none">✓</span>
              )}
            </span>
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}
