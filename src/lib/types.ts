// Serializable view types passed from server pages to client components.
// Shapes mirror the Prisma models (dates flattened to YYYY-MM-DD strings);
// the mapping happens in src/lib/data.ts.

export type LifecycleStatus = "NEW" | "ENRICHED" | "SCORED" | "REVIEW_MANUALLY";

export type FitTier = "STRONG_FIT" | "POSSIBLE" | "NOT_A_FIT" | "UNSCORED";

// The tiers a human can manually assign as an override. "UNSCORED" isn't a
// choice — clearing the override (null) falls back to the AI-derived tier.
export type ManualFitTier = "STRONG_FIT" | "POSSIBLE" | "NOT_A_FIT";

export interface Person {
  id: string;
  linkedinUrl: string;
  name: string;
  headline: string | null;
  followerCount: number | null;
  relevanceScore: number | null;
  warmthScore: number | null;
  aiAssessment: string | null;
  // Human override of the derived Fit Tier; null means use the AI score.
  manualFitTier: ManualFitTier | null;
  lifecycleStatus: LifecycleStatus;
  // 0-100 trust in the enrichment, or null if never enriched. A REVIEW_MANUALLY
  // record with a non-null value here was quarantined for low confidence (vs a
  // null-value stub with no engagement).
  enrichmentConfidence: number | null;
  companyName: string | null;
  dismissedAt: string | null;
  snoozedUntil: string | null;
}

export interface Post {
  id: string;
  postTitleHook: string;
  postUrl: string;
  datePublished: string;
  // Rollups computed from engagement events at read time (data.ts), never stored.
  totalEngagements: number;
  commentCount: number;
}

export type EventType = "COMMENT" | "LIKE";

export interface EngagementEvent {
  id: string;
  personId: string;
  postId: string | null;
  eventType: EventType;
  contentOfComment: string | null;
  date: string;
}

export type PipelineRunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface PipelineRun {
  id: string;
  status: PipelineRunStatus;
  startedAt: string;
  completedAt: string | null;
  postsSynced: number | null;
  // Titles of the posts this run scraped, shown under the date in the run
  // table. Empty on continuation runs (they don't scrape) and on runs from
  // before titles were recorded.
  postTitles: string[];
  peopleFound: number | null;
  peopleEnriched: number | null;
  peopleScored: number | null;
  errorMessage: string | null;
}
