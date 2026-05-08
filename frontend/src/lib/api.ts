/**
 * API client — single entry point for every backend call from the frontend.
 */

// Backend base URL. In Docker / Railway it is set via NEXT_PUBLIC_API_URL;
// falls back to localhost for local dev.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Shared fetch wrapper — attaches the bearer token and surfaces server errors
 * through a thrown Error whose message is the backend's `detail` field.
 */
async function request(path: string, options: RequestInit = {}) {
  const token = typeof window !== "undefined"
    ? localStorage.getItem("token")
    : null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // 401 → token expired or invalid. Wipe local auth and bounce to /login.
  if (response.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("token");
    localStorage.removeItem("sdr_crm_remembered_email");
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(error.detail || "Request failed");
  }

  return response.json();
}

/**
 * Auth API
 */
export const authApi = {
  /** Login — returns a JWT. remember_me=true issues a 30-day token instead of the default 8-hour one. */
  login: (email: string, password: string, rememberMe = false) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, remember_me: rememberMe }),
    }),

  /** Get current user info */
  getMe: () => request("/api/auth/me"),
};

/**
 * Dashboard API
 */
export const dashboardApi = {
  /** Get today's follow-up action list (includes grouped + counts) */
  getFollowUps: () => request("/api/dashboard/follow-ups"),

  /** Snooze a follow-up N days */
  snoozeFollowUp: (leadId: number, days: number) =>
    request(`/api/dashboard/follow-ups/${leadId}/snooze`, {
      method: "PATCH",
      body: JSON.stringify({ days }),
    }),

  /** Reschedule follow-up to specific date */
  rescheduleFollowUp: (leadId: number, nextFollowUp: string, reason?: string) =>
    request(`/api/dashboard/follow-ups/${leadId}/reschedule`, {
      method: "PATCH",
      body: JSON.stringify({ next_follow_up: nextFollowUp, follow_up_reason: reason }),
    }),

  /** Mark follow-up done (clear next_follow_up) */
  completeFollowUp: (leadId: number) =>
    request(`/api/dashboard/follow-ups/${leadId}/done`, { method: "PATCH" }),

  /** Quick stats for top row */
  getQuickStats: () => request("/api/dashboard/quick-stats"),

  /** Get pipeline stage counts */
  getPipelineSummary: () => request("/api/dashboard/pipeline-summary"),
};

/**
 * Contacts API
 */
