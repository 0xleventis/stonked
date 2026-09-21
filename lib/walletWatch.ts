import { getWalletHoldings, fetchHarvestActivity } from "./solana";
import { fetchRewards, fetchPoolByMint } from "./stonkfunApi";
import {
  getWatchState,
  setWatchState,
  allSubscribedTokens,
  allSubscribedWallets,
  tokenSubscribers,
  walletSubscribers,
} from "./store";
import { mapWithConcurrency } from "./concurrency";
import { sendTelegramMessage } from "./telegram";

// The wallets this project has been tracking all session — override via WATCH_WALLETS
// (comma-separated) in .env.local without touching code. Anything self-service-subscribed via the
// Telegram bot (see app/api/telegram/webhook) is layered on top of these, not a replacement for them.
const DEFAULT_WATCHED_WALLETS = [
  "J152BBRTW8FJ5APogd5LNDBNErDv565mwAKTLmXwdwGP",
  "9egnKdkPM2nNznR5Trigg9CQfGUseetcsiE1JRY2kCyB",
  "DYuAXkpuuWx6UfdrGiJBxD8v4uTrkWVuGn5pNzB4gDRA",
];

export function defaultWatchedWallets(): string[] {
  const fromEnv = process.env.WATCH_WALLETS;
  if (!fromEnv) return DEFAULT_WATCHED_WALLETS;
  return fromEnv.split(",").map((w) => w.trim()).filter(Boolean);
}

// Kept for the CLI script's startup log — the *set of wallets actually polled* now also includes
// self-service subscriptions, computed fresh inside pollOnce() since it needs a Redis round-trip.
export const watchedWallets = defaultWatchedWallets;

export interface FeeEvent {
  mint: string;
  name: string;
  symbol: string;
  type: "harvest" | "withdraw";
  signature: string;
  triggeredBy: string | null;
  pendingTaxUsd: number;
  pendingUsd: number;
  payoutCount: number;
  /** Chat IDs to notify for this specific event — the default TELEGRAM_CHAT_ID (if set) for the
   * hardcoded default wallets, plus anyone who self-subscribed to this mint directly or to a wallet
   * that's currently holding it. */
  recipients: string[];
}

/** For every mint any tracked wallet (default + self-service-subscribed) currently holds, plus every
 * directly-subscribed token, works out who should be notified about it. A mint can have multiple
 * recipients (several people watching the same wallet, or watching both the wallet AND the token
 * directly — de-duplicated per mint via the Set). */
async function collectTargets(): Promise<Map<string, Set<string>>> {
  const defaultChatId = process.env.TELEGRAM_CHAT_ID;
  const [subscribedWallets, subscribedTokens] = await Promise.all([allSubscribedWallets(), allSubscribedTokens()]);

  const allWallets = Array.from(new Set([...defaultWatchedWallets(), ...subscribedWallets]));
  const targets = new Map<string, Set<string>>();

  const addRecipient = (mint: string, chatId: string | undefined | null) => {
    if (!chatId) return;
    if (!targets.has(mint)) targets.set(mint, new Set());
    targets.get(mint)!.add(chatId);
  };

  await mapWithConcurrency(allWallets, 12, async (wallet) => {
    const holdings = await getWalletHoldings(wallet).catch(() => []);
    const isDefault = defaultWatchedWallets().includes(wallet);
    const subscribers = isDefault ? [] : await walletSubscribers(wallet).catch(() => []);
    for (const h of holdings) {
      if (isDefault) addRecipient(h.mint, defaultChatId);
      for (const chatId of subscribers) addRecipient(h.mint, chatId);
    }
  });

  await mapWithConcurrency(subscribedTokens, 12, async (mint) => {
    const subscribers = await tokenSubscribers(mint).catch(() => []);
    for (const chatId of subscribers) addRecipient(mint, chatId);
  });

  return targets;
}

/** One poll cycle: for every mint currently in scope (see collectTargets), checks stonk.fun's reward
 * state and the mint's own on-chain fee-event history, and returns whatever NEW harvest/withdraw events
 * appeared since the last cycle (empty for a mint's first-ever check — that call only establishes the
 * baseline, so newly-watched mint doesn't immediately fire an alert for history that predates it). */
