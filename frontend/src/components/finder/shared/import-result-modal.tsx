"use client";

import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ImportStats {
  added: number;
  updated: number;
  skipped: number;
  creditsUsed: number;
}

interface Props {
  open: boolean;
  stats: ImportStats;
  onClose: () => void;
}

export default function ImportResultModal({ open, stats, onClose }: Props) {
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import complete</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <Row label="Added" value={stats.added} accent="text-emerald-600" />
          <Row label="Updated" value={stats.updated} accent="text-blue-600" />
          <Row label="Skipped" value={stats.skipped} accent="text-slate-500" />
          {stats.creditsUsed > 0 && (
            <p className="text-xs text-slate-500 pt-2 border-t">
              {stats.creditsUsed} Apollo credit{stats.creditsUsed === 1 ? "" : "s"} used
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={() => {
              onClose();
              router.push("/contacts");
            }}
          >
            Go to Contacts
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className={`font-semibold text-base ${accent}`}>{value}</span>
    </div>
  );
}
