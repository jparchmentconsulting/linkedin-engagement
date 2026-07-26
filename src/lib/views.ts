// View models prepared server-side and passed to client components, so the
// tables never reach into the database shapes directly.

import { aiFitTier, fitTier, outreachFlag, priorityScore } from "./derived";
import type {
  EngagementEvent,
  EventType,
  FitTier,
  ManualFitTier,
  Person,
  Post,
} from "./types";

export interface LeadEventView {
  eventType: EventType;
  postTitleHook: string | null;
  contentOfComment: string | null;
  date: string;
}

export interface LeadView {
  id: string;
  name: string;
  headline: string | null;
  companyName: string | null;
  followerCount: number | null;
  linkedinUrl: string;
  relevanceScore: number | null;
  warmthScore: number | null;
  aiAssessment: string | null;
  lifecycleStatus: Person["lifecycleStatus"];
  // Non-null on a REVIEW_MANUALLY record means it was quarantined for low
  // enrichment confidence, not that it's a no-engagement stub.
  enrichmentConfidence: number | null;
  priority: number | null;
  // The effective tier (manual override if set, else the AI tier).
  tier: FitTier;
  // The human override, if any, and the tier the AI would have shown, so the
  // lead detail can display "AI scored this Not a Fit; you set it to Strong".
  manualFitTier: ManualFitTier | null;
  aiTier: FitTier;
  flagged: boolean;
  // Queue controls. Both computed server-side so client components never
  // compare clocks (avoids hydration mismatches near the snooze boundary).
  dismissed: boolean;
  snoozed: boolean;
  events: LeadEventView[];
}

export function buildLeadViews(
  people: Person[],
  events: EngagementEvent[],
  posts: Post[]
): LeadView[] {
  const postById = new Map(posts.map((post) => [post.id, post]));

  return people.map((person) => ({
    id: person.id,
    name: person.name,
    headline: person.headline,
    companyName: person.companyName,
    followerCount: person.followerCount,
    linkedinUrl: person.linkedinUrl,
    relevanceScore: person.relevanceScore,
    warmthScore: person.warmthScore,
    aiAssessment: person.aiAssessment,
    lifecycleStatus: person.lifecycleStatus,
    enrichmentConfidence: person.enrichmentConfidence,
    priority: priorityScore(person),
    tier: fitTier(person),
    manualFitTier: person.manualFitTier,
    aiTier: aiFitTier(person),
    flagged: outreachFlag(person),
    dismissed: person.dismissedAt != null,
    snoozed:
      person.snoozedUntil != null &&
      new Date(person.snoozedUntil).getTime() > Date.now(),
    events: events
      .filter((event) => event.personId === person.id)
      .map((event) => ({
        eventType: event.eventType,
        postTitleHook: event.postId
          ? postById.get(event.postId)?.postTitleHook ?? null
          : null,
        contentOfComment: event.contentOfComment,
        date: event.date,
      })),
  }));
}