export async function pollOnce(): Promise<FeeEvent[]> {
  const targets = await collectTargets();
  const newEvents: FeeEvent[] = [];

  // Concurrency and per-mint RPC cost both matter here: this whole function has to finish inside one
  // cron invocation's time limit, and that limit gets tighter to hit as more wallets/tokens get
  // subscribed (confirmed live: at 16 mints in scope this was intermittently blowing past the old 60s
  // ceiling, causing genuinely stale "new" alerts once a stalled mint's state finally caught up several
  // cycles late). scanLimit 10 (down from 20) roughly halves the RPC calls fetchHarvestActivity makes per
  // mint; wrapping the whole per-mint body in try/catch keeps one bad mint (a thrown error anywhere not
  // already individually caught, e.g. Redis) from aborting every other still-in-flight mint in this batch
  // — mapWithConcurrency's Promise.all would otherwise reject the whole call on a single uncaught throw.
  await mapWithConcurrency(Array.from(targets.keys()), 12, async (mint) => {
    const recipients = Array.from(targets.get(mint) ?? []);
    if (recipients.length === 0) return;

    try {
      const [rewards, pool, activity, state] = await Promise.all([
        fetchRewards(mint).catch(() => undefined),
        fetchPoolByMint(mint).catch(() => undefined),
        fetchHarvestActivity(mint, 10).catch(() => []),
        getWatchState(mint),
      ]);
      if (!rewards) return; // not (or no longer) a reward launch — nothing to watch here

      const newestHarvest = activity.find((e) => e.type === "harvest");
      const newestWithdraw = activity.find((e) => e.type === "withdraw");
      const isFirstRun = state.lastHarvestSig === null && state.lastWithdrawSig === null;

      const makeEvent = (type: "harvest" | "withdraw", ev: NonNullable<typeof newestHarvest>): FeeEvent => ({
        mint,
        name: pool?.name ?? mint,
        symbol: pool?.symbol ?? "?",
        type,
        signature: ev.signature,
        triggeredBy: ev.triggeredBy,
        pendingTaxUsd: rewards.pendingTaxUsd,
        pendingUsd: rewards.pendingUsd,
        payoutCount: rewards.payoutCount,
        recipients,
      });

      if (!isFirstRun && newestHarvest && newestHarvest.signature !== state.lastHarvestSig) {
        newEvents.push(makeEvent("harvest", newestHarvest));
      }
      if (!isFirstRun && newestWithdraw && newestWithdraw.signature !== state.lastWithdrawSig) {
        newEvents.push(makeEvent("withdraw", newestWithdraw));
      }

      await setWatchState(mint, {
        lastHarvestSig: newestHarvest?.signature ?? state.lastHarvestSig,
        lastWithdrawSig: newestWithdraw?.signature ?? state.lastWithdrawSig,
      });
    } catch (err) {
      console.error(`pollOnce: mint ${mint} failed, skipping this cycle:`, err instanceof Error ? err.message : err);
    }
  });

  return newEvents;
}

function formatEvent(e: FeeEvent): string {
  const label = e.type === "harvest" ? "🌾 Harvested" : "💱 Withdrawn + swapped";
  const lines = [
    `<b>${label}</b> — ${e.name} (${e.symbol})`,
    `<code>${e.mint}</code>`,
    `tx: https://solscan.io/tx/${e.signature}`,
  ];
  if (e.type === "withdraw") {
    lines.push(`Now awaiting delivery: $${e.pendingUsd.toFixed(2)} · payouts so far: ${e.payoutCount}`);
  } else {
    lines.push(`Pending tax remaining: $${e.pendingTaxUsd.toFixed(2)}`);
  }
  return lines.join("\n");
}

/** Runs one poll cycle and sends each recipient a single Telegram message covering every event from
 * this cycle that's relevant to THEM (one message per burst per person, not one per token, and never
 * showing someone an event for an address they didn't ask to watch). */
export async function pollAndNotify(): Promise<FeeEvent[]> {
  const events = await pollOnce();
  if (events.length === 0) return events;

  const byChat = new Map<string, FeeEvent[]>();
  for (const e of events) {
    for (const chatId of e.recipients) {
      if (!byChat.has(chatId)) byChat.set(chatId, []);
      byChat.get(chatId)!.push(e);
    }
  }

  await Promise.all(
    Array.from(byChat.entries()).map(([chatId, chatEvents]) =>
      sendTelegramMessage(chatEvents.map(formatEvent).join("\n\n"), chatId).catch((err) =>
        console.error(`failed to notify chat ${chatId}:`, err instanceof Error ? err.message : err)
      )
    )
  );

  return events;
}
