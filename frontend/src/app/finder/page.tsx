/**
 * Finder Page — Search Apollo.io for prospects and import them into the CRM
 * Features:
 *   - ICP filter form (title, location, industry, company size, domain)
 *   - Results with automatic dedup: blue "Exists" vs green "New Lead"
 *   - Checkbox select + bulk import
 *   - Import result report
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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

export default function FinderPage() {
  const router = useRouter();

  // Filter state
  const [companyName, setCompanyName] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const [seniority, setSeniority] = useState<string[]>([]);
  const [industry, setIndustry] = useState<string[]>([]);
  const [employeeRange, setEmployeeRange] = useState<string[]>([]);
  const [revenueRange, setRevenueRange] = useState<string[]>([]);
  const [keywords, setKeywords] = useState("");
  const [domain, setDomain] = useState("");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
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

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Enrich state
  const [enrichedIds, setEnrichedIds] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [showEnrichConfirm, setShowEnrichConfirm] = useState(false);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);

  async function handleSearch(page = 1) {
    setSearching(true);
    setSearchError("");
    setImportReport(null);

    const filters: Record<string, unknown> = { page, per_page: 25 };
    if (companyName.trim()) filters.q_organization_name = companyName.trim();
    if (selectedState) filters.person_locations = [`${selectedState}, US`];
    if (seniority.length) filters.person_seniorities = seniority;
    if (industry.length) filters.organization_industry_tag_ids = industry;
    if (employeeRange.length) filters.employee_ranges = employeeRange;
    if (revenueRange.length) filters.revenue_ranges = revenueRange;
    if (keywords.trim()) filters.q_organization_keyword_tags = keywords.split(",").map(k => k.trim());
    if (domain.trim()) filters.company_domain = domain.trim();

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

      // Update results in-place with enriched data
      setResults(prev => prev.map(r => {
        const match = enriched.find((e: Record<string, unknown>) => e.apollo_id === r.apollo_id);
        if (match) return { ...r, ...match };
        return r;
      }));

      // Mark as enriched
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
    // Only import enriched contacts
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

  const hasAnyFilter = companyName.trim() || selectedState || seniority.length > 0 ||
    industry.length > 0 || employeeRange.length > 0 || revenueRange.length > 0 ||
    keywords.trim() || domain.trim();

  function clearAllFilters() {
    setCompanyName(""); setSelectedState(""); setSeniority([]);
    setIndustry([]); setEmployeeRange([]); setRevenueRange([]);
    setKeywords(""); setDomain("");
  }

  const US_STATES = [
    "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
    "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
    "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
    "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire",
    "New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio",
    "Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota",
    "Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia",
    "Wisconsin","Wyoming",
  ];

  function dismissGuide() {
    setShowGuide(false);
    localStorage.setItem("finder_guide_dismissed", "1");
  }

  // Multi-select toggle helper
  function toggleMulti(value: string, arr: string[], setter: (v: string[]) => void) {
    if (arr.includes(value)) setter(arr.filter(v => v !== value));
    else setter([...arr, value]);
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* === Guide Banner === */}
        {showGuide && (
          <div className="relative p-4 bg-gray-50 rounded-lg border border-gray-100">
            <button onClick={dismissGuide} className="absolute top-2 right-3 text-gray-400 hover:text-gray-600 text-sm">&times;</button>
            <p className="font-medium text-sm text-gray-800">Find Your Next Prospects</p>
            <p className="text-xs text-gray-500 mt-1">
              Define your ideal customer profile (ICP) with the filters below.
              Apollo will search 210M+ contacts for matches.
              Search is free &mdash; credits are only used when you import.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Fill filters &rarr; Search &rarr; Select &rarr; Import to CRM
            </p>
          </div>
        )}

        {/* === ICP Filter Form === */}
        <Card>
          <CardContent className="py-4 px-5 space-y-4">
            {/* Row 1: Company Name, State, Industry */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Company Name</Label>
                <Input placeholder="e.g. Google, Stripe, Amazon" value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">State</Label>
                <select value={selectedState} onChange={(e) => setSelectedState(e.target.value)}
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm bg-white">
                  <option value="">Any state</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Industry</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: "printing", label: "Printing" },
                    { id: "signage", label: "Signage" },
                    { id: "manufacturing", label: "Manufacturing" },
                    { id: "marketing", label: "Marketing" },
                  ].map(ind => (
                    <button key={ind.id} onClick={() => toggleMulti(ind.id, industry, setIndustry)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        industry.includes(ind.id)
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                      }`}>
                      {ind.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 2: Seniority, Company Size, Revenue */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Seniority Level</Label>
                <div className="flex flex-wrap gap-1.5">
                  {["manager", "director", "vp", "c_suite", "founder"].map(s => (
                    <button key={s} onClick={() => toggleMulti(s, seniority, setSeniority)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        seniority.includes(s)
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                      }`}>
                      {s === "c_suite" ? "C-Suite" : s === "vp" ? "VP" : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Company Size</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { val: "11,50", label: "11-50" },
                    { val: "51,200", label: "51-200" },
                    { val: "201,500", label: "201-500" },
                  ].map(s => (
                    <button key={s.val} onClick={() => toggleMulti(s.val, employeeRange, setEmployeeRange)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        employeeRange.includes(s.val)
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                      }`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Annual Revenue</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { val: "1000000,10000000", label: "$1M-$10M" },
                    { val: "10000000,50000000", label: "$10M-$50M" },
                    { val: "50000000,100000000", label: "$50M-$100M" },
                  ].map(r => (
                    <button key={r.val} onClick={() => toggleMulti(r.val, revenueRange, setRevenueRange)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        revenueRange.includes(r.val)
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                      }`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 3: More filters (collapsible) */}
            <div>
              <button onClick={() => setShowMoreFilters(!showMoreFilters)}
                className="text-xs text-blue-600 hover:underline">
                {showMoreFilters ? "Hide extra filters" : "More Filters"}
              </button>
              {showMoreFilters && (
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Keywords</Label>
                    <Input placeholder="e.g. SaaS, AI, FinTech" value={keywords}
                      onChange={(e) => setKeywords(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Company Domain</Label>
                    <Input placeholder="e.g. google.com" value={domain}
                      onChange={(e) => setDomain(e.target.value)} />
                  </div>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between pt-1">
              <button onClick={clearAllFilters}
                className="text-xs text-gray-400 hover:text-gray-600">
                Clear All Filters
              </button>
              <Button onClick={() => handleSearch(1)} disabled={searching || !hasAnyFilter}>
                {searching ? "Searching..." : "Search Prospects"}
              </Button>
            </div>
          </CardContent>
        </Card>

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
          <div>
            {/* Results header: count + badges */}
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

            {/* Selection toolbar */}
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

            {/* Results list */}
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
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selected.has(person.apollo_id)}
                      onChange={() => toggleSelect(person.apollo_id)}
                      className="h-4 w-4 rounded border-gray-300"
                      onClick={(e) => e.stopPropagation()}
                    />

                    {/* Person info card */}
                    <div className="flex-1 min-w-0">
                      {/* Row 1: Name · Title @ Company + Status badges */}
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
                          {/* Enrichment status */}
                          {enrichedIds.has(person.apollo_id) ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                              Enriched
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-gray-50 text-gray-400 border-gray-200 text-xs">
                              Basic
                            </Badge>
                          )}
                          {/* Dedup badge */}
                          {person.is_existing && (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                              Exists
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Row 2: Location · Company Size · Revenue (always show what we have) */}
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

                      {/* Row 3: Industry keywords */}
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

                      {/* Row 4: Contact info (only visible after enrichment) */}
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

            {/* Pagination */}
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
