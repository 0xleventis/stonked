import { listDormant } from "../../../lib/store";
import { corsJson, corsOptions } from "../../../lib/cors";

export async function OPTIONS() {
  return corsOptions();
}

// Reads whatever the background cron scan (app/api/cron/scan) has accumulated so far — this list fills
// in gradually as the crawler works through stonk.fun's full history, not instantly on first load.
export async function GET() {
  try {
    const entries = await listDormant();
    return corsJson({ entries });
  } catch (err) {
    return corsJson({ error: err instanceof Error ? err.message : "Failed to read dormant list." }, 502);
  }
}
