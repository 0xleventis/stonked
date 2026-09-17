import { NextResponse } from "next/server";
import { scanRecent } from "../../../lib/scan";

// Live — no caching, since "recent" is inherently time-sensitive and the underlying calls are cheap
// (the rolling feed plus a handful of paginated reads, not a full-history scan).
export async function GET() {
  try {
    const pools = await scanRecent();
    return NextResponse.json({ pools });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to fetch recent launches." }, { status: 502 });
  }
}
