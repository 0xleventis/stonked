// Polls stonk.fun's reward state + each mint's own on-chain fee-event history for every reward-launch
// token the watched wallets (see lib/walletWatch.ts) currently hold, and pushes a Telegram message the
// moment stonk.fun's own withdraw-authority actually withdraws-and-swaps a mint's harvested tax (the
// step that locks in who gets paid next) — not just when someone (including our own crank) harvests it.
//
// Usage:
//   npx tsx scripts/rewardWatcher.ts                 — run the poll loop forever (Ctrl+C to stop)
//   npx tsx scripts/rewardWatcher.ts --once           — single poll cycle, then exit (good for a cron)
//   npx tsx scripts/rewardWatcher.ts --get-chat-id    — message your bot once on Telegram first, then
//                                                        run this to read back its chat ID for .env.local
//
// Requires in .env.local: TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_CHAT_ID (from --get-chat-id),
// KV_REST_API_URL/KV_REST_API_TOKEN (already set up for this project), and ideally SOLANA_RPC_URL
// pointed at a real provider — the public RPC rate-limits hard under this kind of repeated polling.

import { config } from "dotenv";
config({ path: ".env.local" });

import { pollAndNotify, watchedWallets } from "../lib/walletWatch";
import { fetchRecentTelegramChats } from "../lib/telegram";

const POLL_INTERVAL_MS = Number(process.env.WATCH_POLL_INTERVAL_MS ?? 90_000);

async function getChatIdMode() {
  const chats = await fetchRecentTelegramChats();
  if (chats.length === 0) {
    console.log("No messages found yet. Open your bot in Telegram, send it any message, then re-run this.");
    return;
  }
  console.log("Recent chats that have messaged your bot:");
  for (const c of chats) {
    console.log(`  chat_id=${c.chatId}  name="${c.name}"  last="${c.lastMessage}"`);
  }
  console.log("\nAdd the right one as TELEGRAM_CHAT_ID in .env.local.");
}

async function runOnce() {
  console.log(`[${new Date().toISOString()}] polling ${watchedWallets().length} wallet(s)...`);
  const events = await pollAndNotify();
  if (events.length === 0) {
    console.log("  no new harvest/withdraw events this cycle.");
  } else {
    for (const e of events) {
      console.log(`  ${e.type === "withdraw" ? "💱 withdrawn+swapped" : "🌾 harvested"}: ${e.symbol} (${e.mint}) tx=${e.signature}`);
    }
    console.log(`  sent Telegram notification for ${events.length} event(s).`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--get-chat-id")) return getChatIdMode();

  if (args.includes("--once")) {
    await runOnce();
    return;
  }

  console.log(`Watching wallets: ${watchedWallets().join(", ")}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s. Ctrl+C to stop.\n`);
  for (;;) {
    try {
      await runOnce();
    } catch (err) {
      console.error("poll cycle failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main();
