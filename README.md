# Stonk Hounds

Surfaces two kinds of stonk.fun tokens (any token on the platform, not just ones launched via Bruno):

- **Recent** — launched in the last 4 hours.
- **Dormant + pending fees** — stonk.fun's "reward launch" tokens apply a transfer tax that's meant to
  be swept into automatic payouts to holders. Some tokens go quiet (no trading, no sweep) while tax
  revenue keeps sitting there unclaimed — this tab surfaces those.

## Why this needs a background scanner

stonk.fun has no bulk "pending fees" endpoint. Checking every token (66,000+ and growing) one at a time
via their per-mint `/api/rewards` endpoint isn't feasible to do live on every page load. Instead,
`app/api/cron/scan/route.ts` runs on a schedule (every 5 minutes via `vercel.json`), each run walking a
handful of pages of stonk.fun's full history (oldest-first via a persisted cursor in Redis), cheaply
pre-filtering by age + 24h volume before spending an actual `/api/rewards` call on a candidate, and
storing anything with meaningful pending tax revenue. The dormant list fills in gradually over many scan
cycles, not instantly.

## Setup

```
npm install
cp .env.example .env.local
```

- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — an Upstash Redis instance (Vercel Marketplace integration,
  or reuse credentials from another project — keys here are namespaced under `stuckstonks:` so they
  won't collide).
- `CRON_SECRET` — required for `/api/cron/scan` to accept requests; Vercel sets this automatically once
  a cron job is configured for the project.
- `SOLANA_RPC_URL` — optional, defaults to the public Solana RPC, which rate-limits quickly. Set a real
  provider (Helius etc.) for the holders lookup to be reliable.

Run one scan cycle locally without waiting for the cron:

```
npm run scan-once
```

Run the site:

```
npm run dev
```
