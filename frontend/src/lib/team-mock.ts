/**
 * Hard-coded team roster + current-user identity for the social-engagement
 * mockup. Front-end only — replace with real /users API once the social
 * features graduate from mockup to backed feature.
 *
 * Roster mirrors backend seed_users in app/core/init_db.py + the legacy
 * sales@graphictacfilm.com row in the live DB. Keep these aligned manually
 * until the social features go live against the real /users endpoint.
 */

export interface TeamMember {
  id: number;
  name: string;
  initials: string;
  /** Tailwind-compatible hex used as the avatar background. */
  color: string;
  /** Virtual credit balance. */
  credits: number;
  /** Stars received this week (for the leaderboard / weekly chip). */
  starsThisWeek: number;
  /** Net credits earned this week (for the leaderboard column). */
  creditsThisWeek: number;
}

export const TEAM_MEMBERS: TeamMember[] = [
  { id: 1, name: "David Admin",     initials: "DA", color: "#f59e0b", credits: 1560, starsThisWeek: 22, creditsThisWeek: 180 },
  { id: 2, name: "David Marketing", initials: "DM", color: "#3b82f6", credits: 1240, starsThisWeek: 18, creditsThisWeek: 145 },
  { id: 3, name: "Doug",            initials: "DG", color: "#10b981", credits: 1100, starsThisWeek: 15, creditsThisWeek: 120 },
  { id: 4, name: "Steve",           initials: "ST", color: "#8b5cf6", credits: 980,  starsThisWeek: 12, creditsThisWeek: 95  },
  { id: 5, name: "Amie",            initials: "AM", color: "#ef4444", credits: 720,  starsThisWeek: 9,  creditsThisWeek: 60  },
  { id: 6, name: "Alex Amie",       initials: "AA", color: "#0ea5e9", credits: 540,  starsThisWeek: 6,  creditsThisWeek: 40  },
];

/** "Self" identity used to choose between teammate vs own UI. David Admin = id 1. */
export const CURRENT_USER_ID = 1;

export function findTeamMember(id: number): TeamMember | undefined {
  return TEAM_MEMBERS.find((m) => m.id === id);
}

/** Display label "David Admin, Doug, Amie" used by star-rating tooltips etc. */
export function namesFromIds(ids: number[]): string {
  return ids
    .map((id) => findTeamMember(id)?.name)
    .filter((n): n is string => Boolean(n))
    .join(", ");
}
