// Open CORS for the read-only public endpoints (recent/dormant/holders) — there's no auth or user data
// here, just public stonk.fun/Solana state, and the dashboard is meant to be embeddable (e.g. a Claude
// Artifact calling this API from a different origin).
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

export function corsOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
