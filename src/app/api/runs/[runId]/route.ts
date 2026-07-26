import { NextResponse } from "next/server";
import { getAccount } from "@/lib/account";
import { db } from "@/lib/db";

// Polled by the run panel every few seconds while a run is active.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const account = await getAccount();
  const { runId } = await params;
  const run = await db.pipelineRun.findUnique({ where: { id: runId } });
  if (!run || !account || run.accountId !== account.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Report the whole SESSION, not just this one run. A big audience finishes in
  // the first run's scrape + first enrich/score batch, then keeps draining via
  // auto-continued processOnly runs that carry the origin run's id as
  // batchGroupId. The bar must stay active until every batch is done, so the
  // status here is the session's: RUNNING while any batch is queued/running,
  // and the enrich/score counts sum across the chain so they climb as it drains.
  const key = run.batchGroupId ?? run.id;
  const sessionRuns = await db.pipelineRun.findMany({
    where: {
      accountId: run.accountId,
      OR: [{ id: key }, { batchGroupId: key }],
    },
  });

  const anyActive = sessionRuns.some(
    (r) => r.status === "QUEUED" || r.status === "RUNNING"
  );
  const anyFailed = sessionRuns.some((r) => r.status === "FAILED");
  const status = anyActive ? "RUNNING" : anyFailed ? "FAILED" : "SUCCEEDED";

  // Scrape counts live only on the origin run (id === key); enrich/score are
  // summed across the chain.
  const origin = sessionRuns.find((r) => r.id === key) ?? run;
  const sum = (field: "peopleEnriched" | "peopleScored") =>
    sessionRuns.some((r) => r[field] != null)
      ? sessionRuns.reduce((acc, r) => acc + (r[field] ?? 0), 0)
      : null;

  const startedAt = new Date(
    Math.min(...sessionRuns.map((r) => r.startedAt.getTime()))
  ).toISOString();
  const completedAt =
    status === "SUCCEEDED"
      ? new Date(
          Math.max(...sessionRuns.map((r) => r.completedAt?.getTime() ?? 0))
        ).toISOString()
      : null;

  return NextResponse.json({
    id: run.id,
    status,
    startedAt,
    completedAt,
    postsSynced: origin.postsSynced,
    postTitles: Array.isArray(origin.syncedPostTitles)
      ? origin.syncedPostTitles.filter((t) => typeof t === "string")
      : [],
    peopleFound: origin.peopleFound,
    peopleEnriched: sum("peopleEnriched"),
    peopleScored: sum("peopleScored"),
    errorMessage: sessionRuns.find((r) => r.errorMessage)?.errorMessage ?? null,
    batches: sessionRuns.length,
  });
}
