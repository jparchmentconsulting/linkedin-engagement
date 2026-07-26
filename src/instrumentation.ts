// Next.js instrumentation hook: register() runs once when a server instance
// boots, before it takes requests. This is what makes pipeline runs durable
// (improvement plan P2-6) — the worker it starts polls the PipelineRun queue,
// so runs live in the database instead of inside a request's after() callback
// and survive deploys/restarts. Imported dynamically per the Next.js guide so
// Node-only code never loads in the edge runtime.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startPipelineWorker } = await import("./lib/worker");
  startPipelineWorker();
}
