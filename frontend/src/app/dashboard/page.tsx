/**
 * Dashboard — The first thing an SDR sees when they log in
 * Top section: Today's follow-up action list (sorted by urgency)
 * Bottom section: Team activity feed (social-media style timeline)
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import AddContact from "@/components/add-contact";
import QuickEntry from "@/components/quick-entry";
import EmailCompose from "@/components/email-compose";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { dashboardApi, activitiesApi } from "@/lib/api";

// === Type definitions ===

interface FollowUp {
  lead_id: number;
  contact_id: number;
  contact_name: string;
  company: string | null;
  title: string | null;
  lead_status: string;
  follow_up_date: string;
  follow_up_reason: string | null;
  urgency: "overdue" | "today" | "upcoming";
  last_activity_date: string | null;
  last_activity_type: string | null;
  last_activity_summary: string | null;
  owner_name: string;
}

interface ActivityItem {
  id: number;
  activity_type: string;
  subject: string | null;
  content: string | null;
  contact_id: number;
  contact_name: string | null;
  user_name: string | null;
  created_at: string;
}

// === Display helpers ===

const urgencyStyles: Record<string, string> = {
  overdue: "bg-red-50 text-red-700 border-red-200",
  today: "bg-amber-50 text-amber-700 border-amber-200",
  upcoming: "bg-blue-50 text-blue-700 border-blue-200",
};

const urgencyLabels: Record<string, string> = {
  overdue: "Overdue",
  today: "Due Today",
  upcoming: "This Week",
};

const activityIcons: Record<string, string> = {
  call: "\u260E",       // phone
  email: "\u2709",      // envelope
  linkedin: "\uD83D\uDD17", // link
  meeting: "\uD83D\uDCC5",  // calendar
  note: "\uD83D\uDCDD",     // memo
};

const activityVerbs: Record<string, string> = {
  call: "had a call with",
  email: "sent an email to",
  linkedin: "messaged",
  meeting: "had a meeting with",
  note: "added a note for",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DashboardPage() {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [feed, setFeed] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [pipeline, setPipeline] = useState<Record<string, number>>({});

  // Quick action dialogs
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [emailComposeOpen, setEmailComposeOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      dashboardApi.getFollowUps().catch(() => ({ follow_ups: [] })),
      activitiesApi.feed().catch(() => []),
      dashboardApi.getPipelineSummary().catch(() => ({})),
    ]).then(([fuData, feedData, pipeData]) => {
      setFollowUps(fuData.follow_ups || []);
      setFeed(feedData || []);
      setPipeline(pipeData || {});
      setLoading(false);
    });
  }, []);

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-8">
        {/* === Quick Action Buttons === */}
        <section>
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => setAddContactOpen(true)}
              className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-left"
            >
              <span className="text-xl">+</span>
              <span className="text-sm font-medium text-gray-700">New Contact</span>
            </button>
            <button
              onClick={() => setQuickEntryOpen(true)}
              className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-left"
            >
              <span className="text-xl">&#9998;</span>
              <span className="text-sm font-medium text-gray-700">Log Activity</span>
            </button>
            <button
              onClick={() => setEmailComposeOpen(true)}
              className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-left"
            >
              <span className="text-xl">&#9993;</span>
              <span className="text-sm font-medium text-gray-700">Send Email</span>
            </button>
          </div>
        </section>

        {/* === Today's Follow-up Action List === */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Today&apos;s Follow-ups
          </h2>

          {loading ? (
            <p className="text-gray-400 text-sm">Loading...</p>
          ) : followUps.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-gray-400">
                No follow-ups scheduled. Add contacts and set follow-up dates to see them here.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {followUps.map((item) => (
                <Link
                  key={item.lead_id}
                  href={`/contacts?id=${item.contact_id}`}
                  className="block"
                >
                  <Card className={`border ${urgencyStyles[item.urgency]} hover:shadow-sm transition-shadow cursor-pointer`}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">
                              {item.contact_name}
                            </span>
                            {item.company && (
                              <span className="text-sm text-gray-500">
                                at {item.company}
                              </span>
                            )}
                          </div>
                          {/* Last activity summary */}
                          {item.last_activity_summary && (
                            <p className="text-sm text-gray-500 mt-0.5 truncate">
                              Last: {item.last_activity_summary}
                            </p>
                          )}
                          {/* Follow-up reason = suggested next action */}
                          {item.follow_up_reason && (
                            <p className="text-sm text-gray-600 mt-0.5">
                              &rarr; {item.follow_up_reason}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 ml-4 shrink-0">
                          <Badge
                            variant="outline"
                            className={`text-xs ${urgencyStyles[item.urgency]}`}
                          >
                            {urgencyLabels[item.urgency]}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* === Team Activity Feed === */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Activity Feed
          </h2>

          {loading ? (
            <p className="text-gray-400 text-sm">Loading...</p>
          ) : feed.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-gray-400">
                No activities yet. Start logging calls, emails, and meetings to see them here.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-1">
              {feed.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 py-2.5 px-3 rounded-md hover:bg-gray-50 transition-colors"
                >
                  {/* Activity type icon */}
                  <span className="text-lg mt-0.5 w-6 text-center shrink-0">
                    {activityIcons[item.activity_type] || "\uD83D\uDCCB"}
                  </span>

                  {/* Activity description */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">{item.user_name}</span>{" "}
                      {activityVerbs[item.activity_type] || "interacted with"}{" "}
                      <Link
                        href={`/contacts?id=${item.contact_id}`}
                        className="font-medium text-gray-900 hover:underline"
                      >
                        {item.contact_name}
                      </Link>
                    </p>
                    {item.subject && (
                      <p className="text-sm text-gray-500 truncate mt-0.5">
                        {item.subject}
                      </p>
                    )}
                  </div>

                  {/* Timestamp */}
                  <span className="text-xs text-gray-400 shrink-0 mt-0.5">
                    {timeAgo(item.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* === Pipeline Overview === */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Pipeline
          </h2>
          <div className="flex items-center gap-1 overflow-x-auto">
            {[
              { key: "new", label: "New", color: "bg-gray-100 text-gray-700" },
              { key: "contacted", label: "Contacted", color: "bg-blue-50 text-blue-700" },
              { key: "interested", label: "Interested", color: "bg-cyan-50 text-cyan-700" },
              { key: "meeting_set", label: "Meeting", color: "bg-violet-50 text-violet-700" },
              { key: "proposal", label: "Proposal", color: "bg-amber-50 text-amber-700" },
              { key: "closed_won", label: "Won", color: "bg-green-50 text-green-700" },
              { key: "closed_lost", label: "Lost", color: "bg-red-50 text-red-500" },
            ].map((stage, i, arr) => (
              <div key={stage.key} className="flex items-center">
                <div className={`px-4 py-2.5 rounded-md text-center min-w-[80px] ${stage.color}`}>
                  <p className="text-lg font-semibold">{pipeline[stage.key] || 0}</p>
                  <p className="text-xs">{stage.label}</p>
                </div>
                {i < arr.length - 1 && (
                  <span className="text-gray-300 mx-1">&rarr;</span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Quick action dialogs */}
      <AddContact
        open={addContactOpen}
        onClose={() => setAddContactOpen(false)}
        onSuccess={() => { setAddContactOpen(false); window.location.reload(); }}
      />
      <QuickEntry
        open={quickEntryOpen}
        onClose={() => setQuickEntryOpen(false)}
        onSuccess={() => { setQuickEntryOpen(false); window.location.reload(); }}
      />
      <EmailCompose
        open={emailComposeOpen}
        onClose={() => setEmailComposeOpen(false)}
        contactId={0}
        contactName=""
        contactEmail={null}
        onSuccess={() => setEmailComposeOpen(false)}
      />
    </AppShell>
  );
}
