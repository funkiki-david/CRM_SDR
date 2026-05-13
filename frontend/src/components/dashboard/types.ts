/**
 * Shared TypeScript types for the Dashboard V1 components.
 *
 * Mirrors the response shapes of /api/dashboard/* — keep in sync if you
 * touch backend/app/api/routes/dashboard.py.
 */

export type Scope = "mine" | "team";

export type LeadStatusKey =
  | "new"
  | "contacted"
  | "interested"
  | "meeting_set"
  | "proposal"
  | "closed_won"
  | "closed_lost"
  | "task";

export type Urgency = "overdue" | "today" | "upcoming";

/** Time bucket — the 4 dashboard sections. */
export type TimeBucketKey = "overdue" | "today" | "this_week" | "later";

export interface FollowUp {
  /** Real Lead id is a number; Task-derived rows arrive as "task-N". */
  lead_id: number | string;
  task_id?: number;
  contact_id: number | null;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  company: string | null;
  title: string | null;
  urgency: Urgency;
  lead_status: LeadStatusKey;
  follow_up_date: string | null;
  follow_up_reason: string | null;
  last_activity_date: string | null;
  last_activity_type: string | null;
  last_activity_summary: string | null;
  last_activity_content: string | null;
  days_since_last_contact: number | null;
  owner_name: string | null;
  source?: string;
}

export interface FollowUpsResponse {
  follow_ups: FollowUp[];
  grouped: {
    overdue: FollowUp[];
    today: FollowUp[];
    upcoming: FollowUp[];
  };
  counts: { overdue: number; today: number; upcoming: number };
  total: number;
}

export interface PipelineResponse {
  scope: Scope;
  pipeline: Record<LeadStatusKey, number>;
}

export interface Mention {
  id: number;
  comment_text: string;
  author: { id: number | null; name: string | null };
  activity_id: number;
  activity_type: string | null;
  contact_id: number | null;
  contact_name: string | null;
  created_at: string;
}

export interface MentionsResponse {
  mentions: Mention[];
  unread_count: number;
}

export interface CurrentUser {
  id: number;
  email: string;
  full_name: string;
  role: "admin" | "manager" | "sdr";
}
