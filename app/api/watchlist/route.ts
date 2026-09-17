import { NextRequest } from "next/server";
import { fetchWatchlist } from "../../../lib/scan";
import { corsJson, corsOptions } from "../../../lib/cors";

export async function OPTIONS() {
  return corsOptions();
}

// mints=<comma-separated base58 addresses> — the watchlist is user-curated and client-side (localStorage),
// never more than a handful of tokens, so this fetches fresh on every request rather than depending on
// the dormant scan's cache.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("mints") ?? "";
  const mints = raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (mints.length === 0) return corsJson({ pools: [] });
  if (mints.length > 50) return corsJson({ error: "Too many mints — max 50 at a time." }, 400);

  try {
    const pools = await fetchWatchlist(mints);
    return corsJson({ pools });
  } catch (err) {
    return corsJson({ error: err instanceof Error ? err.message : "Failed to fetch watchlist." }, 502);
  }
}
