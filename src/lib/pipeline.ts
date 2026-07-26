import "server-only";
import { POSTS_ACTOR, PROFILE_ACTOR, PROFILE_SCRAPER_MODE } from "./actors";
import { assessPerson } from "./anthropic";
import { runActor } from "./apify";
import { db } from "./db";
import { erasePerson } from "./erasure";
import { errText, logError } from "./errors";
import {
  EngagerItemSchema,
  LOW_CONFIDENCE,
  PostItemSchema,
  ProfileItemSchema,
  enrichmentConfidence,
  validateItems,
  type PostItem,
  type ProfileItem,
} from "./ingest";
import { computeRelevance, computeWarmth } from "./scoring";

// Step sequence: Sync posts → Pull engagers → Enrich → Score. The trigger
// (runActions.ts) only writes a QUEUED PipelineRun row; the durable worker
// (worker.ts) claims it and calls executePipelineRun. Progress lands on the
// PipelineRun row, which the UI polls. Every write is an upsert on a natural
// key, so a retry after failure is naturally idempotent.

// Cost ceilings: everything bills to your own APIFY_TOKEN, so a single run is
// bounded — the excess is simply not pulled, the run doesn't fail.
// BACKFILL_MAX_POSTS bounds the one-time history pull.
const BACKFILL_MAX_POSTS = 50;
// A non-backfill run wants maxPostsPerRun posts that actually have text to
// score against. Reshares and media-only posts get skipped, so they must not
// eat into the count — we ask the actor for several times the target (post
// metadata is cheap; only scrapeReactions/Comments cost real money, and those
// still run once per kept post) and take the first N with text. Capped so a
// reshare-heavy feed can't scan the whole history.
const POST_SCAN_MULTIPLIER = 5;
const POST_SCAN_CAP = 25;
// Pull every reaction and comment on a post, not a sample — surfacing the whole
// audience is the point. This high per-post ceiling (env-overridable) only
// bounds a single actor call so a freak viral post can't spin one runaway
// scrape.
const ENGAGERS_PER_POST_CAP = (() => {
  const raw = Number(process.env.ENGAGERS_PER_POST_CAP);
  return Number.isInteger(raw) && raw > 0 ? raw : 2000;
})();
const MAX_ENRICH_PER_RUN = 200;
const MAX_SCORE_PER_RUN = 200;

// Score several leads at once instead of single file, so a big batch isn't
// gated on one Anthropic call at a time. Bounded to stay comfortably under
// Anthropic's default rate limits; overridable via SCORING_CONCURRENCY if
// your plan's limits allow more or need less.
const SCORE_CONCURRENCY = (() => {
  const raw = Number(process.env.SCORING_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 && raw <= 20 ? Math.floor(raw) : 6;
})();

// Scraped text can contain NUL bytes and lone UTF-16 surrogates (a broken
// half of an emoji); the database and Prisma's JSON protocol reject both,
// which fails the whole run. Strip them from every string before it is stored.
function sanitize(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = sanitize(value).trim();
  return cleaned ? cleaned : null;
}

function firstLine(text: string, max = 80): string {
  const line = text.split("\n").find((l) => l.trim()) ?? text;
  // Slice by code points so an emoji is never cut in half at the boundary.
  const chars = Array.from(sanitize(line).trim());
  return chars.length > max
    ? `${chars.slice(0, max - 1).join("")}…`
    : chars.join("");
}

function normalizeProfileUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "").split("?")[0];
}

// postedAt arrives as { timestamp, date }, a bare string, or nothing (→ now).
function datePublishedFrom(postedAt: PostItem["postedAt"]): Date {
  return typeof postedAt === "object" && postedAt?.timestamp
    ? new Date(postedAt.timestamp)
    : typeof postedAt === "object" && postedAt?.date
      ? new Date(postedAt.date)
      : typeof postedAt === "string"
        ? new Date(postedAt)
        : new Date();
}

// harvestapi actors report account-level problems (e.g. "Free users are
// limited to 10 runs") as a dataset item with a single `error` field while
// the Apify run itself still succeeds. Surface that as a real run failure
// instead of silently writing nothing.
function throwIfActorErrored(
  items: Record<string, unknown>[],
  step: string
): void {
  const errors = items.filter((item) => typeof item.error === "string");
  if (items.length > 0 && errors.length === items.length) {
    throw new Error(`${step}: ${String(errors[0].error)}`);
  }
}

