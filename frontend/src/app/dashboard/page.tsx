/**
 * Dashboard V1 — thin shell.
 *
 * Composes 4 dashboard sections:
 *   1. DashboardTopBar       — greeting + stat line + My/All toggle + refresh
 *   2. PipelineAccordion     — collapsible row of 6 stage pills
 *   3. WhatsNewSection       — unread @mention inbox (hidden when empty)
 *   4. FollowUpsSection      — 4 time-bucketed follow-up lists
 *
 * Page-level state:
 *   - scope: "mine" (default) | "team"
 *   - follow-ups, pipeline, mentions, current user
 *
 * Spec V1 (2026-05-12) removed:
 *   - Quick Stats 4-card row (stats now inline in DashboardTopBar)
 *   - AI Suggestions section (deferred for later redesign)
 *   - Activity Feed (paged) — moved off the dashboard for now
 *
 * Backend endpoints still exist (/quick-stats, /ai-budget,
 * /ai/suggest-todos) for future surfaces; only this page stopped
 * calling them.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import AppShell from "@/components/app-shell";
import DashboardTopBar from "@/components/dashboard/dashboard-top-bar";
import PipelineAccordion from "@/components/dashboard/pipeline-accordion";
import WhatsNewSection from "@/components/dashboard/whats-new-section";
import FollowUpsSection from "@/components/dashboard/follow-ups-section";
import { authApi, dashboardApi } from "@/lib/api";
import type {
  CurrentUser,
  FollowUp,
  FollowUpsResponse,
  Mention,
  MentionsResponse,
  PipelineResponse,
  Scope,
} from "@/components/dashboard/types";

export default function DashboardPage() {
  const [scope, setScope] = useState<Scope>("mine");
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpsResponse | null>(null);
  const [pipeline, setPipeline] = useState<PipelineResponse | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [me, fu, pipe, ment] = await Promise.all([
        authApi.getMe() as Promise<CurrentUser>,
        dashboardApi.getFollowUps() as Promise<FollowUpsResponse>,
        dashboardApi.getPipelineSummary(scope) as Promise<PipelineResponse>,
        dashboardApi.getMentions() as Promise<MentionsResponse>,
      ]);
      setUser(me);
      setFollowUps(fu);
      setPipeline(pipe);
      setMentions(ment.mentions);
    } catch (e) {
      // request() already redirects to /login on 401; anything else is
      // surfaced via toast for visibility.
      toast.error(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ─── Mutators — all bubble back to fetchAll() to keep counts authoritative.

  const handleDone = useCallback(
    async (item: FollowUp) => {
      // Tasks live alongside Leads in the follow-ups list — their lead_id is
      // "task-N". For now only real Leads support /done; task completion will
      // come through a separate endpoint.
      if (typeof item.lead_id !== "number") {
        toast.message("Task completion isn't wired yet — open the contact to log activity.");
        return;
      }
      try {
        await dashboardApi.completeFollowUp(item.lead_id);
        toast.success("Marked done");
        fetchAll();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Mark-done failed");
      }
    },
    [fetchAll]
  );

  const handleSnooze = useCallback(
    async (item: FollowUp, days: number) => {
      if (typeof item.lead_id !== "number") {
        toast.message("Task snooze isn't wired yet.");
        return;
      }
      try {
        await dashboardApi.snoozeFollowUp(item.lead_id, days);
        toast.success(`Snoozed ${days} days`);
        fetchAll();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Snooze failed");
      }
    },
    [fetchAll]
  );

  const handleClose = useCallback(
    async (item: FollowUp) => {
      if (typeof item.lead_id !== "number") {
        toast.message("Task close isn't wired yet.");
        return;
      }
      try {
        await dashboardApi.closeFollowUp(item.lead_id);
        toast.success("Follow-up closed");
        fetchAll();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Close failed");
      }
    },
    [fetchAll]
  );

  const handleDismissMention = useCallback(
    async (commentId: number) => {
      // Optimistic remove for snappy UX; re-fetch confirms.
      setMentions((prev) => prev.filter((m) => m.id !== commentId));
      try {
        await dashboardApi.dismissMention(commentId);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Dismiss failed");
        fetchAll();
      }
    },
    [fetchAll]
  );

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-6 py-6 pb-16">
        <DashboardTopBar
          user={user}
          scope={scope}
          onScopeChange={setScope}
          onRefresh={fetchAll}
          followUps={followUps}
        />

        <PipelineAccordion
          pipeline={pipeline}
          scope={scope}
          userId={user?.id ?? null}
        />

        <WhatsNewSection
          mentions={mentions}
          onDismiss={handleDismissMention}
        />

        <FollowUpsSection
          followUps={followUps}
          onDone={handleDone}
          onSnooze={handleSnooze}
          onClose={handleClose}
        />
      </div>
    </AppShell>
  );
}
