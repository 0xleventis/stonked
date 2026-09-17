import { NextRequest, NextResponse } from "next/server";
import { getTopHolders, resolveTokenAccountOwners } from "../../../lib/solana";

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint");
  if (!mint) return NextResponse.json({ error: "mint query param is required" }, { status: 400 });

  try {
    const top = await getTopHolders(mint);
    const owners = await resolveTokenAccountOwners(top.map((h) => h.address));
    const holders = top.map((h) => ({ ...h, owner: owners.get(h.address) ?? null }));
    return NextResponse.json({ mint, holders });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to read holders." }, { status: 502 });
  }
}
