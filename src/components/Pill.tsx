import { fitTierLabel } from "@/lib/derived";
import type { FitTier } from "@/lib/types";

const tierClass: Record<FitTier, string> = {
  STRONG_FIT: "t-strong",
  POSSIBLE: "t-poss",
  NOT_A_FIT: "t-no",
  UNSCORED: "t-un",
};

export default function Pill({ tier }: { tier: FitTier }) {
  return <span className={`pill ${tierClass[tier]}`}>{fitTierLabel[tier]}</span>;
}
