import { NextRequest, NextResponse } from "next/server";
import { sendTelegramMessage } from "../../../../lib/telegram";
import { subscribeAddress, unsubscribeAddress, describeSubscriptions, BASE58_ADDRESS_RE } from "../../../../lib/subscribe";
import { MAX_SUBSCRIPTIONS_PER_CHAT, getChatFlow, setChatFlow, clearChatFlow, recordKnownChat } from "../../../../lib/store";
import { checkSnapshotInclusion, formatSnapshotCheck } from "../../../../lib/checkSnapshot";
import { sendStonkedWelcome } from "../../../../lib/stonkedAnnouncement";

// Telegram calls this on every message sent to the bot, once registered via setWebhook (see
// scripts/setupTelegramWebhook.ts). Guarded by the same secret-token mechanism Telegram's own docs
// describe: setWebhook is called with `secret_token`, and Telegram echoes it back on every request as
// this header — anyone else POSTing here without knowing the secret gets rejected before touching Redis.
interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
}

const HELP_TEXT = [
  "Paste a wallet address or a reward-launch token mint and I'll alert you here the moment stonk.fun's own wallet harvests and swaps its withheld tax.",
  "",
  "/check — was a wallet included in the most recent harvest for a token? (walks you through it step by step)",
  "/list — see what you're watching",
  "/remove &lt;address&gt; — stop watching something",
  "/cancel — bail out of whatever step you're on",
  `Limit: ${MAX_SUBSCRIPTIONS_PER_CHAT} addresses per chat.`,
].join("\n");

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const provided = req.headers.get("x-telegram-bot-api-secret-token");
    if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await req.json()) as TelegramUpdate;
  const chatId = update.message?.chat.id;
  const text = update.message?.text?.trim();
  if (!chatId || !text) return NextResponse.json({ ok: true }); // nothing to act on (edited message, sticker, etc.)

  const chatIdStr = String(chatId);
  const isNewChat = await recordKnownChat(chatIdStr);
  if (isNewChat) await sendStonkedWelcome(chatIdStr); // never throws — a failed welcome shouldn't block their actual message below

  // An in-progress guided flow takes priority over normal command parsing — whatever the user just sent
  // is the answer to the question the bot's last message asked, not a fresh command.
  const flow = text === "/cancel" ? null : await getChatFlow(chatIdStr);

  if (text === "/cancel") {
    await clearChatFlow(chatIdStr);
    await sendTelegramMessage("Cancelled.", chatIdStr);
  } else if (flow?.type === "check" && flow.step === "wallet") {
    if (!BASE58_ADDRESS_RE.test(text)) {
      await sendTelegramMessage("That doesn't look like a valid Solana address. Send the wallet address to check, or /cancel.", chatIdStr);
    } else {
      await setChatFlow(chatIdStr, { type: "check", step: "mint", wallet: text });
      await sendTelegramMessage("Got it. Now send me the token mint address you want to check.", chatIdStr);
    }
  } else if (flow?.type === "check" && flow.step === "mint") {
    if (!BASE58_ADDRESS_RE.test(text)) {
      await sendTelegramMessage("That doesn't look like a valid Solana address. Send the token mint, or /cancel.", chatIdStr);
    } else {
      await clearChatFlow(chatIdStr);
      const result = await checkSnapshotInclusion(flow.wallet!, text);
      await sendTelegramMessage(formatSnapshotCheck(flow.wallet!, text, result), chatIdStr);
    }
  } else if (text === "/start" || text === "/help") {
    await sendTelegramMessage(HELP_TEXT, chatIdStr);
  } else if (text === "/list") {
    await sendTelegramMessage(await describeSubscriptions(chatIdStr), chatIdStr);
  } else if (text.startsWith("/check")) {
    // Still works as a one-shot for anyone who wants to skip the back-and-forth.
    const parts = text.slice("/check".length).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 2 && BASE58_ADDRESS_RE.test(parts[0]!) && BASE58_ADDRESS_RE.test(parts[1]!)) {
      const [wallet, mint] = parts as [string, string];
      const result = await checkSnapshotInclusion(wallet, mint);
      await sendTelegramMessage(formatSnapshotCheck(wallet, mint, result), chatIdStr);
    } else {
      await setChatFlow(chatIdStr, { type: "check", step: "wallet" });
      await sendTelegramMessage("Sure — send me the wallet address you want to check.", chatIdStr);
    }
  } else if (text.startsWith("/remove")) {
    const address = text.slice("/remove".length).trim();
    if (!address) {
      await sendTelegramMessage("Usage: /remove &lt;address&gt;", chatIdStr);
    } else {
      await unsubscribeAddress(address, chatIdStr);
      await sendTelegramMessage(`Stopped watching <code>${address}</code>.`, chatIdStr);
    }
  } else {
    const result = await subscribeAddress(text, chatIdStr);
    switch (result.kind) {
      case "token":
        await sendTelegramMessage(
          `✅ Watching <b>${result.name}</b> (${result.symbol})\n<code>${result.mint}</code>\nCurrent pending tax: $${result.pendingTaxUsd.toFixed(2)}`,
          chatIdStr
        );
        break;
      case "wallet":
        await sendTelegramMessage(
          `✅ Watching wallet <code>${result.wallet}</code>\nCurrently holding ${result.heldRewardMints} reward-launch token(s) — you'll be alerted for any of them.`,
          chatIdStr
        );
        break;
      case "limit-reached":
        await sendTelegramMessage(`You're already watching the max of ${MAX_SUBSCRIPTIONS_PER_CHAT} addresses. Use /remove to free one up.`, chatIdStr);
        break;
      case "not-a-reward-token-or-wallet":
        await sendTelegramMessage("That's a valid Solana address, but it's not a reward-launch token and doesn't look like an active wallet.", chatIdStr);
        break;
      case "not-an-address":
        await sendTelegramMessage(HELP_TEXT, chatIdStr);
        break;
    }
  }

  return NextResponse.json({ ok: true });
}
