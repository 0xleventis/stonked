import { listDormant, dormantCount } from "../../../lib/store";
import { corsJson, corsOptions } from "../../../lib/cors";

export async function OPTIONS() {
  return corsOptions();
}

// Reads whatever the background cron scan (app/api/cron/scan) has accumulated so far — this list fills
// in gradually as the crawler works through stonk.fun's full history, not instantly on first load.
// Capped to the 500 highest-pendingTaxUsd entries (listDormant's default) — the scan has been running
// long enough to accumulate 22,000+, and shipping all of them made the browser table unusable.
export async function GET() {
  try {
    const [entries, totalCount] = await Promise.all([listDormant(), dormantCount()]);
    return corsJson({ entries, totalCount });
  } catch (err) {
    return corsJson({ error: err instanceof Error ? err.message : "Failed to read dormant list." }, 502);
  }
}
