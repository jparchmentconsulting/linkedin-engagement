"use client";

import { useState, useTransition } from "react";
import { fitTierLabel } from "@/lib/derived";
import {
  dismissLead,
  eraseLead,
  restoreLead,
  setLeadFit,
  snoozeLead,
} from "@/lib/leadActions";
import type { ManualFitTier } from "@/lib/types";
import type { LeadView } from "@/lib/views";

// Engagement events shown before the "Show all" toggle kicks in.
const VISIBLE_EVENTS = 5;

const statusLabel: Record<LeadView["lifecycleStatus"], string> = {
  NEW: "New",
  ENRICHED: "Enriched",
  SCORED: "Scored",
  REVIEW_MANUALLY: "Review Manually",
};

const eventLabel = {
  COMMENT: "Commented on",
  LIKE: "Liked",
} as const;

const countLabel: Record<
  LeadView["events"][number]["eventType"],
  [string, string]
> = {
  COMMENT: ["comment", "comments"],
  LIKE: ["like", "likes"],
};

function eventSummary(events: LeadView["events"]): string {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const type of Object.keys(countLabel) as (keyof typeof countLabel)[]) {
    const n = counts.get(type);
    if (n) parts.push(`${n} ${countLabel[type][n === 1 ? 0 : 1]}`);
  }
  return parts.join(" · ");
}

// Manual Fit Tier override. Lets a human correct a lead the AI mis-sorted
// (e.g. promote someone the scorer called "Not a Fit"). Setting a tier wins
// over the AI score everywhere the tier is used; "Use AI score" clears it.
const FIT_CHOICES: { value: ManualFitTier; label: string }[] = [
  { value: "STRONG_FIT", label: "Strong fit" },
  { value: "POSSIBLE", label: "Possible" },
  { value: "NOT_A_FIT", label: "Not a fit" },
];

function FitControl({ lead }: { lead: LeadView }) {
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const overridden = lead.manualFitTier != null;

  const set = (tier: ManualFitTier | "AI") => {
    setError(null);
    startSaving(async () => {
      const result = await setLeadFit(lead.id, tier);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div style={{ marginTop: 14 }} onClick={(e) => e.stopPropagation()}>
      <h3>Fit</h3>
      <div className="row-actions" style={{ alignItems: "center" }}>
        {FIT_CHOICES.map((choice) => {
          const active = lead.tier === choice.value;
          return (
            <button
              key={choice.value}
              type="button"
              className={`btn btn-sm${active ? "" : " btn-ghost"}`}
              disabled={saving}
              aria-pressed={active}
              onClick={() => set(choice.value)}
            >
              {choice.label}
            </button>
          );
        })}
        {overridden && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={saving}
            onClick={() => set("AI")}
          >
            Use AI score
          </button>
        )}
      </div>
      <p className="note" style={{ marginTop: 6 }}>
        {overridden ? (
          <>
            You set this fit manually. The AI scored it{" "}
            <b>{fitTierLabel[lead.aiTier]}</b>. Setting Strong fit also flags
            them for outreach; Not a fit removes the flag.
          </>
        ) : (
          <>
            Scored by AI. Override it here if the ranking looks wrong, the tier
            you pick sticks until you reset it.
          </>
        )}
      </p>
      {error && (
        <div className="error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// Dismiss / snooze / restore. Dismiss is for "not a fit, stop showing me
// this person"; snooze is "not now". Neither deletes anything, and both are
// reversible from the same spot.
function QueueControls({ lead }: { lead: LeadView }) {
  if (lead.dismissed || lead.snoozed) {
    return (
      <div
        className="row-actions"
        style={{ marginTop: 10, alignItems: "center" }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className={`pill ${lead.dismissed ? "t-no" : "t-un"}`}>
          {lead.dismissed ? "Dismissed" : "Snoozed"}
        </span>
        <form action={restoreLead}>
          <input type="hidden" name="personId" value={lead.id} />
          <button className="btn btn-ghost btn-sm" type="submit">
            Bring back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      className="row-actions"
      style={{ marginTop: 10 }}
      onClick={(e) => e.stopPropagation()}
    >
      <form action={snoozeLead}>
        <input type="hidden" name="personId" value={lead.id} />
        <button className="btn btn-ghost btn-sm" type="submit">
          Snooze 2 weeks
        </button>
      </form>
      <form action={dismissLead}>
        <input type="hidden" name="personId" value={lead.id} />
        <button className="btn btn-ghost btn-sm" type="submit">
          Not a fit, dismiss
        </button>
      </form>
    </div>
  );
}

// Permanent-delete control. Irreversible, so it confirms first and sits apart
// from the reversible dismiss/snooze queue controls.
function EraseControl({ lead }: { lead: LeadView }) {
  const [erasing, startErasing] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const erase = () => {
    if (
      !window.confirm(
        `Permanently erase ${lead.name}? This deletes their profile and engagement history. It cannot be undone.`
      )
    )
      return;
    setError(null);
    startErasing(async () => {
      const result = await eraseLead(lead.id);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div
      className="row-actions"
      style={{ marginTop: 10 }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        disabled={erasing}
        onClick={erase}
      >
        {erasing ? "Erasing…" : "Erase permanently"}
      </button>
      {error && (
        <div className="error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default function LeadDetail({ lead }: { lead: LeadView }) {
  const [showAll, setShowAll] = useState(false);
  const events = showAll ? lead.events : lead.events.slice(0, VISIBLE_EVENTS);
  const hidden = lead.events.length - events.length;

  return (
    <div className="detail-grid">
      <div className="detail-block">
        <h3>Profile</h3>
        {lead.headline && <p>{lead.headline}</p>}
        <p>
          {lead.companyName && <>{lead.companyName} · </>}
          {lead.followerCount != null && (
            <>{lead.followerCount.toLocaleString("en-US")} followers · </>
          )}
          Status: {statusLabel[lead.lifecycleStatus]}
        </p>
        {lead.lifecycleStatus === "REVIEW_MANUALLY" &&
          lead.enrichmentConfidence != null && (
            <p className="quote" style={{ color: "#c98a1b" }}>
              Low-confidence enrichment ({lead.enrichmentConfidence}/100). Held
              out of scoring because the scrape may have matched the wrong
              profile or come back thin. Open the LinkedIn profile and confirm
              before trusting this lead.
            </p>
          )}
        <p>
          <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer">
            Open LinkedIn profile ↗
          </a>
        </p>
        {lead.aiAssessment && (
          <>
            <h3 style={{ marginTop: 14 }}>AI Assessment</h3>
            <p>{lead.aiAssessment}</p>
          </>
        )}
        <FitControl lead={lead} />
        <QueueControls lead={lead} />
        <EraseControl lead={lead} />
      </div>
      <div className="detail-block">
        <h3>Engagement history</h3>
        {lead.events.length === 0 ? (
          <p className="quote">
            No engagement recorded yet. Captured as a follower stub, awaiting
            enrichment and scoring.
          </p>
        ) : (
          <>
            <p className="quote">{eventSummary(lead.events)}</p>
            <ul>
              {events.map((event, i) => (
                <li key={i}>
                  {eventLabel[event.eventType]}
                  {event.postTitleHook && <> &ldquo;{event.postTitleHook}&rdquo;</>}{" "}
                  ({event.date})
                  {event.contentOfComment && (
                    <>
                      {" "}
                      <span className="quote">
                        &ldquo;{event.contentOfComment}&rdquo;
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {(hidden > 0 || showAll) && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 8 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAll(!showAll);
                }}
              >
                {showAll
                  ? "Show recent only"
                  : `Show all ${lead.events.length}`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