// A batch where some items failed schema validation is a drift signal: the
// actor's output shape may have changed under us. Per-item isolation means the
// run still proceeds on the valid items, so this only logs rather than
// failing. If it's most of the batch, the shape almost certainly changed.
function logIngestDrift(
  step: string,
  report: { invalid: number; total: number },
  ctx: { runId: string }
): void {
  if (report.invalid === 0) return;
  logError({
    source: "ingest-drift",
    runId: ctx.runId,
    message: `${step}: ${report.invalid} of ${report.total} items failed schema validation and were skipped. If this is most of the batch, the actor output shape likely changed.`,
  });
}

export async function executePipelineRun(runId: string): Promise<void> {
  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    include: { account: true },
  });
  // The worker claims the run (QUEUED → RUNNING, atomically) before calling
  // this, so anything not RUNNING here is a double-dispatch — skip it.
  if (!run || run.status !== "RUNNING") return;
  const account = run.account;

  // A processOnly continuation: no scraping, just drain the enrichment +
  // scoring backlog left past the per-run caps.
  if (run.processOnly) {
    await executeProcessBacklog(account, runId);
    return;
  }

  try {
    // ---- Step 1: Sync posts ------------------------------------------------
    // Backfill mode: Account.backfillMonths > 0 (set on the setup screen)
    // makes this run reach back through your post history instead of just the
    // latest maxPostsPerRun posts. The flag self-clears after posts AND
    // engagers are stored, so a run that fails mid-backfill retries in
    // backfill mode rather than silently downgrading to a normal pull.
    const backfill = account.backfillMonths > 0;
    const backfillSince = new Date();
    backfillSince.setMonth(backfillSince.getMonth() - account.backfillMonths);

    const postItems = await runActor(POSTS_ACTOR, {
      targetUrls: [account.linkedinProfileUrl],
      maxPosts: backfill
        ? BACKFILL_MAX_POSTS
        : Math.min(account.maxPostsPerRun * POST_SCAN_MULTIPLIER, POST_SCAN_CAP),
      ...(backfill
        ? { postedLimitDate: backfillSince.toISOString().slice(0, 10) }
        : { postedLimit: "any" }),
      scrapeReactions: false,
      scrapeComments: false,
    });
    throwIfActorErrored(postItems, "Sync posts");
    const posts = validateItems(PostItemSchema, postItems);
    logIngestDrift("Sync posts", posts, { runId });

    const postIds: string[] = [];
    // Titles of the posts this run actually stored, saved on the run so run
    // history can show which posts a run was built on.
    const syncedTitles: string[] = [];
    for (const item of posts.valid) {
      const postUrl = str(item.linkedinUrl) ?? str(item.url) ?? str(item.postUrl);
      const content =
        str(item.content) ?? str(item.commentary) ?? str(item.text);
      if (!postUrl || !content) continue;
      // Once we have maxPostsPerRun real posts to engager-scrape, stop storing
      // (and stop the per-post engager cost). Backfill stores every post in
      // its window, uncapped.
      if (!backfill && postIds.length >= account.maxPostsPerRun) continue;
      const datePublished = datePublishedFrom(item.postedAt);

      const post = await db.post.upsert({
        where: { accountId_postUrl: { accountId: account.id, postUrl } },
        update: {},
        create: {
          accountId: account.id,
          postUrl,
          postTitleHook: firstLine(content),
          datePublished,
        },
      });
      if (!postIds.includes(post.id)) {
        postIds.push(post.id);
        syncedTitles.push(post.postTitleHook);
      }
    }
    await db.pipelineRun.update({
      where: { id: runId },
      data: { postsSynced: postIds.length, syncedPostTitles: syncedTitles },
    });

    // ---- Step 2: Pull engagers (one call per post so events map to posts) --
    const { failedPosts } = await pullEngagersForPosts(account, postIds, runId);

    // The expensive scraping is done; clear the backfill flag so the next
    // run is a normal pull. A partly-failed backfill keeps the flag so the
    // retry stays in backfill mode and the skipped posts get their engagers.
    if (backfill && failedPosts === 0) {
      await db.account.update({
        where: { id: account.id },
        data: { backfillMonths: 0 },
      });
    }

    // ---- Steps 3+4: Enrich, score, finish (shared tail) ---------------------
    await processAndFinishRun(account, runId);
  } catch (error) {
    // Partial progress stays (idempotent retry re-selects by lifecycle stage).
    await failRun(runId, error);
  }
}

