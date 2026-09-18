import { NextRequest } from "next/server";
import { fetchHarvestActivity } from "../../../lib/solana";
import { corsJson, corsOptions } from "../../../lib/cors";

export async function OPTIONS() {
  return corsOptions();
}

// Live, on-demand lookup (same shape as /api/holders) — scans a mint's own recent transaction history
// for real on-chain fee-harvest events, independent of whatever stonk.fun's own lastPayoutAt reports.
export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint");
  if (!mint) return corsJson({ error: "mint query param is required" }, 400);

  try {
    const events = await fetchHarvestActivity(mint);
    return corsJson({ mint, events });
  } catch (err) {
    return corsJson({ error: err instanceof Error ? err.message : "Failed to read harvest activity." }, 502);
  }
}
