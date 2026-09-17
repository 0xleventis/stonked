import { scanRecent } from "../../../lib/scan";
import { corsJson, corsOptions } from "../../../lib/cors";

export async function OPTIONS() {
  return corsOptions();
}

// Live — no caching, since "recent" is inherently time-sensitive and the underlying calls are cheap
// (the rolling feed plus a handful of paginated reads, not a full-history scan).
export async function GET() {
  try {
    const pools = await scanRecent();
    return corsJson({ pools });
  } catch (err) {
    return corsJson({ error: err instanceof Error ? err.message : "Failed to fetch recent launches." }, 502);
  }
}
