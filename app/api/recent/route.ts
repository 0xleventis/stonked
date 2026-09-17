import { scanRecent, enrichWithRewards } from "../../../lib/scan";
import { corsJson, corsOptions } from "../../../lib/cors";

export async function OPTIONS() {
  return corsOptions();
}

// Live — no caching, since "recent" is inherently time-sensitive. Enriched with the same fee-tracking
// fields the dormant list shows (a brand new token can already be accruing tax) — bounded concurrency
// inside enrichWithRewards keeps this from hammering stonk.fun even when a lot has launched recently.
// Only reward-launch tokens are surfaced at all (matches the dormant list, which is reward-only by
// construction) — a plain non-reward launch has no holder payout mechanic for this tool to track.
export async function GET() {
  try {
    const pools = await scanRecent();
    const rewardPools = pools.filter((p) => p.isRewardLaunch);
    const enriched = await enrichWithRewards(rewardPools);
    return corsJson({ pools: enriched });
  } catch (err) {
    return corsJson({ error: err instanceof Error ? err.message : "Failed to fetch recent launches." }, 502);
  }
}
