import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { pollAndNotify } from "../../../../lib/walletWatch";

// Same guard as /api/cron/scan — Vercel signs its own cron-triggered requests with
// `Authorization: Bearer <CRON_SECRET>`.
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  const provided = req.headers.get("authorization");
  if (!provided || !timingSafeStringEqual(provided, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await pollAndNotify();
  return NextResponse.json({ ok: true, newEvents: events.length });
}
