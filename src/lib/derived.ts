// Derived fields, ported verbatim from the spec's Scoring_Logic.md.
// These are never stored — computed on every read, exactly like Notion's
// locked formulas, so they can't go stale after a re-score.

import type { FitTier, Person } from "./types";

type Scored = Pick<Person, "relevanceScore" | "warmthScore" | "manualFitTier">;

export function priorityScore(p: Scored): number | null {
  if (p.relevanceScore == null || p.warmthScore == null) return null;
  return p.relevanceScore * 10 + p.warmthScore;
}

// The AI-derived tier from the relevance score alone, ignoring any human
// override. Kept separate so the UI can show "AI said X, you set Y".
export function aiFitTier(p: Pick<Person, "relevanceScore">): FitTier {
  if (p.relevanceScore == null) return "UNSCORED";
  if (p.relevanceScore >= 8) return "STRONG_FIT";
  if (p.relevanceScore >= 5) return "POSSIBLE";
  return "NOT_A_FIT";
}

// A human override wins over the AI-derived tier so a mis-sorted lead can be
// corrected without a re-score.
export function fitTier(p: Scored): FitTier {
  if (p.manualFitTier) return p.manualFitTier;
  return aiFitTier(p);
}

// Contact now needs a strong-enough fit AND enough engagement, so the daily
// list is strong-fit leads who are actually warming up, not every strong fit
// regardless of whether they've engaged. Gating on the warmth SCORE (not raw
// like/comment counts) keeps the bar identical whether an account has 3 posts
// or 50: warmth is already normalized to 1-10.
export const WARMTH_FLAG_MIN = 6;

// Outreach flag surfaces a lead in the Today card and the "flagged only"
// filter. A manual Strong Fit always flags (the human wants to work it); a
// manual Not a Fit always suppresses it; otherwise it's the AI rule.
export function outreachFlag(p: Scored): boolean {
  if (p.manualFitTier === "STRONG_FIT") return true;
  if (p.manualFitTier === "NOT_A_FIT") return false;
  return (
    p.relevanceScore != null &&
    p.relevanceScore >= 7 &&
    p.warmthScore != null &&
    p.warmthScore >= WARMTH_FLAG_MIN
  );
}

export const fitTierLabel: Record<FitTier, string> = {
  STRONG_FIT: "Strong Fit",
  POSSIBLE: "Possible",
  NOT_A_FIT: "Not a Fit",
  UNSCORED: "Unscored",
};

// Color tokens from the design system (globals.css :root).
export const fitTierColor: Record<FitTier, string> = {
  STRONG_FIT: "#2e7d5b",
  POSSIBLE: "#c98a1b",
  NOT_A_FIT: "#9aa0a6",
  UNSCORED: "#3b6ea5",
};
