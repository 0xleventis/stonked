import { getWalletHoldings } from "./solana";
import { fetchRewards, fetchPoolByMint } from "./stonkfunApi";
import {
  addTokenSubscription,
  addWalletSubscription,
  removeSubscription,
  listChatSubscriptions,
  chatSubscriptionCount,
  MAX_SUBSCRIPTIONS_PER_CHAT,
} from "./store";

// Base58 (Bitcoin alphabet — no 0, O, I, l), and Solana addresses are always 32-44 characters. Doesn't
// prove the address exists or is well-formed on-chain (that's what the two lookups below are for) — just
// filters out obviously-not-an-address text before spending an API/RPC call on it.
export const BASE58_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type SubscribeResult =
  | { kind: "token"; mint: string; name: string; symbol: string; pendingTaxUsd: number }
  | { kind: "wallet"; wallet: string; heldRewardMints: number }
  | { kind: "not-an-address" }
  | { kind: "not-a-reward-token-or-wallet" }
  | { kind: "limit-reached" };

/** Figures out whether a pasted address is a reward-launch token mint or a wallet, and subscribes the
 * given chat to it. Tries token first (one HTTP call) since that's the cheaper/faster check; only falls
 * back to treating it as a wallet if it isn't a reward-launch mint. A syntactically valid address that's
 * neither (a non-reward token, a closed/empty account, or just an unrelated real address) comes back as
 * "not-a-reward-token-or-wallet" rather than silently subscribing to nothing. */
export async function subscribeAddress(address: string, chatId: string): Promise<SubscribeResult> {
  if (!BASE58_ADDRESS_RE.test(address)) return { kind: "not-an-address" };

  if ((await chatSubscriptionCount(chatId)) >= MAX_SUBSCRIPTIONS_PER_CHAT) return { kind: "limit-reached" };

  const rewards = await fetchRewards(address).catch(() => undefined);
  if (rewards) {
    const pool = await fetchPoolByMint(address).catch(() => undefined);
    await addTokenSubscription(address, chatId);
    return { kind: "token", mint: address, name: pool?.name ?? address, symbol: pool?.symbol ?? "?", pendingTaxUsd: rewards.pendingTaxUsd };
  }

  // Not a reward-launch mint — see if it's at least a real wallet (getTokenAccountsByOwner succeeds,
  // even with zero holdings, for any syntactically valid pubkey; it only throws for a malformed one).
  try {
    const holdings = await getWalletHoldings(address);
    const rewardCheck = await Promise.all(holdings.map((h) => fetchRewards(h.mint).catch(() => undefined)));
    const heldRewardMints = rewardCheck.filter(Boolean).length;
    await addWalletSubscription(address, chatId);
    return { kind: "wallet", wallet: address, heldRewardMints };
  } catch {
    return { kind: "not-a-reward-token-or-wallet" };
  }
}

export async function unsubscribeAddress(address: string, chatId: string): Promise<void> {
  await removeSubscription(address, chatId);
}

export async function describeSubscriptions(chatId: string): Promise<string> {
  const { tokens, wallets } = await listChatSubscriptions(chatId);
  if (tokens.length === 0 && wallets.length === 0) return "You're not watching anything yet — paste a wallet or token address to start.";
  const lines: string[] = [];
  if (tokens.length > 0) {
    lines.push("<b>Tokens:</b>");
    lines.push(...tokens.map((m) => `  <code>${m}</code>`));
  }
  if (wallets.length > 0) {
    lines.push("<b>Wallets:</b>");
    lines.push(...wallets.map((w) => `  <code>${w}</code>`));
  }
  return lines.join("\n");
}
