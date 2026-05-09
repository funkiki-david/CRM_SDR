"use client";

import type { ImportStats } from "./shared/import-result-modal";

interface Props {
  onImportComplete: (stats: ImportStats) => void;
}

// Placeholder — Browse Companies logic lifted from old page.tsx in Step 5.
// Old logic temporarily unavailable on this branch between Steps 2-4 (by design,
// per Spec B §7.1) — git history preserves it on `main` until merge.
export default function BrowseCompaniesTab(_: Props) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400 text-sm">
      Browse Companies tab — implementation coming in Step 5 (lifted from old page.tsx)
    </div>
  );
}
