/**
 * Mock state for the social-engagement mockup. Pure front-end fixtures —
 * none of these values touch the backend. State is held in component
 * `useState` and resets on page refresh.
 */

export type ReactionEmoji = "🔥" | "👊" | "⭐" | "💪" | "🎯";

export const REACTION_EMOJIS: ReactionEmoji[] = ["🔥", "👊", "⭐", "💪", "🎯"];

// === Team Feed (Dashboard) =================================================

export interface FeedEvent {
  id: number;
  userId: number;
  verb: string;
  target: string;
  timeAgo: string;
  /** emoji → count of teammates who reacted with it */
  reactions: Record<ReactionEmoji, number>;
}

export const MOCK_FEED_EVENTS: FeedEvent[] = [
  { id: 1, userId: 2, verb: "logged a call with",          target: "Mitch Doyle (Patagonia)",       timeAgo: "3m ago",  reactions: { "🔥": 2, "👊": 1, "⭐": 0, "💪": 0, "🎯": 0 } },
  { id: 2, userId: 4, verb: "closed",                      target: "PO #4521 — Nordica",            timeAgo: "12m ago", reactions: { "🔥": 4, "👊": 3, "⭐": 2, "💪": 1, "🎯": 0 } },
  { id: 3, userId: 1, verb: "sent samples to",             target: "Burton Snowboards",             timeAgo: "28m ago", reactions: { "🔥": 1, "👊": 0, "⭐": 1, "💪": 0, "🎯": 0 } },
  { id: 4, userId: 5, verb: "moved to Verbal Order",       target: "K2 Sports",                     timeAgo: "1h ago",  reactions: { "🔥": 3, "👊": 2, "⭐": 0, "💪": 0, "🎯": 1 } },
  { id: 5, userId: 2, verb: "added 12 new contacts from",  target: "ISPO Munich list",              timeAgo: "2h ago",  reactions: { "🔥": 0, "👊": 1, "⭐": 0, "💪": 0, "🎯": 0 } },
  { id: 6, userId: 3, verb: "logged a meeting with",       target: "Salomon team",                  timeAgo: "3h ago",  reactions: { "🔥": 2, "👊": 0, "⭐": 1, "💪": 0, "🎯": 0 } },
  { id: 7, userId: 4, verb: "advanced",                    target: "Rossignol → Price negotiation", timeAgo: "4h ago",  reactions: { "🔥": 1, "👊": 1, "⭐": 0, "💪": 0, "🎯": 0 } },
  { id: 8, userId: 6, verb: "received PO from",            target: "Atomic Skis",                   timeAgo: "5h ago",  reactions: { "🔥": 5, "👊": 4, "⭐": 3, "💪": 2, "🎯": 1 } },
];

// === Activity social state (Contact timeline) =============================

export interface ActivityComment {
  id: number;
  userId: number;
  text: string;
  timeAgo: string;
  /** emoji → list of teammate userIds who reacted */
  reactions: Record<ReactionEmoji, number[]>;
}

export interface ActivitySocial {
  /** userIds who starred this activity */
  stars: number[];
  /** emoji → list of teammate userIds */
  reactions: Record<ReactionEmoji, number[]>;
  comments: ActivityComment[];
}

/**
 * `null` for any activityId means the spec hasn't seeded social state for
 * that row — components will treat it as an empty social bucket.
 */
export const MOCK_ACTIVITY_SOCIAL: Record<number, ActivitySocial> = {};

/**
 * Standalone mock activities used when a contact's real activity list
 * comes back empty — gives the social UI something to render in demo mode.
 */
export interface MockActivity {
  id: number;
  activity_type: "call" | "email" | "meeting" | "note" | "linkedin";
  created_at: string;
  user_name: string;
  subject: string;
  content: string;
}

export const MOCK_TIMELINE_ACTIVITIES: MockActivity[] = [
  {
    id: -1001,
    activity_type: "call",
    created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    user_name: "Steve",
    subject: "Quarterly check-in call",
    content: "Walked through Q3 numbers; they're 18% above target. Happy to keep current cadence.",
  },
  {
    id: -1002,
    activity_type: "email",
    created_at: new Date(Date.now() - 26 * 3600_000).toISOString(),
    user_name: "David Admin",
    subject: "Re: Bulk order pricing tier",
    content: "Sent the revised tier sheet — they hinted at 1500-unit volume next quarter.",
  },
  {
    id: -1003,
    activity_type: "meeting",
    created_at: new Date(Date.now() - 3 * 24 * 3600_000).toISOString(),
    user_name: "Doug",
    subject: "Onsite at their warehouse",
    content: "Walked through their racking. They want our stickers preprinted with SKUs.",
  },
  {
    id: -1004,
    activity_type: "note",
    created_at: new Date(Date.now() - 5 * 24 * 3600_000).toISOString(),
    user_name: "Amie",
    subject: "Decision-maker note",
    content: "Their CFO is the actual budget owner — Mitch only signs off after she greenlights.",
  },
  {
    id: -1005,
    activity_type: "linkedin",
    created_at: new Date(Date.now() - 7 * 24 * 3600_000).toISOString(),
    user_name: "Alex Amie",
    subject: "InMail reply",
    content: "Connected after my second InMail. Mentioned they're evaluating two competitors right now.",
  },
];

