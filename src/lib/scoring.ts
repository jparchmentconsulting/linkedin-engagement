// Deterministic point tables: the LLM detects signals, and ONLY this code
// turns them into numbers, so scores are reproducible run to run. Relevance
// grades fit to your ICP; warmth measures the engagement pattern.

// Relevance is fit to YOUR ideal-client profile, not a fixed idea of a
// "good lead". The model reads that ICP text as its rubric and reports two
// things; the point table below is the only place they turn into a number.
export interface RelevanceSignals {
  // How well the person matches your described ideal client.
  coreFit: "STRONG" | "PARTIAL" | "NONE";
  // True ONLY when the person hits an exclusion you explicitly stated in
  // your ICP (e.g. "not corporate employees"). Never a baked-in rule about
  // competitors or established operators — those are only excluded if the ICP
  // says so.
  isDisqualified: boolean;
}

export interface WarmthSignals {
  hasSubstantiveComment: boolean;
  engagedWithCoreTopic: boolean;
}

export interface WarmthEvents {
  postsCommented: number; // distinct posts they left a comment on
  postsLiked: number; // distinct posts they reacted to
}

function clamp(score: number): number {
  return Math.max(1, Math.min(10, score));
}

// Fit maps to the same relevance bands the tiers already read (derived.ts:
// >=8 Strong Fit, >=5 Possible, >=7 flags for outreach). A stated exclusion
// floors hardest; a clear non-match sits just under Possible. Spread within a
// tier comes from warmth via the priority score, not from relevance, so these
// are fixed anchors rather than a running total.
export function computeRelevance(signals: RelevanceSignals): number {
  if (signals.isDisqualified) return 2;
  switch (signals.coreFit) {
    case "STRONG":
      return 8;
    case "PARTIAL":
      return 6;
    case "NONE":
      return 3;
  }
}

// Warmth is a normalized 1-10 measure of the ENGAGEMENT PATTERN, built only
// from signals post scraping actually captures (no "follow" — LinkedIn doesn't
// expose that through post scraping). Comments count for the most, and each
// additional post engaged adds less than the last (diminishing returns), so the
// score is bounded and means the same thing whether an account has 3 posts or
// 50: depth and breadth of engagement, not a raw tally.
export function computeWarmth(
  events: WarmthEvents,
  signals: WarmthSignals
): number {
  let score = 2;

  // Comments dominate, with diminishing returns across distinct posts commented
  // on: the first is worth most, the third little, beyond that nothing. One
  // substantive comment (a real thought, not "great post") adds a further bump.
  const c = events.postsCommented;
  if (c >= 1) score += 2;
  if (c >= 2) score += 2;
  if (c >= 3) score += 1; // comment breadth caps at +5
  if (c >= 1 && signals.hasSubstantiveComment) score += 2;

  // Reactions across posts: a lighter signal, also diminishing. Reacting to
  // several posts is a pattern; a single like barely moves the number.
  const l = events.postsLiked;
  if (l >= 1) score += 1;
  if (l >= 2) score += 1;
  if (l >= 3) score += 1; // reaction breadth caps at +3

  // Engaged with your core topic, not just any post they passed by.
  if (signals.engagedWithCoreTopic) score += 1;

  return clamp(score);
}
