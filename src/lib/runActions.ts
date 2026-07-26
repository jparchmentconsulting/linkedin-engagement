"use server";

import { getAccount } from "./account";
import { db } from "./db";
import { failStaleRuns } from "./pipeline";

export type StartRunResult =
  | { ok: true; runId: string }
  | { ok: false; error: string };

// Trigger & guardrails: keys must be configured, one run at a time. This only
// enqueues — the durable worker (worker.ts) picks the QUEUED row up within
// seconds and executes it, so the run survives restarts. The UI polls
// /api/runs/[id] for progress.
export async function startPipelineRun(): Promise<StartRunResult> {
  if (!process.env.APIFY_TOKEN || !process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error:
        "Add your APIFY_TOKEN and ANTHROPIC_API_KEY to .env, then restart the app. See the README for where to get them.",
    };
  }

  const account = await getAccount();
  if (!account) {
    return { ok: false, error: "Finish the setup screen first." };
  }

  await failStaleRuns(account.id);

  const active = await db.pipelineRun.findFirst({
    where: { accountId: account.id, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (active) {
    return { ok: false, error: "A run is already in progress." };
  }

  const run = await db.pipelineRun.create({
    data: { accountId: account.id, status: "QUEUED" },
  });

  return { ok: true, runId: run.id };
}
