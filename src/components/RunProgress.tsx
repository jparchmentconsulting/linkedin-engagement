"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";
import type { PipelineRun } from "@/lib/types";

// The four pipeline steps, in order. A step's count field going from null to a
// number is the signal that step finished (pipeline.ts writes them in order).
export const RUN_STEPS = [
  { label: "Sync posts", field: "postsSynced", unit: "posts" },
  { label: "Pull engagers", field: "peopleFound", unit: "people" },
  { label: "Enrich profiles", field: "peopleEnriched", unit: "enriched" },
  { label: "Score against ICP", field: "peopleScored", unit: "scored" },
] as const;

// Shared live-progress view for a running pipeline run: a filling bar plus the
// per-step breakdown. Used by the client Run panel and the operator prospect
// run. Presentational only — the parent owns the polling and passes the latest
// run row.
export default function RunProgress({ run }: { run: PipelineRun }) {
  const done = RUN_STEPS.filter((step) => run[step.field] != null).length;
  const total = RUN_STEPS.length;
  const failed = run.status === "FAILED";
  const succeeded = run.status === "SUCCEEDED";
  const active = !failed && !succeeded; // QUEUED or RUNNING

  // Live elapsed clock: ticks each second while the run is active, freezes at
  // the run's own duration once it stops. Lets a full run be timed the same way
  // a re-score is ("424 leads in 22m").
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [active]);
  const startMs = Date.parse(run.startedAt);
  const endMs = run.completedAt ? Date.parse(run.completedAt) : now;
  const elapsed = Number.isNaN(startMs) ? null : endMs - startMs;

  // A large audience finishes its four steps on the first batch, then keeps
  // draining through auto-continued batches (the API reports the run active and
  // the scored count climbing until every batch is in). Hold the bar just short
  // of full and say what's happening rather than flipping to "complete".
  const draining = active && done === total;

  // The active step is counted as half-complete so the bar visibly advances the
  // moment a step starts, not only when its count lands (the first step can run
  // for minutes). On success it's full; on failure it stops where it got to.
  const filled = succeeded
    ? total
    : failed
      ? done
      : draining
        ? total - 0.2
        : Math.min(done + 0.5, total);
  const pct = Math.round((filled / total) * 100);

  // Which step is in flight (first one with no count yet), for the caption.
  const activeStep = active ? RUN_STEPS[Math.min(done, total - 1)] : null;
  const caption = succeeded
    ? "Run complete."
    : failed
      ? "Run stopped."
      : run.status === "QUEUED"
        ? "Queued, starting…"
        : draining
          ? "Scoring the rest of the audience…"
          : `Step ${done + 1} of ${total}: ${activeStep?.label}…`;

  return (
    <div className="run-progress" role="status" aria-label="Pipeline run progress">
      <div className="run-progress-head">
        <span className="run-progress-caption">{caption}</span>
        <span className="run-progress-pct">
          {elapsed != null && (
            <span className="run-progress-elapsed">
              ⏱ {formatDuration(elapsed)}
            </span>
          )}
          {pct}%
        </span>
      </div>
      <div
        className="run-progress-track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`run-progress-fill${active ? " active" : ""}${
            failed ? " failed" : ""
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="stepper">
        {RUN_STEPS.map((step, i) => {
          const value = run[step.field];
          const prevDone = i === 0 || run[RUN_STEPS[i - 1].field] != null;
          const state =
            value != null
              ? "done"
              : active && prevDone
                ? "active"
                : "pending";
          return (
            <div key={step.field} className={`step ${state}`}>
              <span className="dot" aria-hidden />
              <span className="step-label">{step.label}</span>
              <span className="step-count">
                {value != null
                  ? `${value} ${step.unit}`
                  : state === "active"
                    ? "working…"
                    : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