// Step 2: per-post isolation — one post's failed pull is logged and skipped so
// the other posts still land; only every-post-failed throws (that's an
// account-level problem, e.g. Apify down or the free-tier run cap). Writes
// peopleFound to the run row.
async function pullEngagersForPosts(
  account: { id: string; linkedinProfileUrl: string },
  postIds: string[],
  runId: string
): Promise<{ peopleFound: number; failedPosts: number }> {
  const ownerUrl = normalizeProfileUrl(account.linkedinProfileUrl);
  let peopleFound = 0;
  let failedPosts = 0;
  let firstPostError: string | null = null;

  for (const postId of postIds) {
    const post = await db.post.findUnique({ where: { id: postId } });
    if (!post) continue;

    let engagerItems: Record<string, unknown>[];
    try {
      engagerItems = await runActor(POSTS_ACTOR, {
        targetUrls: [post.postUrl],
        maxPosts: 1,
        postedLimit: "any",
        scrapeReactions: true,
        maxReactions: ENGAGERS_PER_POST_CAP,
        scrapeComments: true,
        maxComments: ENGAGERS_PER_POST_CAP,
      });
      throwIfActorErrored(engagerItems, "Pull engagers");
    } catch (error) {
      failedPosts += 1;
      firstPostError ??= errText(error);
      logError({
        source: "engagers",
        runId,
        message: `Engager pull failed for post "${post.postTitleHook}": ${errText(error)}. Post kept; its engagers retry on the next run.`,
      });
      continue;
    }

    const engagers = validateItems(EngagerItemSchema, engagerItems);
    logIngestDrift(`Pull engagers for "${post.postTitleHook}"`, engagers, {
      runId,
    });

    for (const item of engagers.valid) {
      const itemType = str(item.type);
      if (itemType !== "reaction" && itemType !== "comment") continue;

      const actor = item.actor;
      if (!actor?.id || !actor?.name) continue;
      // Exclusions: company accounts, and you engaging with your own post.
      if (actor.type === "company") continue;
      if (
        actor.linkedinUrl &&
        normalizeProfileUrl(actor.linkedinUrl) === ownerUrl
      )
        continue;

      const person = await db.person.upsert({
        where: {
          accountId_linkedinMemberId: {
            accountId: account.id,
            linkedinMemberId: actor.id,
          },
        },
        update: {},
        create: {
          accountId: account.id,
          linkedinMemberId: actor.id,
          linkedinUrl:
            str(actor.linkedinUrl) ??
            `https://www.linkedin.com/in/${actor.id}/`,
          name: sanitize(actor.name),
          headline: str(actor.position),
          lifecycleStatus: "NEW",
        },
      });
      peopleFound += 1;

      const eventType = itemType === "comment" ? "COMMENT" : "LIKE";
      // Comments carry a real createdAt; reactions don't — use the post date.
      const eventDate =
        eventType === "COMMENT" && str(item.createdAt)
          ? new Date(str(item.createdAt)!)
          : post.datePublished;

      const existing = await db.engagementEvent.findFirst({
        where: {
          personId: person.id,
          postId: post.id,
          eventType,
          date: eventDate,
        },
      });
      if (!existing) {
        await db.engagementEvent.create({
          data: {
            accountId: account.id,
            personId: person.id,
            postId: post.id,
            eventType,
            contentOfComment:
              eventType === "COMMENT" ? str(item.commentary) : null,
            date: eventDate,
          },
        });
      }
    }
  }
  if (postIds.length > 0 && failedPosts === postIds.length) {
    throw new Error(
      `Pull engagers: all ${postIds.length} posts failed. First error: ${firstPostError}`
    );
  }
  await db.pipelineRun.update({
    where: { id: runId },
    data: { peopleFound },
  });
  return { peopleFound, failedPosts };
}

// The account fields scoring reads.
type ScoringAccount = {
  id: string;
  icpDescription: string;
  coreTopic: string;
  scoringTweaks: string | null;
};