/** Pre-seed social state for the demo activities so the UI looks lived-in. */
MOCK_ACTIVITY_SOCIAL[-1001] = {
  stars: [1, 3, 4],
  reactions: { "🔥": [1, 2], "👊": [3], "⭐": [], "💪": [], "🎯": [] },
  comments: [
    {
      id: 9001,
      userId: 2,
      text: "Nice follow-up! Want me to ping their procurement?",
      timeAgo: "2h ago",
      reactions: { "🔥": [3], "👊": [], "⭐": [], "💪": [], "🎯": [] },
    },
    {
      id: 9002,
      userId: 4,
      text: "They mentioned budget concerns last quarter — worth checking.",
      timeAgo: "1h ago",
      reactions: { "🔥": [], "👊": [3], "⭐": [], "💪": [], "🎯": [] },
    },
  ],
};

MOCK_ACTIVITY_SOCIAL[-1002] = {
  stars: [1, 2],
  reactions: { "🔥": [4], "👊": [1, 5], "⭐": [], "💪": [], "🎯": [] },
  comments: [
    {
      id: 9010,
      userId: 5,
      text: "Big number — let's prep a volume-discount sheet just in case.",
      timeAgo: "20h ago",
      reactions: { "🔥": [3], "👊": [], "⭐": [], "💪": [], "🎯": [] },
    },
  ],
};

MOCK_ACTIVITY_SOCIAL[-1003] = {
  stars: [3],
  reactions: { "🔥": [3], "👊": [], "⭐": [], "💪": [2], "🎯": [] },
  comments: [],
};

MOCK_ACTIVITY_SOCIAL[-1004] = {
  stars: [1, 3, 5],
  reactions: { "🔥": [], "👊": [1, 3], "⭐": [5], "💪": [], "🎯": [3] },
  comments: [
    {
      id: 9020,
      userId: 1,
      text: "Massive callout. Looping the CFO into next email.",
      timeAgo: "4d ago",
      reactions: { "🔥": [3, 4], "👊": [], "⭐": [], "💪": [], "🎯": [] },
    },
  ],
};

MOCK_ACTIVITY_SOCIAL[-1005] = {
  stars: [],
  reactions: { "🔥": [2], "👊": [], "⭐": [], "💪": [], "🎯": [] },
  comments: [],
};

// === Team Notes (Contact detail) =========================================

export interface TeamNote {
  id: number;
  userId: number;
  text: string;
  /** Display string. "Just now" for freshly added notes. */
  createdAt: string;
  reactions: Record<ReactionEmoji, number[]>;
}

/** contactId → notes[]. Components fall back to a generic seed when no entry. */
export const MOCK_TEAM_NOTES: Record<number, TeamNote[]> = {};

/** Generic seed used when the contact has no specific notes mocked. */
export const DEFAULT_TEAM_NOTES_SEED: TeamNote[] = [
  {
    id: 7001,
    userId: 2,
    text: "Prefers email over calls. Don't push for phone unless it's urgent.",
    createdAt: "3 days ago",
    reactions: { "🔥": [3], "👊": [1, 4], "⭐": [], "💪": [], "🎯": [] },
  },
  {
    id: 7002,
    userId: 1,
    text: "His daughter just got into UBC — small talk gold for the next call.",
    createdAt: "1 week ago",
    reactions: { "🔥": [3, 5], "👊": [], "⭐": [2], "💪": [], "🎯": [] },
  },
  {
    id: 7003,
    userId: 4,
    text: "Their CFO is the real decision-maker, not Mitch. Loop her in by week 6.",
    createdAt: "2 weeks ago",
    reactions: { "🔥": [1, 3, 5], "👊": [2], "⭐": [], "💪": [], "🎯": [] },
  },
];

// === Credits ledger (Dashboard credits chip) =============================

export interface CreditEntry {
  id: number;
  amount: number;
  reason: string;
  timeAgo: string;
}

export const MOCK_CREDIT_LEDGER: CreditEntry[] = [
  { id: 1, amount: 50,  reason: 'David Marketing sent you "Great call!"',  timeAgo: "2h ago"  },
  { id: 2, amount: 25,  reason: "Doug starred your follow-up",             timeAgo: "4h ago"  },
  { id: 3, amount: 10,  reason: "Steve 🔥 your timeline comment",          timeAgo: "1d ago"  },
  { id: 4, amount: -30, reason: 'You sent Steve "Closer king"',            timeAgo: "1d ago"  },
  { id: 5, amount: 50,  reason: "Daily login bonus",                       timeAgo: "2d ago"  },
];

/** Today-wide team activity counter shown in the weekly stats chip. */
export const MOCK_TEAM_REACTIONS_TODAY = 76;
