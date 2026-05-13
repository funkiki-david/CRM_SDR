/**
 * PipelineAccordion — collapsible row of 6 pipeline-stage pills.
 *
 * Default collapsed. Click header to expand. Title reflects scope.
 *
 * Pill → status mapping (backend LeadStatus enum has 7 values; we show 6 by
 * folding "interested" under the "Qualified" label. meeting_set is grouped
 * separately as "Meeting set" if anything sits there, but the default 6 pills
 * mirror the spec's New / Contacted / Qualified / Proposal / Won / Lost).
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PipelineResponse, Scope } from "./types";

interface Props {
  pipeline: PipelineResponse | null;
  scope: Scope;
  userId: number | null;
}

const PILLS: Array<{
  label: string;
  statusKey: string;
  bg: string;
  text: string;
}> = [
  { label: "New",       statusKey: "new",         bg: "bg-slate-100",   text: "text-slate-700" },
  { label: "Contacted", statusKey: "contacted",   bg: "bg-blue-50",     text: "text-blue-700" },
  { label: "Qualified", statusKey: "interested",  bg: "bg-indigo-50",   text: "text-indigo-700" },
  { label: "Proposal",  statusKey: "proposal",    bg: "bg-amber-50",    text: "text-amber-700" },
  { label: "Won",       statusKey: "closed_won",  bg: "bg-emerald-50",  text: "text-emerald-700" },
  { label: "Lost",      statusKey: "closed_lost", bg: "bg-rose-50",     text: "text-rose-700" },
];

export default function PipelineAccordion({ pipeline, scope, userId }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const totalContacts = pipeline
    ? Object.values(pipeline.pipeline).reduce((sum, n) => sum + n, 0)
    : 0;

  const headerLabel =
    scope === "team" ? "Team pipeline" : "My pipeline";

  function pillClick(statusKey: string) {
    const params = new URLSearchParams();
    params.set("status", statusKey);
    if (scope === "mine" && userId != null) {
      params.set("assigned_to", String(userId));
    }
    router.push(`/contacts?${params.toString()}`);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white mb-6 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors"
      >
        <span className="text-sm font-medium text-slate-700">
          {headerLabel}
          <span className="text-slate-400">
            {" · "}
            {totalContacts} {totalContacts === 1 ? "contact" : "contacts"}
          </span>
        </span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-5 py-4 flex flex-wrap gap-2">
          {PILLS.map((p) => {
            const count = pipeline?.pipeline[p.statusKey as keyof typeof pipeline.pipeline] ?? 0;
            return (
              <button
                key={p.statusKey}
                type="button"
                onClick={() => pillClick(p.statusKey)}
                className={`inline-flex items-center gap-2 rounded-full ${p.bg} ${p.text} px-3.5 py-1.5 text-xs font-medium hover:brightness-95 transition`}
              >
                <span>{p.label}</span>
                <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
