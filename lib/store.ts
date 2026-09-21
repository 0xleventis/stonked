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

// The scan has been running continuously for long enough to accumulate 22,000+ dormant entries with no
// eviction beyond a mint's own fees dropping back down — shipping all of them to the browser in one
// response made the frontend table unusably slow (and, at that count, some browsers throw outright
// rendering it — see page.tsx's maxPending fix). The 500 highest-pendingTaxUsd entries are the only ones
// anyone actually cares about; the long tail is fees too small to be worth a claim transaction anyway.
const LIST_DORMANT_LIMIT = 500;

/** Cheap total count (Redis HLEN, no fetch/parse of the actual entries) — so the UI can honestly show
 * "top 500 of 22,429" instead of silently capping with no indication there's more. */
export async function dormantCount(): Promise<number> {
  return redis().hlen(DORMANT_KEY);
}

export async function listDormant(limit = LIST_DORMANT_LIMIT): Promise<DormantEntry[]> {
  const raw = await redis().hgetall<Record<string, string>>(DORMANT_KEY);
  if (!raw) return [];
  return Object.values(raw)
    .map((v) => (typeof v === "string" ? (JSON.parse(v) as DormantEntry) : (v as unknown as DormantEntry)))
    .sort((a, b) => b.pendingTaxUsd - a.pendingTaxUsd)
    .slice(0, limit);
}

// --- Wallet-watch state (rewardWatcher.ts) ---
// Tracks the most recent harvest/withdraw signature this project has already alerted on for a given mint,
// so a restarted watcher doesn't re-notify for the same on-chain event twice.
const WATCH_KEY_PREFIX = "stuckstonks:watch:";

export interface WatchState {
  lastHarvestSig: string | null;
  lastWithdrawSig: string | null;
}

export async function getWatchState(mint: string): Promise<WatchState> {
  const v = await redis().get<WatchState>(WATCH_KEY_PREFIX + mint);
  return v ?? { lastHarvestSig: null, lastWithdrawSig: null };
}

export async function setWatchState(mint: string, state: WatchState): Promise<void> {
  await redis().set(WATCH_KEY_PREFIX + mint, state);
}

// --- Self-service subscriptions (Telegram webhook) ---
// Anyone who messages the bot a wallet or token address gets added here. Two independent kinds:
// a token subscription notifies that one chat for that one mint; a wallet subscription notifies for
// EVERY reward-launch mint that wallet is currently holding (recomputed each poll, same as the
// hardcoded default wallets already were). Set-shaped so the same address can be watched by many chats
// without duplicate entries, and a chat can be looked up to list/remove its own subscriptions.
const SUB_TOKEN_PREFIX = "stuckstonks:sub:token:"; // mint -> Set<chatId>
const SUB_WALLET_PREFIX = "stuckstonks:sub:wallet:"; // wallet -> Set<chatId>
const SUB_CHAT_TOKENS_PREFIX = "stuckstonks:sub:bychat:tokens:"; // chatId -> Set<mint>
const SUB_CHAT_WALLETS_PREFIX = "stuckstonks:sub:bychat:wallets:"; // chatId -> Set<wallet>
const SUB_ALL_TOKENS_KEY = "stuckstonks:sub:alltokens"; // Set<mint> — every directly-subscribed token
const SUB_ALL_WALLETS_KEY = "stuckstonks:sub:allwallets"; // Set<wallet> — every subscribed wallet

export const MAX_SUBSCRIPTIONS_PER_CHAT = 25;

export async function chatSubscriptionCount(chatId: string): Promise<number> {
  const [tokens, wallets] = await Promise.all([
    redis().scard(SUB_CHAT_TOKENS_PREFIX + chatId),
    redis().scard(SUB_CHAT_WALLETS_PREFIX + chatId),
  ]);
  return tokens + wallets;
}

export async function addTokenSubscription(mint: string, chatId: string): Promise<void> {
  await Promise.all([
    redis().sadd(SUB_TOKEN_PREFIX + mint, chatId),
    redis().sadd(SUB_CHAT_TOKENS_PREFIX + chatId, mint),
    redis().sadd(SUB_ALL_TOKENS_KEY, mint),
  ]);
}