// Step 4: scores every ENRICHED person against the current ICP. Per-person
// isolation: one un-scorable person is logged and skipped (stays ENRICHED,
// retries next run); only everyone-failed throws, since that means the
// Anthropic call itself is broken. Returns how many were scored.
async function scoreEnrichedPeople(
  account: ScoringAccount,
  runId: string
): Promise<number> {
  const toScore = await db.person.findMany({
    where: { accountId: account.id, lifecycleStatus: "ENRICHED" },
    include: {
      engagementEvents: { include: { post: true }, orderBy: { date: "desc" } },
    },
    take: MAX_SCORE_PER_RUN,
  });

  let peopleScored = 0;
  let scoringFailures = 0;
  let firstScoreError: string | null = null;

  // Per-person work, isolated: a single failure is logged and the lead stays
  // ENRICHED to retry, it never sinks the whole batch. Counters are mutated
  // from here; JS runs these callbacks on one thread so the increments don't
  // race even though the Anthropic calls overlap.
  const scoreOne = async (person: (typeof toScore)[number]): Promise<void> => {
    try {
      const assessment = await assessPerson({
        icpDescription: account.icpDescription,
        coreTopic: account.coreTopic,
        scoringTweaks: account.scoringTweaks,
        person: {
          name: person.name,
          headline: person.headline,
          aboutSummary: person.aboutSummary,
          followerCount: person.followerCount,
          premiumProfile: person.premiumProfile,
        },
        events: person.engagementEvents.map((event) => ({
          eventType: event.eventType,
          postTitleHook: event.post?.postTitleHook ?? null,
          contentOfComment: event.contentOfComment,
          date: event.date.toISOString().slice(0, 10),
        })),
      });

      const relevanceScore = computeRelevance(assessment);
      const warmthScore = computeWarmth(
        {
          postsCommented: new Set(
            person.engagementEvents
              .filter((event) => event.eventType === "COMMENT" && event.postId)
              .map((event) => event.postId)
          ).size,
          postsLiked: new Set(
            person.engagementEvents
              .filter((event) => event.eventType === "LIKE" && event.postId)
              .map((event) => event.postId)
          ).size,
        },
        assessment
      );

      // Auto-create/match Company (enrich step) from the assessment.
      let companyId = person.companyId;
      if (!companyId && assessment.companyName) {
        const company = await db.company.upsert({
          where: {
            accountId_companyName: {
              accountId: account.id,
              companyName: assessment.companyName,
            },
          },
          update: {
            industry: assessment.companyIndustry ?? undefined,
            nicheDescription: assessment.companyNiche ?? undefined,
          },
          create: {
            accountId: account.id,
            companyName: assessment.companyName,
            industry: assessment.companyIndustry,
            nicheDescription: assessment.companyNiche,
          },
        });
        companyId = company.id;
      }

      await db.person.update({
        where: { id: person.id },
        data: {
          relevanceScore,
          warmthScore,
          aiAssessment: assessment.rationale,
          lifecycleStatus: "SCORED",
          companyId,
        },
      });
      peopleScored += 1;
    } catch (error) {
      scoringFailures += 1;
      firstScoreError ??= errText(error);
      logError({
        source: "scoring",
        runId,
        personId: person.id,
        message: `Scoring failed for ${person.name}: ${errText(error)}. They stay Enriched and retry on the next run.`,
      });
    }
  };

  // Run SCORE_CONCURRENCY people at a time rather than one after another.
  for (let i = 0; i < toScore.length; i += SCORE_CONCURRENCY) {
    await Promise.all(toScore.slice(i, i + SCORE_CONCURRENCY).map(scoreOne));
  }

  if (toScore.length > 0 && scoringFailures === toScore.length) {
    throw new Error(
      `Score against ICP: all ${toScore.length} people failed. First error: ${firstScoreError}`
    );
  }
  return peopleScored;
}

