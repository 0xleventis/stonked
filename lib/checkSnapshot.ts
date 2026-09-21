import { getWithheldStatus, fetchHarvestActivity } from "./solana";
import { fetchRewards, fetchPoolByMint } from "./stonkfunApi";

export type SnapshotCheckResult =
  | {
      ok: true;
      held: boolean;
      balance: number;
      withheldAmount: number;
      /** True if this account has nothing sitting withheld right now — meaning any tax it ever accrued
       * has already been swept into the mint's reserve (included in some past harvest). False + held
       * true means there's real tax on this account no harvest has caught yet. Meaningless (always
       * false) if `held` is false. */
      swept: boolean;
      mintName: string;
      mintSymbol: string;
      lastHarvestAt: string | null;
      lastWithdrawAt: string | null;
      lastWithdrawSig: string | null;
      pendingUsd: number;
      payoutCount: number;
    }
  | { ok: false; error: string };

/** The direct, verifiable answer to "was my wallet included in a recent harvest for this token" — same
 * check done by hand repeatedly earlier in this project's own research (e.g. confirming J152's Fartinu
 * account showed zero withheld after being swept). Combines the per-account withheld-tax state with the
 * mint's own on-chain harvest/withdraw history for context on timing. */
export async function checkSnapshotInclusion(wallet: string, mint: string): Promise<SnapshotCheckResult> {
  const rewards = await fetchRewards(mint).catch(() => undefined);
  if (!rewards) return { ok: false, error: "That doesn't look like a stonk.fun reward-launch token." };

  const [status, activity, pool] = await Promise.all([
    getWithheldStatus(wallet, mint),
    fetchHarvestActivity(mint, 20).catch(() => []),
    fetchPoolByMint(mint).catch(() => undefined),
  ]);

  const lastHarvest = activity.find((e) => e.type === "harvest");
  const lastWithdraw = activity.find((e) => e.type === "withdraw");

  return {
    ok: true,
    held: status.held,
    balance: status.balance,
    withheldAmount: status.withheldAmount,
    swept: status.held && status.withheldAmount === 0,
    mintName: pool?.name ?? mint,
    mintSymbol: pool?.symbol ?? "?",
    lastHarvestAt: lastHarvest?.blockTime ?? null,
    lastWithdrawAt: lastWithdraw?.blockTime ?? null,
    lastWithdrawSig: lastWithdraw?.signature ?? null,
    pendingUsd: rewards.pendingUsd,
    payoutCount: rewards.payoutCount,
  };
}

export function formatSnapshotCheck(wallet: string, mint: string, result: SnapshotCheckResult): string {
  if (!result.ok) return `❌ ${result.error}`;

  if (!result.held) {
    return [
      `<b>${result.mintName}</b> (${result.mintSymbol})`,
      `<code>${wallet}</code>`,
      "",
      "You don't currently hold this token — nothing to snapshot.",
    ].join("\n");
  }

  const lines = [`<b>${result.mintName}</b> (${result.mintSymbol})`, `<code>${wallet}</code>`, ""];
  lines.push(`Balance: ${result.balance.toLocaleString()}`);

  if (result.swept) {
    lines.push("✅ <b>Included</b> — your account has zero tax sitting withheld right now, meaning it's already been swept into a harvest.");
  } else {
    lines.push(`⏳ <b>Not yet included</b> — you still have ${result.withheldAmount.toLocaleString()} tokens of withheld tax sitting on your account, untouched by any harvest so far.`);
  }

  if (result.lastWithdrawAt) {
    lines.push(`\nMost recent withdraw+swap on this token: ${result.lastWithdrawAt}`);
  } else {
    lines.push("\nNo withdraw+swap seen in this mint's recent history (or it happened further back than the last 20 fee-related transactions).");
  }
  lines.push(`Currently pending platform-wide: $${result.pendingUsd.toFixed(2)} · payouts so far: ${result.payoutCount}`);

  return lines.join("\n");
}
