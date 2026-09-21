// Manual re-broadcast: sends the official $STONKED token address + logo (pinned) to every chat that has
// ever messaged the bot, or to specific chat IDs passed as args. New users get this automatically now
// (see lib/stonkedAnnouncement.ts + the webhook's isNewChat check) — this script is for re-sending to
// people who joined before that was wired up, or for a deliberate re-announcement later.

import { config } from "dotenv";
config({ path: ".env.local" });

import { allKnownChats } from "../lib/store";
import { sendStonkedWelcome } from "../lib/stonkedAnnouncement";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Optional: pass specific chat IDs as args to broadcast only to those, instead of everyone —
  // `npx tsx scripts/broadcastStonked.ts 123 456`.
  const argChats = process.argv.slice(2).filter(Boolean);
  const chats = argChats.length > 0 ? argChats : await allKnownChats();
  if (chats.length === 0) {
    console.log("No known chats to broadcast to yet.");
    return;
  }
  console.log(`Broadcasting to ${chats.length} chat(s)...`);
  let sent = 0;
  let failed = 0;
  for (const chatId of chats) {
    if (await sendStonkedWelcome(chatId)) sent++;
    else failed++;
    await sleep(350); // Telegram allows ~1 msg/sec per chat and ~30/sec globally — this stays well under both.
  }
  console.log(`Done. Sent: ${sent}, failed: ${failed}.`);
}

main();