export const contactsApi = {
  /** List contacts with optional search.
   *  By default archived contacts (is_active=false) are hidden;
   *  pass includeArchived=true to surface them.
   */
  list: (search?: string, skip = 0, limit = 50, includeArchived = false) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    params.set("skip", String(skip));
    params.set("limit", String(limit));
    if (includeArchived) params.set("include_archived", "true");
    return request(`/api/contacts?${params}`);
  },

  /** Get single contact detail */
  get: (id: number) => request(`/api/contacts/${id}`),

  /** Create a new contact */
  create: (data: Record<string, unknown>, forceCreate = false) =>
    request(`/api/contacts?force_create=${forceCreate}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** Update a contact (partial) */
  update: (id: number, data: Record<string, unknown>) =>
    request(`/api/contacts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  /** Update a contact (full replace — used by dedup "Update existing" flow) */
  updateFull: (id: number, data: Record<string, unknown>) =>
    request(`/api/contacts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  /** Check if an email already exists (dedup) */
  checkEmail: (email: string) =>
    request(`/api/contacts/check-email?email=${encodeURIComponent(email)}`),

  /** Apollo People Match — enrich empty fields on a contact */
  enrich: (contactId: number) =>
    request(`/api/contacts/${contactId}/enrich`, { method: "POST" }),

  /** Enrichment budget status (today / 15-day rolling) */
  enrichStatus: () => request(`/api/contacts/enrich/status`),

  /**
   * Bulk-import contacts from a CSV File (input[type=file] or drag-drop).
   * Returns {created, updated, skipped, failed, errors}.
   */
  importCsv: async (file: File, updateExisting = false) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const form = new FormData();
    form.append("file", file);
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const res = await fetch(
      `${API_BASE}/api/contacts/import?update_existing=${updateExisting}`,
      {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Import failed" }));
      throw new Error(err.detail || "Import failed");
    }
    return res.json();
  },

  /**
   * Trigger a browser download of the current user's visible contacts as CSV.
   * Role-based filtering is enforced on the backend (SDR exports own only).
   */
  exportCsv: async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const res = await fetch(`${API_BASE}/api/contacts/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /** Download a blank CSV template */
  downloadTemplate: async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const res = await fetch(`${API_BASE}/api/contacts/template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Template download failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contacts_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

/**
 * Activities API
 */
export const activitiesApi = {
  /** Create a new activity */
  create: (data: Record<string, unknown>) =>
    request("/api/activities", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** Get activities for a specific contact */
  listByContact: (contactId: number) =>
    request(`/api/activities/contact/${contactId}`),

  /** Get team activity feed (legacy — returns array) */
  feed: (limit = 30) => request(`/api/activities/feed?limit=${limit}`),

  /** Paginated / filtered feed — returns {items, total, has_more} */
  feedPaged: (queryString: string) => request(`/api/activities/feed?${queryString}`),

  /** Edit an activity (owners + Admin) */
  update: (id: number, data: Record<string, unknown>) =>
    request(`/api/activities/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  /** Delete an activity (owners + Admin) */
  delete: (id: number) =>
    request(`/api/activities/${id}`, { method: "DELETE" }),
};

// === Activity Comments — real-functionalized 2026-05-06 ===
// Stars (⭐⭐⭐⭐⭐) and 5-emoji reactions (🔥 👊 ⭐ 💪 🎯) remain frontend
// mockup; only comments are backed by real DB rows + APIs.

export interface ServerActivityComment {
  id: number;
  activity_id: number;
  user_id: number | null;
  user_name: string | null;
  text: string;
  created_at: string;
  updated_at: string;
}

export const activityCommentsApi = {
  /** List comments for an activity, oldest first */
  list: (activityId: number) =>
    request(`/api/activities/${activityId}/comments`) as Promise<ServerActivityComment[]>,

  /** Post a new comment as the current user */
  create: (activityId: number, text: string) =>
    request(`/api/activities/${activityId}/comments`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }) as Promise<ServerActivityComment>,

  /** Edit your own comment (preserves previous_text on the server for audit) */
  update: (commentId: number, text: string) =>
    request(`/api/activities/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ text }),
    }) as Promise<ServerActivityComment>,

  /** Delete a comment (author or admin only) */
  remove: (commentId: number) =>
    request(`/api/activities/comments/${commentId}`, { method: "DELETE" }),
};

/** Tasks API — to-dos created by Create Task on AI Suggested To-Do */
export const tasksApi = {
  create: (data: {
    contact_id?: number;
    task_type?: "call" | "email" | "meeting" | "follow_up";
    description: string;
    source?: string;
  }) => request("/api/tasks", { method: "POST", body: JSON.stringify(data) }),

  list: (statusFilter?: "pending" | "done") =>
    request(`/api/tasks${statusFilter ? `?status=${statusFilter}` : ""}`),

  update: (id: number, data: Record<string, unknown>) =>
    request(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  delete: (id: number) =>
    request(`/api/tasks/${id}`, { method: "DELETE" }),

  /**
   * Snooze an AI suggestion. New (preferred) shape uses rule_id+contact_id;
   * the old (title, action, days) signature still works server-side for
   * backwards compat but is ignored by the engine's hash filter.
   */
  snoozeSuggestion: (
    arg: { rule_id: string; contact_id: number | null; days: number } | string,
    legacyAction?: string,
    legacyDays?: number,
  ) => {
    if (typeof arg === "string") {
      // Legacy call site: snoozeSuggestion(title, action, days)
      return request("/api/tasks/snooze-suggestion", {
        method: "POST",
        body: JSON.stringify({ title: arg, action: legacyAction, days: legacyDays }),
      });
    }
    return request("/api/tasks/snooze-suggestion", {
      method: "POST",
      body: JSON.stringify(arg),
    });
  },

  /** GET active suggestion snoozes for current user (returns {hashes: string[]}) */
  snoozeSuggestionList: () =>
    request("/api/tasks/snooze-suggestion?active=true"),
};

/**
 * Apollo API
 */
export const apolloApi = {
  /** Check if Apollo API key is configured */
  status: () => request("/api/apollo/status"),

  /** Search for people by ICP criteria */
  search: (filters: Record<string, unknown>) =>
    request("/api/apollo/search", { method: "POST", body: JSON.stringify(filters) }),

  /** Enrich selected people — costs Apollo credits */
  enrich: (apolloIds: string[]) =>
    request("/api/apollo/enrich", { method: "POST", body: JSON.stringify({ apollo_ids: apolloIds }) }),

  /** Import enriched people into CRM */
  import: (people: Record<string, unknown>[]) =>
    request("/api/apollo/import", { method: "POST", body: JSON.stringify({ people }) }),
};

/**
 * System Settings API
 */
export const settingsApi = {
  /** Update Apollo API key */
  setApolloKey: (key: string) =>
    request("/api/settings/apollo-key", { method: "POST", body: JSON.stringify({ key }) }),

  /** Check Apollo key status */
  apolloKeyStatus: () => request("/api/settings/apollo-key/status"),

  /** Anthropic key (single AI provider — powers all AI features) */
  setAnthropicKey: (key: string) =>
    request("/api/settings/anthropic-key", { method: "POST", body: JSON.stringify({ key }) }),
  anthropicKeyStatus: () => request("/api/settings/anthropic-key/status"),
};

/**
 * Users / Team Members API
 */
export const usersApi = {
  list: () => request("/api/users"),

  create: (data: {
    email: string;
    password: string;
    full_name: string;
    role: "admin" | "manager" | "sdr";
    manager_id?: number;
  }) => request("/api/users", { method: "POST", body: JSON.stringify(data) }),

  edit: (id: number, data: {
    full_name?: string;
    role?: "admin" | "manager" | "sdr";
    manager_id?: number;
    password?: string;
  }) => request(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  deactivate: (id: number) =>
    request(`/api/users/${id}/deactivate`, { method: "PATCH" }),

  activate: (id: number) =>
    request(`/api/users/${id}/activate`, { method: "PATCH" }),
};

/**
 * AI API
 */
export const aiApi = {
  /** Check AI service status */
  status: () => request("/api/ai/status"),

  /** Generate person research report — honors 30d cache unless forceRefresh=true */
  personReport: (contactId: number, forceRefresh = false) =>
    request("/api/ai/report/person", {
      method: "POST",
      body: JSON.stringify({ contact_id: contactId, force_refresh: forceRefresh }),
    }),

  /** Generate company research report — honors 30d cache unless forceRefresh=true */
  companyReport: (contactId: number, forceRefresh = false) =>
    request("/api/ai/report/company", {
      method: "POST",
      body: JSON.stringify({ contact_id: contactId, force_refresh: forceRefresh }),
    }),

  /** Delete a person research report (clears the field on the contact row) */
  deletePersonReport: (contactId: number) =>
    request(`/api/ai/report/${contactId}/person`, { method: "DELETE" }),

  /** Delete a company research report (clears the field on the contact row) */
  deleteCompanyReport: (contactId: number) =>
    request(`/api/ai/report/${contactId}/company`, { method: "DELETE" }),

  /** AI draft email — optional email_account_id shapes signature */
  draftEmail: (contactId: number, emailAccountId?: number) =>
    request("/api/ai/draft-email", {
      method: "POST",
      body: JSON.stringify({
        contact_id: contactId,
        email_account_id: emailAccountId,
      }),
    }),

  /** Smart search (Claude reads activities directly) */
  search: (query: string, limit = 10) =>
    request("/api/ai/search", { method: "POST", body: JSON.stringify({ query, limit }) }),

  /**
   * AI Suggested To-Do — analyzes last 30d activity, returns 3 suggestions.
   * force=true bypasses the 2-hour cache and regenerates.
   */
  suggestTodos: (force = false) =>
    request(`/api/ai/suggest-todos${force ? "?force=true" : ""}`),

  /**
   * AI Keyword Finder — from a free-text description, returns
   * { industries: string[], keywords: string[] } for Apollo search.
   */
  suggestKeywords: (input: string) =>
    request("/api/ai/suggest-keywords", {
      method: "POST",
      body: JSON.stringify({ input }),
    }),

  /** Current user's today AI spend + remaining limit */
  getUsage: () => request("/api/ai/usage"),

  /** Admin: all users' today spend */
  getAllUsage: () => request("/api/ai/usage/all"),

  /** Admin: update per-user daily limit (USD) */
  updateLimit: (dailyLimitUsd: number) =>
    request("/api/ai/limits", {
      method: "PATCH",
      body: JSON.stringify({ daily_limit_usd: dailyLimitUsd }),
    }),
};
