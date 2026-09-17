import { NextResponse } from "next/server";
import { listDormant } from "../../../lib/store";

// Reads whatever the background cron scan (app/api/cron/scan) has accumulated so far — this list fills
// in gradually as the crawler works through stonk.fun's full history, not instantly on first load.
export async function GET() {
  try {
    const entries = await listDormant();
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to read dormant list." }, { status: 502 });
  }
}
