import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { scanDormantBatch } from "../../../../lib/scan";

// Vercel signs its own cron-triggered requests with `Authorization: Bearer <CRON_SECRET>` — same guard
// convention as o1-creator-bot's api/_cronAuth.ts, reimplemented here since this is a separate Next.js
// App Router project (route handlers, not the api/*.ts Vercel Functions style that file lives in).
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

  const result = await scanDormantBatch();
  return NextResponse.json({ ok: true, ...result });
}