// Step 3: follower stubs (zero engagement) go straight to Review Manually —
// no enrichment spend on them; then up to MAX_ENRICH_PER_RUN NEW people are
// enriched. Per-person isolation: a bad payload skips that one (stays NEW,
// retries next batch). Returns the count.
async function enrichNewPeople(
  account: { id: string; linkedinProfileUrl: string },
  runId: string
): Promise<number> {
  const ownerUrl = normalizeProfileUrl(account.linkedinProfileUrl);

  await db.person.updateMany({
    where: {
      accountId: account.id,
      lifecycleStatus: "NEW",
      engagementEvents: { none: {} },
    },
    data: { lifecycleStatus: "REVIEW_MANUALLY" },
  });

  const toEnrich = await db.person.findMany({
    where: { accountId: account.id, lifecycleStatus: "NEW" },
    take: MAX_ENRICH_PER_RUN,
  });

  let peopleEnriched = 0;
  if (toEnrich.length > 0) {
    const profileItems = await runActor(
      PROFILE_ACTOR,
      {
        profileScraperMode: PROFILE_SCRAPER_MODE,
        queries: toEnrich.map((person) => person.linkedinUrl),
      },
      { timeoutMs: 20 * 60_000 }
    );
    throwIfActorErrored(profileItems, "Enrich profiles");
    const profiles = validateItems(ProfileItemSchema, profileItems);
    logIngestDrift("Enrich profiles", profiles, { runId });

    // Match results back by member id first, then by queried URL.
    const byMemberId = new Map<string, ProfileItem>();
    const byUrl = new Map<string, ProfileItem>();
    for (const item of profiles.valid) {
      const memberId = str(item.id);
      if (memberId) byMemberId.set(memberId, item);
      for (const url of [item.query, item.inputUrl, item.linkedinUrl]) {
        const clean = str(url);
        if (clean) byUrl.set(normalizeProfileUrl(clean), item);
      }
      const publicId = str(item.publicIdentifier);
      if (publicId)
        byUrl.set(
          normalizeProfileUrl(`https://www.linkedin.com/in/${publicId}`),
          item
        );
    }
    let quarantined = 0;

    // Per-person isolation: a bad profile payload skips that one person
    // (logged, stays NEW, retries next run) instead of failing the run.
    for (const person of toEnrich) {
      try {
        const byId = byMemberId.get(person.linkedinMemberId);
        const item =
          byId ?? byUrl.get(normalizeProfileUrl(person.linkedinUrl));
        if (!item) continue;
        const matchedByMemberId = byId != null;

        const vanityUrl =
          str(item.linkedinUrl) ??
          (str(item.publicIdentifier)
            ? `https://www.linkedin.com/in/${str(item.publicIdentifier)}/`
            : null);

        // You can slip past the ingestion filter when your own reaction
        // carries only the ACoAA member URL; the vanity URL revealed here is
        // the reliable check. You are not a lead — remove yourself with the
        // same erasure primitive the UI uses.
        if (vanityUrl && normalizeProfileUrl(vanityUrl) === ownerUrl) {
          await erasePerson(person.id);
          continue;
        }

        const scrapedHeadline = str(item.headline);
        const scrapedAbout = str(item.about);
        const scrapedFollowers =
          typeof item.followerCount === "number" ? item.followerCount : null;
        const confidence = enrichmentConfidence({
          matchedByMemberId,
          matchedByUrl: !matchedByMemberId,
          hasAbout: scrapedAbout != null,
          hasHeadline: scrapedHeadline != null,
          hasFollowerCount: scrapedFollowers != null,
        });
        // Low confidence is quarantined: we keep the data we pulled and the
        // score of how much to trust it, but hold the record in
        // REVIEW_MANUALLY so it is never scored and shown as a confident
        // lead. A human can look and decide.
        const quarantine = confidence < LOW_CONFIDENCE;
        if (quarantine) quarantined += 1;

        await db.person.update({
          where: { id: person.id },
          data: {
            headline: scrapedHeadline ?? person.headline,
            aboutSummary: scrapedAbout,
            followerCount: scrapedFollowers ?? person.followerCount,
            premiumProfile: item.premium === true,
            linkedinUrl: vanityUrl ?? person.linkedinUrl,
            enrichmentConfidence: confidence,
            lifecycleStatus: quarantine ? "REVIEW_MANUALLY" : "ENRICHED",
          },
        });
        peopleEnriched += 1;
      } catch (error) {
        logError({
          source: "enrichment",
          runId,
          personId: person.id,
          message: `Enrichment failed for ${person.name}: ${errText(error)}. They stay New and retry on the next run.`,
        });
      }
    }
    if (quarantined > 0) {
      logError({
        source: "enrich-quarantine",
        runId,
        message: `${quarantined} enriched profile${quarantined === 1 ? " was" : "s were"} low-confidence (below ${LOW_CONFIDENCE}) and held in Review Manually instead of being scored.`,
      });
    }
  }
  await db.pipelineRun.update({
    where: { id: runId },
    data: { peopleEnriched },
  });
  return peopleEnriched;
}

