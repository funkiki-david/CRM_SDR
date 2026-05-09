"use client";

import type { ImportStats } from "./shared/import-result-modal";

interface Props {
  onImportComplete: (stats: ImportStats) => void;
}

// Placeholder — real implementation lands in Step 3.
export default function FindByWebsiteTab(_: Props) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400 text-sm">
      Find by Website tab — implementation coming in next commit
    </div>
  );
}
