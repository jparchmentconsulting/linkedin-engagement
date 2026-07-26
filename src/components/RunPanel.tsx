"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import LocalDate from "./LocalDate";
import RunProgress from "./RunProgress";
import RunTrend from "./charts/RunTrend";
import { startPipelineRun } from "@/lib/runActions";
import type { PipelineRun } from "@/lib/types";

const statusPill: Record<PipelineRun["status"], { label: string; cls: string }> =
  {
    QUEUED: { label: "Queued", cls: "t-un" },
    RUNNING: { label: "Running", cls: "t-poss" },
    SUCCEEDED: { label: "Succeeded", cls: "t-strong" },
    FAILED: { label: "Failed", cls: "t-fail" },
  };

const runDateOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
} as const;

export interface RunGate {
  keysConfigured: boolean;
}

// The run table stops growing past this; older runs live in the trend chart.
const RECENT_RUNS = 5;

function isActive(run: PipelineRun | null): run is PipelineRun {
  return run != null && (run.status === "QUEUED" || run.status === "RUNNING");
}

export default function RunPanel({
  runs,
  gate,
}: {
  runs: PipelineRun[];
  gate: RunGate;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The run being watched live (starts from server data, updated by polling).
  const [liveRun, setLiveRun] = useState<PipelineRun | null>(
    () => runs.find(isActive) ?? null
  );
  const [justFinished, setJustFinished] = useState<PipelineRun | null>(null);
  const refreshed = useRef(false);

  const poll = useCallback(async (runId: string) => {
    const res = await fetch(`/api/runs/${runId}`);
    if (!res.ok) return;
    const run = (await res.json()) as PipelineRun;
    setLiveRun(run);
  }, []);

  useEffect(() => {
    if (!isActive(liveRun)) {
      // Terminal: refresh server data once so new leads appear.
      if (liveRun && !refreshed.current) {
        refreshed.current = true;
        setJustFinished(liveRun);
        router.refresh();
      }
      return;
    }
    refreshed.current = false;
    const interval = setInterval(() => poll(liveRun.id), 4000);
    return () => clearInterval(interval);
  }, [liveRun, poll, router]);

  const start = () => {
    setError(null);
    setJustFinished(null);
    startTransition(async () => {
      const result = await startPipelineRun();
      if (result.ok) {
        setLiveRun({
          id: result.runId,
          status: "QUEUED",
          startedAt: new Date().toISOString(),
          completedAt: null,
          postsSynced: null,
          postTitles: [],
          peopleFound: null,
          peopleEnriched: null,
          peopleScored: null,
          errorMessage: null,
        });
      } else {
        setError(result.error);
      }
    });
  };

  const running = isActive(liveRun);
  const disabled = pending || running || !gate.keysConfigured;
  const disabledReason = !gate.keysConfigured
    ? "Add APIFY_TOKEN and ANTHROPIC_API_KEY to .env first (see the README)."
    : running
      ? "A run is in progress."
      : undefined;

  const history = runs.filter((run) => run.id !== liveRun?.id);
  const recent = history.slice(0, RECENT_RUNS);
  const succeeded = runs.filter((run) => run.status === "SUCCEEDED");

  return (
    <div className="card full" style={{ marginBottom: 18 }}>
      <div className="run-head">
        <div style={{ flex: 1 }}>
          <h2 style={{ marginBottom: 4 }}>Run My Posts</h2>
          <div className="note" style={{ marginTop: 0 }}>
            Pulls your latest posts, captures everyone who engaged, enriches
            their profiles, and scores them against your ICP. Each run costs a
            few cents of Apify and Anthropic usage on your own keys.
          </div>
        </div>
        <button
          className="btn"
          onClick={start}
          disabled={disabled}
          title={disabledReason}
        >
          {pending || running ? "Running…" : "Run My Posts"}
        </button>
      </div>

      {!gate.keysConfigured && (
        <div className="note" role="status" style={{ marginTop: 12 }}>
          <b>Almost there.</b> Copy <code>.env.example</code> to{" "}
          <code>.env</code>, add your Apify and Anthropic API keys, and restart
          the app. The README covers where to get both.
        </div>
      )}

      {error && (
        <div className="error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {running && liveRun && <RunProgress run={liveRun} />}

      {justFinished?.status === "SUCCEEDED" && (
        <div className="saved" role="status" style={{ marginTop: 12 }}>
          <b>Run complete.</b> {justFinished.postsSynced ?? 0} posts synced ·{" "}
          {justFinished.peopleFound ?? 0} engagements captured ·{" "}
          {justFinished.peopleEnriched ?? 0} profiles enriched ·{" "}
          {justFinished.peopleScored ?? 0} people scored. New flags are at the
          top of your list.
        </div>
      )}
      {justFinished?.status === "FAILED" && (
        <div className="error" role="alert" style={{ marginTop: 12 }}>
          <b>Run failed.</b> {justFinished.errorMessage ?? "Unknown error."}{" "}
          Completed steps were kept; retrying continues where it left off.
        </div>
      )}

      {succeeded.length >= 2 && (
        <div style={{ marginTop: 14 }}>
          <RunTrend runs={runs} />
        </div>
      )}

      <div className="table-wrap">
        <table style={{ marginTop: 14 }} aria-label="Recent pipeline runs">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Status</th>
              <th scope="col">Posts synced</th>
              <th scope="col">People found</th>
              <th scope="col" className="hide-sm">
                Enriched
              </th>
              <th scope="col" className="hide-sm">
                Scored
              </th>
            </tr>
          </thead>
          <tbody>
            {liveRun && (
              <RunRow key={liveRun.id} run={liveRun} />
            )}
            {recent.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
            {runs.length === 0 && !liveRun && (
              <tr>
                <td colSpan={6} className="note">
                  No runs yet. Press Run My Posts to pull your first batch of
                  leads.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {history.length > RECENT_RUNS && (
        <div className="note">
          Showing the {RECENT_RUNS} most recent runs. The chart above covers
          every completed run.
        </div>
      )}
    </div>
  );
}

// Each run's date cell carries a small toggle listing the posts that run
// scraped, so "what was this run built on" lives right on the row.
function RunRow({ run }: { run: PipelineRun }) {
  const [open, setOpen] = useState(false);
  return (
    <tr>
      <td>
        <div>
          <LocalDate iso={run.startedAt} options={runDateOptions} />
        </div>
        {run.postTitles.length > 0 && (
          <>
            <button
              type="button"
              className="run-posts-toggle"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
            >
              <span className="chev" aria-hidden>
                {open ? "▾" : "▸"}
              </span>{" "}
              {run.postTitles.length} post
              {run.postTitles.length === 1 ? "" : "s"}
            </button>
            {open && (
              <ul className="run-posts-list">
                {run.postTitles.map((title, i) => (
                  <li key={i}>{title}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </td>
      <td>
        <span className={`pill ${statusPill[run.status].cls}`}>
          {statusPill[run.status].label}
        </span>
      </td>
      <td>{run.postsSynced ?? "–"}</td>
      <td>{run.peopleFound ?? "–"}</td>
      <td className="hide-sm">{run.peopleEnriched ?? "–"}</td>
      <td className="hide-sm">{run.peopleScored ?? "–"}</td>
    </tr>
  );
}