// After a batch enriches + scores, a large audience can still have NEW
// (un-enriched) or ENRICHED (un-scored) people beyond the per-run caps. Enqueue
// a processOnly continuation to drain them, one batch per run, so a whole
// audience finishes from a single "Run" click. Guarded on progress so a batch
// that moves nothing (only un-enrichable/un-scorable leads left) ends the
// chain instead of looping. The continuation carries the originating run's
// group key so run history folds the whole drain into one session.
async function autoContinueProcessing(
  accountId: string,
  runId: string,
  enriched: number,
  scored: number
): Promise<void> {
  if (enriched === 0 && scored === 0) return;
  const [newRemaining, enrichedRemaining] = await Promise.all([
    db.person.count({ where: { accountId, lifecycleStatus: "NEW" } }),
    db.person.count({ where: { accountId, lifecycleStatus: "ENRICHED" } }),
  ]);
  if (newRemaining + enrichedRemaining === 0) return;
  const current = await db.pipelineRun.findUnique({
    where: { id: runId },
    select: { batchGroupId: true },
  });
  if (!current) return;
  await db.pipelineRun.create({
    data: {
      accountId,
      status: "QUEUED",
      processOnly: true,
      batchGroupId: current.batchGroupId ?? runId,
    },
  });
}

// Shared run tail: enrich → score → auto-continue → mark SUCCEEDED. Every run
// shape ends here once its scraping (if any) is done; errors propagate to the
// caller's failRun.
async function processAndFinishRun(
  account: ScoringAccount & { linkedinProfileUrl: string },
  runId: string
): Promise<void> {
  const peopleEnriched = await enrichNewPeople(account, runId);
  const peopleScored = await scoreEnrichedPeople(account, runId);

  // A large audience leaves people past this batch's enrich/score caps;
  // enqueue processOnly continuations so one click drains the whole audience.
  await autoContinueProcessing(account.id, runId, peopleEnriched, peopleScored);

  await db.pipelineRun.update({
    where: { id: runId },
    data: { peopleScored, status: "SUCCEEDED", completedAt: new Date() },
  });
}

// A processOnly continuation: no scraping. Just drain the enrichment + scoring
// backlog and auto-continue until the whole audience is processed.
async function executeProcessBacklog(
  account: ScoringAccount & { linkedinProfileUrl: string },
  runId: string
): Promise<void> {
  try {
    await processAndFinishRun(account, runId);
  } catch (error) {
    await failRun(runId, error);
  }
}

// Shared run-failure handling: mark the run failed (keeping partial progress)
// and log it. The run panel surfaces errorMessage in the UI.
async function failRun(runId: string, error: unknown): Promise<void> {
  const message = errText(error);
  await db.pipelineRun
    .update({
      where: { id: runId },
      data: { status: "FAILED", completedAt: new Date(), errorMessage: message },
    })
    .catch(() => {});
  logError({
    source: "run",
    runId,
    message: `Run failed: ${message}`,
  });
}

// Backstop only: the durable worker (worker.ts) re-queues interrupted runs
// within minutes on its own. A run still active after an hour with no live
// heartbeat therefore means the worker itself isn't running — mark the run
// failed so new runs aren't blocked forever, and say so loudly. A healthy
// long run keeps heartbeating and is never touched.
export async function failStaleRuns(accountId: string): Promise<void> {
  const hourAgo = new Date(Date.now() - 60 * 60_000);
  const { count } = await db.pipelineRun.updateMany({
    where: {
      accountId,
      status: { in: ["QUEUED", "RUNNING"] },
      startedAt: { lt: hourAgo },
      OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: hourAgo } }],
    },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      errorMessage:
        "Run sat for over an hour without the background worker picking it up. Marked failed so new runs aren't blocked. Safe to retry — completed steps are kept.",
    },
  });
  if (count > 0) {
    logError({
      source: "run",
      message: `${count} run${count === 1 ? "" : "s"} sat for over an hour without the background worker picking ${count === 1 ? "it" : "them"} up. Marked failed. If this repeats, the worker isn't starting — check the server logs for "[worker] pipeline worker started".`,
    });
  }
}
