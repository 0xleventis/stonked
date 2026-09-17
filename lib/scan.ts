import { fetchPoolsPage, fetchRecentLaunches, fetchRewards, type StonkfunPool } from "./stonkfunApi";
import { getScanCursor, setScanCursor, wasRecentlyChecked, markChecked, upsertDormant, removeDormant, type DormantEntry } from "./store";
import { mapWithConcurrency } from "./concurrency";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
// "Dormant" candidate pre-filter, applied BEFORE the expensive per-mint /api/rewards call (checking all
// 66k+ tokens individually isn't feasible — this cuts the field down to only tokens worth actually
// checking): old enough that any initial launch-day trading has settled, and low volume relative to its
// history. Widened from an original $25 cap after a real full pass (1,226 tokens checked) topped out at
// $53 of pending tax no matter how much more history got scanned — a token that accrued $100+ in tax
// before going quiet almost always still has *some* modest residual trading, which the tighter cap was
// wrongly excluding. $150 lets those through while still screening out anything genuinely active.
const DORMANT_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const DORMANT_MAX_VOLUME_USD = 150;
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

export interface EnrichedPool extends StonkfunPool {
  holderCount: number | null;
  pendingTaxUsd: number | null;
  lastPayoutAt: string | null;
}

/** Adds the same fee-tracking fields the dormant list shows (holders, pending tax, last payout) to a
 * recent-launches list — a brand new token can already be a reward launch accruing its first bit of tax.
 * Bounded concurrency since this list (a time window, not the full 66k-token history) can still run into
 * the hundreds on a busy day. Non-reward-launch tokens and any lookup failure just get nulls, not a
 * thrown error for the whole list. */
export async function enrichWithRewards(pools: StonkfunPool[], concurrency = 15): Promise<EnrichedPool[]> {
  return mapWithConcurrency(pools, concurrency, async (p): Promise<EnrichedPool> => {
    if (!p.isRewardLaunch) return { ...p, holderCount: null, pendingTaxUsd: null, lastPayoutAt: null };
    try {
      const rewards = await fetchRewards(p.mint);
      if (!rewards) return { ...p, holderCount: null, pendingTaxUsd: null, lastPayoutAt: null };
      return { ...p, holderCount: rewards.holderCount, pendingTaxUsd: rewards.pendingTaxUsd, lastPayoutAt: rewards.lastPayoutAt };
    } catch {
      return { ...p, holderCount: null, pendingTaxUsd: null, lastPayoutAt: null };
    }
  });
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
