import "server-only";
import type { Account } from "@prisma/client";
import { db } from "./db";
import type {
  EngagementEvent,
  Person,
  PipelineRun,
  Post,
} from "./types";

// The single data-access layer: every query is scoped by accountId, resolved
// server-side from the one Account row (lib/account.ts).

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface AccountData {
  account: Account;
  people: Person[];
  events: EngagementEvent[];
  posts: Post[];
  runs: PipelineRun[];
}

export async function getAccountData(
  accountId: string
): Promise<AccountData | null> {
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return null;

  const [people, events, posts, runs] = await Promise.all([
    db.person.findMany({
      where: { accountId },
      include: { company: true },
      orderBy: { createdAt: "asc" },
    }),
    db.engagementEvent.findMany({
      where: { accountId },
      orderBy: { date: "desc" },
    }),
    db.post.findMany({
      where: { accountId },
      orderBy: { datePublished: "desc" },
    }),
    db.pipelineRun.findMany({
      where: { accountId },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const eventsByPost = new Map<string, { total: number; comments: number }>();
  for (const event of events) {
    if (!event.postId) continue;
    const entry = eventsByPost.get(event.postId) ?? { total: 0, comments: 0 };
    entry.total += 1;
    if (event.eventType === "COMMENT") entry.comments += 1;
    eventsByPost.set(event.postId, entry);
  }

  return {
    account,
    people: people.map((p) => ({
      id: p.id,
      linkedinUrl: p.linkedinUrl,
      name: p.name,
      headline: p.headline,
      followerCount: p.followerCount,
      relevanceScore: p.relevanceScore,
      warmthScore: p.warmthScore,
      aiAssessment: p.aiAssessment,
      manualFitTier: (p.manualFitTier as Person["manualFitTier"]) ?? null,
      lifecycleStatus: p.lifecycleStatus as Person["lifecycleStatus"],
      enrichmentConfidence: p.enrichmentConfidence,
      companyName: p.company?.companyName ?? null,
      dismissedAt: p.dismissedAt?.toISOString() ?? null,
      snoozedUntil: p.snoozedUntil?.toISOString() ?? null,
    })),
    events: events.map((e) => ({
      id: e.id,
      personId: e.personId,
      postId: e.postId,
      eventType: e.eventType as EngagementEvent["eventType"],
      contentOfComment: e.contentOfComment,
      date: day(e.date),
    })),
    posts: posts.map((post) => ({
      id: post.id,
      postTitleHook: post.postTitleHook,
      postUrl: post.postUrl,
      datePublished: day(post.datePublished),
      totalEngagements: eventsByPost.get(post.id)?.total ?? 0,
      commentCount: eventsByPost.get(post.id)?.comments ?? 0,
    })),
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status as PipelineRun["status"],
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      postsSynced: run.postsSynced,
      postTitles: Array.isArray(run.syncedPostTitles)
        ? run.syncedPostTitles.filter(
            (t): t is string => typeof t === "string"
          )
        : [],
      peopleFound: run.peopleFound,
      peopleEnriched: run.peopleEnriched,
      peopleScored: run.peopleScored,
      errorMessage: run.errorMessage,
    })),
  };
}
