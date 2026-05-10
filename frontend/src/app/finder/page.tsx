/**
 * Finder Page — 3-tab shell.
 *
 * URL is the source of truth for the active tab (?tab=website|email|browse).
 * Default tab when no ?tab= param is present: website.
 *
 * Page-level state:
 *   - importModal  shared by all 3 tabs; each tab calls onImportComplete()
 *   - guideOpen    toggled by the "Show Guide" pill button
 *
 * Each tab owns its own search/result/selection state internally so cross-tab
 * navigation is clean (closing one tab doesn't dirty another).
 */
"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import FindByWebsiteTab from "@/components/finder/find-by-website-tab";
import FindByEmailTab from "@/components/finder/find-by-email-tab";
import BrowseCompaniesTab from "@/components/finder/browse-companies-tab";
import ImportResultModal, {
  type ImportStats,
} from "@/components/finder/shared/import-result-modal";

type TabKey = "website" | "email" | "browse";
const VALID_TABS: TabKey[] = ["website", "email", "browse"];

const TABS: { key: TabKey; icon: string; label: string }[] = [
  { key: "website", icon: "🌐", label: "Find by Website" },
  { key: "email", icon: "📧", label: "Find by Email" },
  { key: "browse", icon: "🔍", label: "Browse Companies" },
];

function FinderPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const tabParam = searchParams.get("tab") as TabKey | null;
  const currentTab: TabKey =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : "website";

  // PATCH-6: when ?tab= is present but not a valid value (e.g.
  // /finder?tab=invalid_xyz), strip the param so the URL matches the
  // rendered tab. router.replace doesn't add a history entry — clean
  // back-button behavior. Bare /finder (no ?tab=) is left alone since
  // it correctly renders the default Find by Website tab.
  useEffect(() => {
    if (tabParam !== null && !VALID_TABS.includes(tabParam)) {
      router.replace("/finder");
    }
  }, [tabParam, router]);

  const setTab = useCallback(
    (tab: TabKey) => {
      router.push(`/finder?tab=${tab}`);
    },
    [router]
  );

  const [importModal, setImportModal] = useState<{
    open: boolean;
    stats: ImportStats;
  }>({
    open: false,
    stats: { added: 0, updated: 0, skipped: 0, creditsUsed: 0 },
  });

  const onImportComplete = useCallback((stats: ImportStats) => {
    setImportModal({ open: true, stats });
  }, []);

  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-slate-900 tracking-tight">
              Find prospects
            </h1>
            <p className="text-sm text-slate-500 mt-2 max-w-3xl">
              Search 210M+ B2B & B2C contacts. Search is free — credits are
              only used when importing to your CRM.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setGuideOpen((v) => !v)}
            className="shrink-0 rounded-full border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 transition-colors"
          >
            {guideOpen ? "Hide Guide" : "Show Guide"}
          </button>
        </div>

        {guideOpen && <GuideBox onClose={() => setGuideOpen(false)} />}

        {/* Tab bar */}
        <div className="flex flex-wrap gap-2 p-1.5 bg-white border border-slate-200 rounded-2xl w-fit my-6 shadow-sm">
          {TABS.map((t) => (
            <TabButton
              key={t.key}
              active={currentTab === t.key}
              onClick={() => setTab(t.key)}
              icon={t.icon}
              label={t.label}
            />
          ))}
        </div>

        {/* Tab content */}
        {currentTab === "website" && (
          <FindByWebsiteTab onImportComplete={onImportComplete} />
        )}
        {currentTab === "email" && (
          <FindByEmailTab onImportComplete={onImportComplete} />
        )}
        {currentTab === "browse" && (
          <BrowseCompaniesTab onImportComplete={onImportComplete} />
        )}
      </div>

      <ImportResultModal
        open={importModal.open}
        stats={importModal.stats}
        onClose={() =>
          setImportModal((prev) => ({ ...prev, open: false }))
        }
      />
    </AppShell>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
        active
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
      }`}
    >
      <span className="text-base">{icon}</span> {label}
    </button>
  );
}

function GuideBox({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-200 px-5 py-4 text-sm text-slate-700 relative">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close guide"
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-700 text-lg leading-none"
      >
        ×
      </button>
      <p className="font-medium text-slate-900 mb-1">How it works</p>
      <p className="leading-relaxed pr-6">
        Pick the tab that matches what you have.{" "}
        <span className="font-medium">Find by Website</span> if you have a
        company URL ·{" "}
        <span className="font-medium">Find by Email</span> if you have a
        contact&apos;s email ·{" "}
        <span className="font-medium">Browse Companies</span> if you want to
        discover new ones from scratch. Searches are free; credits are only
        used when you import contacts.
      </p>
    </div>
  );
}

export default function FinderPage() {
  return (
    <Suspense
      fallback={
        <div className="px-6 py-10 text-sm text-slate-400">Loading…</div>
      }
    >
      <FinderPageInner />
    </Suspense>
  );
}
