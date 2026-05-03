/**
 * AI Budget — shared component + hook.
 *
 *   useAIBudget()       Hook — returns the current user's today usage + a refresher
 *   <AIBudgetBadge/>    Compact badge, sits next to AI buttons
 *   <AILimitModal/>     Blocking modal shown once the budget is exhausted
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { aiApi } from "@/lib/api";

export interface AIUsage {
  spent_today: number;
  daily_limit?: number;
  remaining?: number;
  percent?: number;
  color: "green" | "yellow" | "red";
  at_limit: boolean;
  unlimited: boolean;
}

// ==================== Hook ====================

export function useAIBudget() {
  const [usage, setUsage] = useState<AIUsage | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await aiApi.getUsage() as AIUsage;
      setUsage(data);
    } catch {
      // ignore — badge will not render
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { usage, loading, refresh };
}

// ==================== Badge ====================

const COLOR_CLASSES: Record<string, string> = {
  green: "text-green-600 bg-green-50 border-green-200",
  yellow: "text-yellow-700 bg-yellow-50 border-yellow-200",
  red: "text-red-700 bg-red-50 border-red-200",
};

export function AIBudgetBadge({
  usage, compact = false,
}: {
  usage: AIUsage | null;
  compact?: boolean;
}) {
  if (!usage) return null;

  if (usage.unlimited) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <span>🤖</span>
        <span>AI Budget: <b>Unlimited</b></span>
      </span>
    );
  }

  const color = COLOR_CLASSES[usage.color] || COLOR_CLASSES.green;
  const text = compact
    ? `$${usage.spent_today.toFixed(2)} / $${(usage.daily_limit ?? 0).toFixed(2)}`
    : `AI Budget: $${usage.spent_today.toFixed(2)} / $${(usage.daily_limit ?? 0).toFixed(2)}`;

  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 border rounded ${color}`}>
      <span>🤖</span>
      <span>{text}</span>
    </span>
  );
}

// ==================== Limit Reached Modal ====================

export function AILimitModal({
  open, usage, onClose, adminEmail = "info@amazonsolutions.us",
}: {
  open: boolean;
  usage: AIUsage | null;
  onClose: () => void;
  adminEmail?: string;
}) {
  const spent = usage?.spent_today ?? 0;
  const limit = usage?.daily_limit ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            <span>AI Usage Limit Reached</span>
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3 text-sm text-gray-700">
          <p>
            You&rsquo;ve used <b>${spent.toFixed(2)}</b> / <b>${limit.toFixed(2)}</b> of your daily AI budget.
          </p>
          <p>
            Your budget resets tomorrow at <b>12:00 AM</b>.
          </p>
          <p>
            Need more? Contact your Admin to upgrade your daily limit.
          </p>
          <p className="text-xs text-gray-500">
            Admin: <a href={`mailto:${adminEmail}`} className="text-blue-600 hover:underline">{adminEmail}</a>
          </p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== Guarded AI Button ====================

/**
 * Convenience wrapper around any AI-triggering button. When the budget is
 * exhausted the click pops the limit modal instead of firing onClick.
 * Usage:
 *   <AIGuardedButton usage={usage} onClick={doAICall}>Generate</AIGuardedButton>
 */
export function AIGuardedButton({
  usage, onClick, children, className, disabled,
}: {
  usage: AIUsage | null;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [showModal, setShowModal] = useState(false);
  const atLimit = usage?.at_limit ?? false;

  return (
    <>
      <button
        onClick={() => {
          if (atLimit) { setShowModal(true); return; }
          onClick();
        }}
        disabled={disabled || atLimit}
        className={className}
        title={atLimit ? "AI budget reached" : undefined}
      >
        {children}
      </button>
      <AILimitModal open={showModal} usage={usage} onClose={() => setShowModal(false)} />
    </>
  );
}
