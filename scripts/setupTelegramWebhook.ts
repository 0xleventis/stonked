// One-time (or "whenever the deployment URL changes") setup: points Telegram at the deployed webhook
// route and confirms it's registered. Requires the app to already be deployed — Telegram needs a real
// public HTTPS URL, it can't call back to localhost.
//
// Usage: npx tsx scripts/setupTelegramWebhook.ts https://your-deployment.vercel.app

import { config } from "dotenv";
config({ path: ".env.local" });

import { randomBytes } from "node:crypto";
import { setTelegramWebhook } from "../lib/telegram";

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("Usage: npx tsx scripts/setupTelegramWebhook.ts <deployed-base-url>");
  process.exit(1);
}

const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? randomBytes(24).toString("hex");
if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
  console.log("No TELEGRAM_WEBHOOK_SECRET set — generated one below. Add it to .env.local AND your");
  console.log("Vercel project's env vars (it must match what the deployed webhook route checks):\n");
  console.log(`TELEGRAM_WEBHOOK_SECRET=${secret}\n`);
}

const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
await setTelegramWebhook(webhookUrl, secret);
console.log(`Webhook registered: ${webhookUrl}`);
