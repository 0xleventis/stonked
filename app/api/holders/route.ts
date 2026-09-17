import { NextRequest } from "next/server";
import { getTopHolders, resolveTokenAccountOwners } from "../../../lib/solana";
import { corsJson, corsOptions } from "../../../lib/cors";

export async function OPTIONS() {
  return corsOptions();
}

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint");
  if (!mint) return corsJson({ error: "mint query param is required" }, 400);

  try {
    const top = await getTopHolders(mint);
    const owners = await resolveTokenAccountOwners(top.map((h) => h.address));
    const holders = top.map((h) => ({ ...h, owner: owners.get(h.address) ?? null }));
    return corsJson({ mint, holders });
  } catch (err) {
    return corsJson({ error: err instanceof Error ? err.message : "Failed to read holders." }, 502);
  }
}
