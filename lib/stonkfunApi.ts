// stonk.fun (www.stonkfun.xyz) has no published API docs — every endpoint here was found by downloading
// and grepping the site's own Next.js JS chunks (same discovery method o1-creator-bot's stonkfunClient.ts
// used), then confirmed live against real responses. Endpoints confirmed to actually exist:
//   GET /api/platform-pools?sort=<marketCap|newest|volume>&page=<n>&pageSize=<n>[&q=][&quoteMint=][&category=]
//     — paginated listing across the FULL history (confirmed live: 66,318 tokens / 2,211 pages at
//     pageSize=30 on 2026-09-17). sort/page/pageSize/q/quoteMint/category are the real param names, read
//     directly out of the board's own query-building code, not guessed.
//   GET /api/recent-launches — a short rolling live feed of the most recently created pools (no
//     pagination; confirmed to span only the last several minutes), polled by the site itself every 2s.
//   GET /api/rewards?mint=<mint> — per-token reward-launch state. Real fields observed on a live reward
//     token: isRewardLaunch, enabled, quoteMint/quoteSymbol/quoteDecimals, distributedRaw/distributedTokens/
//     distributedUsd (all-time), pendingTokens/pendingUsd (tiny — appears to be the residual not yet swept
//     since the last near-continuous payout sweep), pendingTaxTokens/pendingTaxUsd (the actually meaningful
//     number — accrued transfer-tax revenue not yet processed into a payout round at all), payoutCount,
//     holderCount, lastPayoutAt, transferTaxBps.
//   GET /api/asset/quote-logo/<mint> — logo image proxy, referenced as a relative URL in listings.

const API_BASE = "https://www.stonkfun.xyz/api";

export interface StonkfunPool {
  mint: string;
  pool: string;
  name: string;
  symbol: string;
  imageUrl?: string;
  createdAt: string;
  quoteMint: string;
  quoteSymbol: string;
  marketCapUsd: number;
  fdvUsd: number;
  volume24hUsd: number;
  liquidityUsd?: number;
  peakMarketCapUsd?: number;
  graduationProgress: number;
  status: string;
  graduatedAt: string | null;
  launchpad: string | null;
  isRewardLaunch: boolean;
  transferTaxBps?: number;
}

export interface PlatformPoolsPage {
  pools: StonkfunPool[];
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
}

export async function fetchPoolsPage(opts: { sort?: "marketCap" | "newest" | "volume"; page?: number; pageSize?: number }): Promise<PlatformPoolsPage> {
  const params = new URLSearchParams({
    sort: opts.sort ?? "newest",
    page: String(opts.page ?? 1),
    pageSize: String(opts.pageSize ?? 100),
  });
  const res = await fetch(`${API_BASE}/platform-pools?${params.toString()}`);
  if (!res.ok) throw new Error(`platform-pools failed: ${res.status}`);
  return (await res.json()) as PlatformPoolsPage;
}

/** Undefined if this mint has no pool at all (bad/unknown address) — a real, live-confirmed "not found"
 * case (empty `pools` array), not an error. Confirmed live: /api/platform-pools?mint=<mint> returns the
 * single matching pool, same shape as the paginated listing. */
export async function fetchPoolByMint(mint: string): Promise<StonkfunPool | undefined> {
  const res = await fetch(`${API_BASE}/platform-pools?mint=${encodeURIComponent(mint)}`);
  if (!res.ok) throw new Error(`platform-pools (by mint) failed: ${res.status}`);
  const json = (await res.json()) as PlatformPoolsPage;
  return json.pools[0];
}

export async function fetchRecentLaunches(): Promise<StonkfunPool[]> {
  const res = await fetch(`${API_BASE}/recent-launches`);
  if (!res.ok) throw new Error(`recent-launches failed: ${res.status}`);
  const json = (await res.json()) as { pools: StonkfunPool[] };
  return json.pools;
}

export interface StonkfunRewards {
  mint: string;
  isRewardLaunch: boolean;
  enabled: boolean;
  quoteMint: string;
  quoteSymbol: string;
  quoteDecimals: number;
  distributedTokens: number;
  distributedUsd: number;
  pendingTokens: number;
  pendingUsd: number;
  pendingTaxTokens: number;
  pendingTaxUsd: number;
  payoutCount: number;
  holderCount: number;
  lastPayoutAt: string | null;
  transferTaxBps: number;
}

/** Undefined for a token that was never a reward launch (isRewardLaunch: false, no pending-fee concept
 * applies) — not an error case. */
export async function fetchRewards(mint: string): Promise<StonkfunRewards | undefined> {
  const res = await fetch(`${API_BASE}/rewards?mint=${encodeURIComponent(mint)}`);
  if (!res.ok) throw new Error(`rewards failed for ${mint}: ${res.status}`);
  const json = (await res.json()) as StonkfunRewards;
  if (!json.isRewardLaunch) return undefined;
  return json;
}

export function stonkfunTokenPageUrl(mint: string): string {
  return `https://www.stonkfun.xyz/token/${mint}`;
}
