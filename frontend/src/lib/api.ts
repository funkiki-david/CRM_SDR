/**
 * API 客户端 — 前端调后端的统一入口
 * 所有和后端的通信都通过这个文件
 */

// 后端地址（Docker 环境下由环境变量提供，本地开发默认 localhost:8000）
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * 通用请求函数 — 自动附带 token 和错误处理
 */
async function request(path: string, options: RequestInit = {}) {
  // 从浏览器本地存储获取 token（登录后存的）
  const token = typeof window !== "undefined"
    ? localStorage.getItem("token")
    : null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  // 如果有 token，加到请求头里
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // 如果 token 过期（401），清所有保存的信息 + 跳转到登录页
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
 * 认证相关 API
 */
export const authApi = {
  /** 登录 — 返回 token. remember_me=true 时 token 有效期 30 天（默认 8 小时）*/
  login: (email: string, password: string, rememberMe = false) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, remember_me: rememberMe }),
    }),

  /** Get current user info */
  getMe: () => request("/api/auth/me"),

  /** Start Google OAuth —— 返回 auth URL, 前端 window.location 跳过去 */
  googleOAuthStart: () => request("/api/auth/google/start") as Promise<{ auth_url: string }>,
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
  /** List contacts with optional search */
  list: (search?: string, skip = 0, limit = 50) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    params.set("skip", String(skip));
    params.set("limit", String(limit));
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
   * 批量导入 CSV。file 是 File 对象（来自 input[type=file] 或 drag-drop）。
   * 返回 {created, updated, skipped, failed, errors}。
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
   * 触发浏览器下载：导出当前用户可见的联系人为 CSV
   * 角色权限在后端执行（SDR 只导自己）
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

  /** 下载空白 CSV 模板 */
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
};

/**
 * Email Templates API
 */
export const templatesApi = {
  list: () => request("/api/templates"),

  create: (data: { name: string; subject: string; body: string }) =>
    request("/api/templates", { method: "POST", body: JSON.stringify(data) }),

  update: (id: number, data: Record<string, unknown>) =>
    request(`/api/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  delete: (id: number) =>
    request(`/api/templates/${id}`, { method: "DELETE" }),
};

/**
 * Emails API
 */
export const emailsApi = {
  /** List connected email accounts */
  listAccounts: () => request("/api/emails/accounts"),

  /** Add an email account */
  addAccount: (data: {
    email_address: string;
    display_name?: string;
    provider_type?: "gmail_oauth" | "outlook_oauth" | "smtp";
    smtp_host?: string;
    smtp_port?: number;
    imap_host?: string;
    imap_port?: number;
    smtp_username?: string;
    smtp_password?: string;
    smtp_encryption?: "ssl" | "starttls" | "none";
  }) =>
    request("/api/emails/accounts", { method: "POST", body: JSON.stringify(data) }),

  /** Remove an email account */
  removeAccount: (id: number) =>
    request(`/api/emails/accounts/${id}`, { method: "DELETE" }),

  // Users API 在下面单独导出 usersApi，这里顺手不碰

  /** 测试 SMTP 凭据（保存前验证）*/
  testSmtp: (data: {
    smtp_host: string;
    smtp_port: number;
    smtp_username: string;
    smtp_password: string;
    smtp_encryption: string;
  }) =>
    request("/api/emails/accounts/test-smtp", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** Preview a template with contact data filled in */
  preview: (contactId: number, templateId: number) =>
    request("/api/emails/preview", {
      method: "POST",
      body: JSON.stringify({ contact_id: contactId, template_id: templateId }),
    }),

  /** Send an email */
  send: (data: Record<string, unknown>) =>
    request("/api/emails/send", { method: "POST", body: JSON.stringify(data) }),

  /** List sent emails */
  listSent: (contactId?: number) => {
    const params = new URLSearchParams();
    if (contactId) params.set("contact_id", String(contactId));
    return request(`/api/emails/sent?${params}`);
  },
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
