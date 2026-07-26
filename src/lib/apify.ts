import "server-only";

// Minimal Apify REST client for the two actors the pipeline uses
// (Apify_Actors.md). All runs bill to the single shared APIFY_TOKEN.

const APIFY_BASE = "https://api.apify.com/v2";

function token(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN is not configured");
  return t;
}

export interface ApifyRun {
  id: string;
  status: string;
  defaultDatasetId: string;
}

async function apifyFetch(path: string, init?: RequestInit): Promise<unknown> {
  // Token goes in the Authorization header, never the URL — query strings
  // are the request part most likely to land in intermediate logs.
  const res = await fetch(`${APIFY_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token()}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function startActorRun(
  actorId: string, // e.g. "harvestapi~linkedin-profile-posts"
  input: Record<string, unknown>
): Promise<ApifyRun> {
  const data = (await apifyFetch(`/acts/${actorId}/runs`, {
    method: "POST",
    body: JSON.stringify(input),
  })) as { data: ApifyRun };
  return data.data;
}

export async function waitForRun(
  runId: string,
  { timeoutMs = 15 * 60_000, pollMs = 10_000 } = {}
): Promise<ApifyRun> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const data = (await apifyFetch(`/actor-runs/${runId}`)) as {
      data: ApifyRun;
    };
    const run = data.data;
    if (run.status === "SUCCEEDED") return run;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
      throw new Error(`Apify run ${runId} ended ${run.status}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Apify run ${runId} still ${run.status} after timeout`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export async function getDatasetItems(
  datasetId: string
): Promise<Record<string, unknown>[]> {
  return (await apifyFetch(
    `/datasets/${datasetId}/items?clean=true&limit=1000`
  )) as Record<string, unknown>[];
}

// Convenience: start, wait, read.
export async function runActor(
  actorId: string,
  input: Record<string, unknown>,
  opts?: { timeoutMs?: number }
): Promise<Record<string, unknown>[]> {
  const run = await startActorRun(actorId, input);
  const finished = await waitForRun(run.id, opts);
  return getDatasetItems(finished.defaultDatasetId);
}
