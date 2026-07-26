import "server-only";
import { z } from "zod";

// Schema validation at the ingestion boundary. Apify actor output is
// external, undocumented, and drifts without warning. Instead of coercing
// every field through a chain of
// `?? ?? ??` fallbacks and hoping, we parse each item against a schema here. A
// schema failure is a drift signal (counted, logged, item skipped) rather than
// silent bad data reaching a client.
//
// The schemas are deliberately lenient about EXTRA fields (Apify adds them all
// the time; zod strips unknown keys by default) and about MISSING optional
// fields (a sparse profile is normal), but strict about the TYPE of every
// field we actually read and about the few fields an item is useless without.
// A wrong type or a renamed core field is exactly the drift we want to catch.

// ---- Posts (harvestapi~linkedin-profile-posts, posts mode) ----------------

// postedAt comes back as either a { timestamp, date } object or a bare string.
const PostedAtSchema = z.union([
  z.object({
    timestamp: z.number().nullish(),
    date: z.string().nullish(),
  }),
  z.string(),
]);

export const PostItemSchema = z.object({
  linkedinUrl: z.string().nullish(),
  url: z.string().nullish(),
  postUrl: z.string().nullish(),
  content: z.string().nullish(),
  commentary: z.string().nullish(),
  text: z.string().nullish(),
  postedAt: PostedAtSchema.nullish(),
});
export type PostItem = z.infer<typeof PostItemSchema>;

// ---- Engagers (same actor, reactions/comments mode) -----------------------

// The engager dataset mixes reaction/comment rows (which carry an actor) with
// other rows (the post itself) that don't. So actor is optional here, but when
// present it MUST have id+name: an actor whose id or name field was renamed is
// the drift that would otherwise silently drop every lead.
const ActorSchema = z.object({
  id: z.string(),
  name: z.string(),
  linkedinUrl: z.string().nullish(),
  position: z.string().nullish(),
  type: z.string().nullish(),
});

export const EngagerItemSchema = z.object({
  type: z.string().nullish(),
  createdAt: z.string().nullish(),
  commentary: z.string().nullish(),
  actor: ActorSchema.nullish(),
});
export type EngagerItem = z.infer<typeof EngagerItemSchema>;

// ---- Profiles (harvestapi~linkedin-profile-scraper) -----------------------

export const ProfileItemSchema = z.object({
  id: z.string().nullish(),
  query: z.string().nullish(),
  inputUrl: z.string().nullish(),
  linkedinUrl: z.string().nullish(),
  publicIdentifier: z.string().nullish(),
  headline: z.string().nullish(),
  about: z.string().nullish(),
  followerCount: z.number().nullish(),
  premium: z.boolean().nullish(),
});
export type ProfileItem = z.infer<typeof ProfileItemSchema>;

// ---- Generic per-item validation -----------------------------------------

export interface ValidationReport<T> {
  valid: T[];
  invalid: number; // items that failed schema validation
  total: number;
}

// Parse each item independently so one malformed row never discards the batch.
// The caller decides what to do with `invalid` (we log it as a drift signal).
export function validateItems<T>(
  schema: z.ZodType<T>,
  items: Record<string, unknown>[]
): ValidationReport<T> {
  const valid: T[] = [];
  let invalid = 0;
  for (const item of items) {
    const result = schema.safeParse(item);
    if (result.success) valid.push(result.data);
    else invalid++;
  }
  return { valid, invalid, total: items.length };
}

// ---- Enrichment confidence + quarantine -----------------------------------

// Below this, an enrichment is quarantined into REVIEW_MANUALLY instead of
// flowing to SCORED and reaching a client as a confident lead.
export const LOW_CONFIDENCE = 40;

// Enrichment confidence (0-100): how much to trust that this profile is the
// right person AND carries usable data. Identity-match strength dominates,
// because a wrong match is worse than a sparse one; profile completeness fills
// the rest. Tuned so that a member-id match always clears the bar (we're sure
// who it is, even if the profile is thin), while a URL-only match with an
// essentially empty profile — the classic "scrape hit a wall or matched the
// wrong person" case — falls below it.
export function enrichmentConfidence(input: {
  matchedByMemberId: boolean;
  matchedByUrl: boolean;
  hasAbout: boolean;
  hasHeadline: boolean;
  hasFollowerCount: boolean;
}): number {
  let score = 0;
  if (input.matchedByMemberId) score += 45;
  else if (input.matchedByUrl) score += 25;
  if (input.hasAbout) score += 30;
  if (input.hasHeadline) score += 15;
  if (input.hasFollowerCount) score += 10;
  return Math.min(100, score);
}
