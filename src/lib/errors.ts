// Single funnel for backend failures: everything logs to stderr, where a
// self-hosted user actually looks (the terminal running `npm run dev`).
// Never throws — error logging must not create new errors. Whole-run
// failures additionally land on the PipelineRun row (errorMessage), which
// the run panel shows in the UI.

export function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function logError(entry: {
  source: string;
  message: string;
  accountId?: string | null;
  runId?: string | null;
  personId?: string | null;
}): void {
  console.error(
    `[${entry.source}]${entry.runId ? ` run=${entry.runId}` : ""}${entry.personId ? ` person=${entry.personId}` : ""} ${entry.message}`
  );
}
