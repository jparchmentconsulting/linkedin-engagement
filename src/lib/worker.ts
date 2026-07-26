import "server-only";
import { db } from "./db";
import { errText, logError } from "./errors";
import { executePipelineRun } from "./pipeline";

// Durable pipeline worker. The PipelineRun table IS the job queue: the
// trigger (runActions.ts) only writes a QUEUED row, and this worker — started
// once per server boot from src/instrumentation.ts — claims it, executes it,
// and heartbeats while it works. If the process dies mid-run the heartbeat
// goes stale and the next boot's sweep re-queues the run, which resumes
// idempotently (every pipeline write is an upsert on a natural key). A run
// that keeps getting interrupted is capped at MAX_ATTEMPTS and failed loudly
// instead of looping forever.
//
// Runs execute one at a time — queued runs wait their turn instead of
// hammering Apify in parallel.

const POLL_MS = 10_000;
const HEARTBEAT_MS = 30_000;
// Heartbeats land every 30s; three minutes of silence means the process that
// claimed the run is gone, not slow.
const STALE_MS = 3 * 60_000;
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A RUNNING row whose heartbeat went stale was orphaned by a restart. Re-queue
// it (idempotent steps resume where they left off) unless it has already been
// interrupted MAX_ATTEMPTS times — then fail it loudly, because something
// about the run itself is killing the process.
async function sweepInterrupted(): Promise<void> {
  const staleCutoff = new Date(Date.now() - STALE_MS);
  const stale = await db.pipelineRun.findMany({
    where: {
      status: "RUNNING",
      OR: [
        { heartbeatAt: { lt: staleCutoff } },
        { heartbeatAt: null, startedAt: { lt: staleCutoff } },
      ],
    },
  });

  for (const run of stale) {
    if (run.attempts >= MAX_ATTEMPTS) {
      const { count } = await db.pipelineRun.updateMany({
        where: { id: run.id, status: "RUNNING" },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: `Run was interrupted ${MAX_ATTEMPTS} times in a row and gave up. Completed steps were kept; a manual retry continues where it left off.`,
        },
      });
      if (count === 1) {
        logError({
          source: "run",
          runId: run.id,
          message: `Run was interrupted ${MAX_ATTEMPTS} times and marked failed. If restarts aren't the cause, something in this run is crashing the server.`,
        });
      }
    } else {
      // Guard on the heartbeat we read so a concurrent instance that already
      // reclaimed (and re-heartbeat) the run isn't yanked back to QUEUED.
      const { count } = await db.pipelineRun.updateMany({
        where: { id: run.id, status: "RUNNING", heartbeatAt: run.heartbeatAt },
        data: { status: "QUEUED" },
      });
      if (count === 1) {
        logError({
          source: "run",
          runId: run.id,
          message: `Run was interrupted (likely a restart) and re-queued automatically (attempt ${run.attempts} of ${MAX_ATTEMPTS}). Completed steps are kept; it resumes where it left off.`,
        });
      }
    }
  }
}

// Atomically claim the oldest QUEUED run. The updateMany status guard is the
// lock: if a concurrent instance claims first, count is 0 and we simply
// don't run it.
async function claimNextRun(): Promise<string | null> {
  const next = await db.pipelineRun.findFirst({
    where: { status: "QUEUED" },
    orderBy: { startedAt: "asc" },
    select: { id: true },
  });
  if (!next) return null;
  const { count } = await db.pipelineRun.updateMany({
    where: { id: next.id, status: "QUEUED" },
    data: {
      status: "RUNNING",
      heartbeatAt: new Date(),
      attempts: { increment: 1 },
    },
  });
  return count === 1 ? next.id : null;
}

async function executeWithHeartbeat(runId: string): Promise<void> {
  const beat = setInterval(() => {
    db.pipelineRun
      .updateMany({
        where: { id: runId, status: "RUNNING" },
        data: { heartbeatAt: new Date() },
      })
      .catch(() => {}); // a missed beat is fine; six in a row is the signal
  }, HEARTBEAT_MS);
  try {
    await executePipelineRun(runId);
  } finally {
    clearInterval(beat);
  }
}

async function loop(): Promise<void> {
  for (;;) {
    try {
      await sweepInterrupted();
      let runId = await claimNextRun();
      while (runId) {
        await executeWithHeartbeat(runId);
        runId = await claimNextRun();
      }
    } catch (error) {
      // Never let the loop die — a dead worker strands every future run.
      console.error(`[worker] poll failed: ${errText(error)}`);
    }
    await sleep(POLL_MS);
  }
}

// Same globalThis-singleton pattern as db.ts so dev hot-reload can't stack
// multiple loops.
const globalForWorker = globalThis as unknown as { pipelineWorker?: boolean };

export function startPipelineWorker(): void {
  // PIPELINE_WORKER=0 is the kill switch (e.g. to inspect the database
  // without a worker touching it). Never start during the production build.
  if (process.env.PIPELINE_WORKER === "0") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (globalForWorker.pipelineWorker) return;
  globalForWorker.pipelineWorker = true;
  console.log("[worker] pipeline worker started");
  void loop();
}
