import { Redis } from "@upstash/redis";

// Same Upstash Redis convention the other Bruno repos use (KV_REST_API_URL/TOKEN — the variable names
// Vercel's Upstash Marketplace integration actually injects). This can point at either a fresh Redis
// instance for this project or the same one o1-creator-bot/Hoodbrunos use — either works, since every
// key here is namespaced under "stuckstonks:" and won't collide with their keys.

let client: Redis | undefined;
function redis(): Redis {
  if (!client) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) throw new Error("KV_REST_API_URL/KV_REST_API_TOKEN not set — attach an Upstash Redis integration.");
    client = new Redis({ url, token });
  }
  return client;
}

export interface DormantEntry {
  mint: string;
  symbol: string;
  name: string;
  imageUrl?: string;
  createdAt: string;
  lastPayoutAt: string | null;
  volume24hUsd: number;
  pendingTaxUsd: number;
  pendingUsd: number;
  holderCount: number;
  quoteSymbol: string;
  checkedAt: string;
}

const DORMANT_KEY = "stuckstonks:dormant"; // Redis hash: mint -> JSON(DormantEntry)
const CURSOR_KEY = "stuckstonks:scan-cursor"; // last fully-scanned page number (sort=newest)
const SEEN_KEY_PREFIX = "stuckstonks:seen:"; // per-mint "already checked, skip for N hours" marker

export async function getScanCursor(): Promise<number> {
  const v = await redis().get<number>(CURSOR_KEY);
  return v ?? 1;
}

export async function setScanCursor(page: number): Promise<void> {
  await redis().set(CURSOR_KEY, page);
}

/** True if this mint was checked (for dormancy/pending-fees) within the last `ttlHours` — avoids
 * re-hitting stonk.fun's /api/rewards for the same low-value mint every single scan cycle. */
export async function wasRecentlyChecked(mint: string): Promise<boolean> {
  return (await redis().get(SEEN_KEY_PREFIX + mint)) !== null;
}

export async function markChecked(mint: string, ttlHours: number): Promise<void> {
  await redis().set(SEEN_KEY_PREFIX + mint, 1, { ex: Math.round(ttlHours * 3600) });
}

export async function upsertDormant(entry: DormantEntry): Promise<void> {
  await redis().hset(DORMANT_KEY, { [entry.mint]: JSON.stringify(entry) });
}

/** Removes a mint from the dormant list — used once its pending fees drop back near zero (e.g. someone
 * finally triggered a payout sweep) so the list only ever shows currently-stuck tokens. */
export async function removeDormant(mint: string): Promise<void> {
  await redis().hdel(DORMANT_KEY, mint);
}

export async function listDormant(): Promise<DormantEntry[]> {
  const raw = await redis().hgetall<Record<string, string>>(DORMANT_KEY);
  if (!raw) return [];
  return Object.values(raw)
    .map((v) => (typeof v === "string" ? (JSON.parse(v) as DormantEntry) : (v as unknown as DormantEntry)))
    .sort((a, b) => b.pendingTaxUsd - a.pendingTaxUsd);
}
