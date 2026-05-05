/**
 * Hard-coded team roster + current-user identity for the social-engagement
 * mockup. Front-end only — replace with real /users API once the social
 * features graduate from mockup to backed feature.
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
  { id: 1, name: "Duck",  initials: "DK", color: "#3b82f6", credits: 1240, starsThisWeek: 18, creditsThisWeek: 145 },
  { id: 2, name: "Steve", initials: "ST", color: "#10b981", credits: 980,  starsThisWeek: 12, creditsThisWeek: 95  },
  { id: 3, name: "David", initials: "DV", color: "#f59e0b", credits: 1560, starsThisWeek: 22, creditsThisWeek: 180 },
  { id: 4, name: "Amy",   initials: "AM", color: "#ef4444", credits: 720,  starsThisWeek: 9,  creditsThisWeek: 60  },
  { id: 5, name: "Alex",  initials: "AX", color: "#8b5cf6", credits: 1100, starsThisWeek: 15, creditsThisWeek: 120 },
];

/** "Self" identity used to choose between teammate vs own UI. */
export const CURRENT_USER_ID = 3;

export function findTeamMember(id: number): TeamMember | undefined {
  return TEAM_MEMBERS.find((m) => m.id === id);
}

/** Display label "David, Steve, Amy" used by star-rating tooltips etc. */
export function namesFromIds(ids: number[]): string {
  return ids
    .map((id) => findTeamMember(id)?.name)
    .filter((n): n is string => Boolean(n))
    .join(", ");
}
