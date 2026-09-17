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