export async function addWalletSubscription(wallet: string, chatId: string): Promise<void> {
  await Promise.all([
    redis().sadd(SUB_WALLET_PREFIX + wallet, chatId),
    redis().sadd(SUB_CHAT_WALLETS_PREFIX + chatId, wallet),
    redis().sadd(SUB_ALL_WALLETS_KEY, wallet),
  ]);
}

/** Removes one address (token or wallet — tries both, harmless no-op for whichever it isn't) from a
 * chat's subscriptions. Does NOT clean up the global alltokens/allwallets sets even if this was the last
 * subscriber — those sets are allowed to hold a stale address with zero subscribers; the poller just
 * does one wasted lookup for it until the next /remove or a TTL sweep, simpler than reference-counting. */
export async function removeSubscription(address: string, chatId: string): Promise<void> {
  await Promise.all([
    redis().srem(SUB_TOKEN_PREFIX + address, chatId),
    redis().srem(SUB_CHAT_TOKENS_PREFIX + chatId, address),
    redis().srem(SUB_WALLET_PREFIX + address, chatId),
    redis().srem(SUB_CHAT_WALLETS_PREFIX + chatId, address),
  ]);
}

export async function listChatSubscriptions(chatId: string): Promise<{ tokens: string[]; wallets: string[] }> {
  const [tokens, wallets] = await Promise.all([
    redis().smembers(SUB_CHAT_TOKENS_PREFIX + chatId),
    redis().smembers(SUB_CHAT_WALLETS_PREFIX + chatId),
  ]);
  return { tokens, wallets };
}

export async function allSubscribedTokens(): Promise<string[]> {
  return redis().smembers(SUB_ALL_TOKENS_KEY);
}

export async function allSubscribedWallets(): Promise<string[]> {
  return redis().smembers(SUB_ALL_WALLETS_KEY);
}

export async function tokenSubscribers(mint: string): Promise<string[]> {
  return redis().smembers(SUB_TOKEN_PREFIX + mint);
}

export async function walletSubscribers(wallet: string): Promise<string[]> {
  return redis().smembers(SUB_WALLET_PREFIX + wallet);
}

// --- Multi-step chat flows (Telegram webhook) ---
// Anything that needs more than one address (right now, just /check) walks the user through it one
// message at a time instead of demanding both args on one line — much easier on a phone keyboard. TTL'd
// so an abandoned flow (someone starts /check, gets distracted, and comes back a week later) doesn't
// silently resume and misinterpret an unrelated message as a wallet address.
const FLOW_KEY_PREFIX = "stuckstonks:flow:";
const FLOW_TTL_SECONDS = 10 * 60;

export interface ChatFlow {
  type: "check";
  step: "wallet" | "mint";
  wallet?: string;
}

export async function getChatFlow(chatId: string): Promise<ChatFlow | null> {
  return (await redis().get<ChatFlow>(FLOW_KEY_PREFIX + chatId)) ?? null;
}

export async function setChatFlow(chatId: string, flow: ChatFlow): Promise<void> {
  await redis().set(FLOW_KEY_PREFIX + chatId, flow, { ex: FLOW_TTL_SECONDS });
}

export async function clearChatFlow(chatId: string): Promise<void> {
  await redis().del(FLOW_KEY_PREFIX + chatId);
}

// --- Known chats (every chat that has ever messaged the bot) ---
// Separate from the subscription sets — someone can message the bot (e.g. just /start, or a message that
// didn't parse as an address) without ever subscribing to anything, and a broadcast needs to reach them
// too, not just active subscribers.
const KNOWN_CHATS_KEY = "stuckstonks:knownchats";

/** Returns true the first time a given chat is ever recorded (Redis SADD reports 1 element actually
 * added), false on every call after — lets a caller fire a one-time "welcome, new user" action without
 * maintaining any separate "have I already greeted this chat" bookkeeping. */
export async function recordKnownChat(chatId: string): Promise<boolean> {
  const added = await redis().sadd(KNOWN_CHATS_KEY, chatId);
  return added === 1;
}

export async function allKnownChats(): Promise<string[]> {
  return redis().smembers(KNOWN_CHATS_KEY);
}
