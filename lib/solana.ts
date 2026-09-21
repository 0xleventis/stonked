// Plain JSON-RPC helpers — no @solana/web3.js dependency, matching the same convention Hoodbrunos'
// app/solanaClient.ts already uses. RPC_URL defaults to the public endpoint, which real-world testing
// elsewhere in this project family shows rate-limits quickly (confirmed live: a single getTokenLargestAccounts
// call got a 429) — set SOLANA_RPC_URL to a real provider (Helius etc.) before relying on this in
// production.

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = (await res.json()) as { result?: T; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data.result as T;
}

export interface TopHolder {
  address: string;
  amountRaw: string;
  decimals: number;
}

/** The 20 largest holders by raw balance — Solana's getTokenLargestAccounts is capped at 20 by the RPC
 * spec itself, not a choice made here. Good enough for "who actually matters for a payout", not a full
 * holder census (stonk.fun's own /api/rewards holderCount is the only source for the true total count). */
export async function getTopHolders(mint: string): Promise<TopHolder[]> {
  const result = await rpc<{ value: { address: string; amount: string; decimals: number }[] }>("getTokenLargestAccounts", [mint]);
  return result.value.map((v) => ({ address: v.address, amountRaw: v.amount, decimals: v.decimals }));
}

/** getTokenLargestAccounts returns TOKEN ACCOUNT addresses, not owner wallet addresses — a real,
 * easy-to-miss distinction (a holder can have multiple token accounts, or none, for the same mint).
 * getAccountInfo with jsonParsed encoding decodes the account and exposes its actual owner. */
export async function resolveTokenAccountOwners(tokenAccounts: string[]): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  await Promise.all(
    tokenAccounts.map(async (addr) => {
      const result = await rpc<{ value: { data: { parsed: { info: { owner: string } } } } | null }>("getAccountInfo", [addr, { encoding: "jsonParsed" }]);
      const owner = result.value?.data?.parsed?.info?.owner;
      if (owner) owners.set(addr, owner);
    })
  );
  return owners;
}

const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Every Token-2022 mint this wallet currently holds a nonzero balance of — the starting point for "which
 * tokens does this wallet need watching for", since a wallet's actual holdings change as it buys/sells. */
export async function getWalletHoldings(owner: string): Promise<{ mint: string; amount: number }[]> {
  const result = await rpc<{
    value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } } } }[];
  }>("getTokenAccountsByOwner", [owner, { programId: TOKEN_2022_PROGRAM_ID }, { encoding: "jsonParsed" }]);
  return result.value
    .map((v) => ({ mint: v.account.data.parsed.info.mint, amount: v.account.data.parsed.info.tokenAmount.uiAmount ?? 0 }))
    .filter((h) => h.amount > 0);
}

export interface WithheldStatus {
  held: boolean;
  balance: number;
  withheldAmount: number;
}

/** Whether a specific wallet's token account for this mint currently has anything sitting withheld
 * (uncollected transfer-tax not yet swept into the mint's reserve) — the direct, per-account answer to
 * "was I included in the last harvest": zero means whatever accrued on this account has already been
 * swept (this account WAS part of some past harvest, whether ours or anyone else's); nonzero means
 * there's tax sitting there untouched, so no harvest has caught this account since it last accrued any.
 * `held: false` if the wallet has no token account for this mint at all (never bought, or fully sold and
 * the account got closed) — a real, non-error case, not the same as "held with zero balance". */
export async function getWithheldStatus(owner: string, mint: string): Promise<WithheldStatus> {
  const result = await rpc<{
    value: {
      account: {
        data: {
          parsed: {
            info: {
              tokenAmount: { uiAmount: number | null; decimals: number };
              extensions?: { extension: string; state?: { withheldAmount?: number | string } }[];
            };
          };
        };
      };
    }[];
  }>("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);

  if (result.value.length === 0) return { held: false, balance: 0, withheldAmount: 0 };
  const info = result.value[0]!.account.data.parsed.info;
  const ext = info.extensions?.find((e) => e.extension === "transferFeeAmount");
  const raw = ext?.state?.withheldAmount;
  const withheldRaw = raw === undefined ? 0 : typeof raw === "string" ? Number(raw) : raw;
  const decimals = info.tokenAmount.decimals || 1;
  return {
    held: true,
    balance: info.tokenAmount.uiAmount ?? 0,
    withheldAmount: withheldRaw / 10 ** decimals,
  };
}

export interface HarvestEvent {
  signature: string;
  blockTime: string | null;
  type: "harvest" | "withdraw";
  triggeredBy: string | null;
}

// Token-2022's TransferFeeExtension parses to these instruction type names under jsonParsed encoding.
// harvestWithheldTokensToMint is confirmed live in this project's research — directly observed in real
// transactions, reading the *parsed* instruction type rather than matching raw log text (more reliable
// since these calls can appear nested inside inner instructions, e.g. bundled inside an unrelated swap,
// rather than top-level). It's genuinely permissionless: no authority needed, callable by anyone —
// observed happening as a side effect of unrelated trading bots' own swaps, not a dedicated distributor.
// withdrawWithheldTokensFromMint is the Token-2022 program's official counterpart instruction (per its
// published IDL) and DOES require the mint's withdraw-withheld authority to sign — a stronger signal that
// whoever controls that authority actually acted — but this project has not yet directly caught one
// on-chain to confirm the exact parsed-type spelling matches at runtime.
type ParsedInstruction = { parsed?: { type: string } };

function findFeeInstructionType(ins: ParsedInstruction[]): "harvest" | "withdraw" | null {
  for (const i of ins) {
    if (i.parsed?.type === "withdrawWithheldTokensFromMint") return "withdraw";
  }
  for (const i of ins) {
    if (i.parsed?.type === "harvestWithheldTokensToMint") return "harvest";
  }
  return null;
}

/** Scans a mint's own recent transaction history for real, on-chain evidence that its withheld
 * transfer-tax has actually been swept — independent of whatever stonk.fun's own API reports for
 * lastPayoutAt/payoutCount (traced live, in this project, to NOT always correspond to a discoverable
 * on-chain event around the reported timestamp). Bounded to the most recent `scanLimit` signatures — a
 * live, on-demand lookup (same shape as getTopHolders), not a full-history scan. */
export async function fetchHarvestActivity(mint: string, scanLimit = 20): Promise<HarvestEvent[]> {
  const sigs = await rpc<{ signature: string; blockTime: number | null; err: unknown }[]>("getSignaturesForAddress", [mint, { limit: scanLimit }]);
  const events: (HarvestEvent | null)[] = await Promise.all(
    sigs.map(async (s) => {
      if (s.err) return null;
      try {
        const tx = await rpc<{
          blockTime: number | null;
          meta: { innerInstructions?: { instructions: ParsedInstruction[] }[] };
          transaction: { message: { instructions: ParsedInstruction[]; accountKeys: { pubkey: string; signer: boolean }[] } };
        } | null>("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
        if (!tx) return null;
        const allIns = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap((ii) => ii.instructions)];
        const type = findFeeInstructionType(allIns);
        if (!type) return null;
        const feePayer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey ?? null;
        return {
          signature: s.signature,
          blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
          type,
          triggeredBy: feePayer,
        } as HarvestEvent;
      } catch {
        return null;
      }
    })
  );
  return events.filter((e): e is HarvestEvent => e !== null);
}
