import { fetchPoolsPage, fetchRecentLaunches, fetchRewards, type StonkfunPool } from "./stonkfunApi";
import { getScanCursor, setScanCursor, wasRecentlyChecked, markChecked, upsertDormant, removeDormant, type DormantEntry } from "./store";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
// "Dormant" candidate pre-filter, applied BEFORE the expensive per-mint /api/rewards call (checking all
// 66k+ tokens individually isn't feasible — this cuts the field down to only tokens worth actually
// checking): old enough that any initial launch-day trading has settled, and essentially no volume in
// the last 24h. Most of stonk.fun's history is dead/zero-liquidity tokens that will never clear the
// PENDING_TAX_USD_THRESHOLD below anyway, so this filter doesn't need to be perfectly tuned.
const DORMANT_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const DORMANT_MAX_VOLUME_USD = 25;
// Below this, not worth surfacing as "stuck" — real network/claim-transaction cost would eat it anyway.
const PENDING_TAX_USD_THRESHOLD = 5;
const RECHECK_TTL_HOURS = 12;

export async function scanRecent(maxAgeMs = FOUR_HOURS_MS): Promise<StonkfunPool[]> {
  const now = Date.now();
  const cutoff = now - maxAgeMs;
  const collected: StonkfunPool[] = [];

  // The live rolling feed covers only the last few minutes but needs zero pagination — free, so always
  // include it first (also catches anything created between this function's paginated reads below).
  try {
    const live = await fetchRecentLaunches();
    collected.push(...live.filter((p) => new Date(p.createdAt).getTime() >= cutoff));
  } catch {
    // Non-fatal — the paginated walk below covers the same ground, just with more requests.
  }

  const seen = new Set(collected.map((p) => p.mint));
  for (let page = 1; page <= 40; page++) {
    const { pools } = await fetchPoolsPage({ sort: "newest", page, pageSize: 100 });
    if (pools.length === 0) break;
    let anyInWindow = false;
    for (const p of pools) {
      if (new Date(p.createdAt).getTime() >= cutoff) {
        anyInWindow = true;
        if (!seen.has(p.mint)) {
          seen.add(p.mint);
          collected.push(p);
        }
      }
    }
    // Pages are sorted newest-first — once a whole page falls before the cutoff, every later page does too.
    if (!anyInWindow) break;
  }
  return collected.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export interface DormantScanResult {
  pagesScanned: number;
  candidatesChecked: number;
  newlyDormant: number;
  clearedFromDormant: number;
  cursorAdvancedTo: number;
}

/** One incremental slice of a continuous background sweep through stonk.fun's full history. Advances a
 * persisted page cursor each call, wrapping around once it passes the last page, so repeated calls (via
 * a cron) eventually cover every token ever launched without re-scanning everything each time. */
export async function scanDormantBatch(pagesPerRun = 8, maxRewardChecks = 40): Promise<DormantScanResult> {
  const now = Date.now();
  const startPage = await getScanCursor();
  let pagesScanned = 0;
  let candidatesChecked = 0;
  let newlyDormant = 0;
  let clearedFromDormant = 0;
  let totalPages = Infinity;
  let page = startPage;

  const candidates: StonkfunPool[] = [];
  for (; pagesScanned < pagesPerRun && candidates.length < maxRewardChecks * 3; pagesScanned++) {
    const { pools, pagination } = await fetchPoolsPage({ sort: "newest", page, pageSize: 100 });
    if (pagination) totalPages = pagination.totalPages;
    if (pools.length === 0) break;

    for (const p of pools) {
      if (!p.isRewardLaunch) continue;
      const ageMs = now - new Date(p.createdAt).getTime();
      if (ageMs < DORMANT_MIN_AGE_MS) continue;
      if ((p.volume24hUsd ?? 0) > DORMANT_MAX_VOLUME_USD) continue;
      candidates.push(p);
    }

    page = page + 1 > totalPages ? 1 : page + 1;
  }
  await setScanCursor(page);

  for (const p of candidates) {
    if (candidatesChecked >= maxRewardChecks) break;
    if (await wasRecentlyChecked(p.mint)) continue;
    candidatesChecked++;

    try {
      const rewards = await fetchRewards(p.mint);
      await markChecked(p.mint, RECHECK_TTL_HOURS);
      if (!rewards) continue;

      if (rewards.pendingTaxUsd >= PENDING_TAX_USD_THRESHOLD) {
        const entry: DormantEntry = {
          mint: p.mint,
          symbol: p.symbol,
          name: p.name,
          imageUrl: p.imageUrl,
          createdAt: p.createdAt,
          lastPayoutAt: rewards.lastPayoutAt,
          volume24hUsd: p.volume24hUsd ?? 0,
          pendingTaxUsd: rewards.pendingTaxUsd,
          pendingUsd: rewards.pendingUsd,
          holderCount: rewards.holderCount,
          quoteSymbol: rewards.quoteSymbol,
          checkedAt: new Date().toISOString(),
        };
        await upsertDormant(entry);
        newlyDormant++;
      } else {
        await removeDormant(p.mint);
        clearedFromDormant++;
      }
    } catch {
      // A single mint's rewards lookup failing (rate limit, transient error) shouldn't abort the whole
      // batch — markChecked wasn't called for it, so it's simply retried on a later cycle.
    }
  }

  return { pagesScanned, candidatesChecked, newlyDormant, clearedFromDormant, cursorAdvancedTo: page };
}
