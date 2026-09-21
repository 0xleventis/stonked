import { sendTelegramPhoto, pinTelegramMessage } from "./telegram";

// Shared between the webhook's automatic new-user welcome and scripts/broadcastStonked.ts's manual
// re-broadcast, so the two paths can never drift out of sync with each other.
export const STONKED_MINT = "CLrYstF4Fpae8JuiBnw4gGFWYBrCktyVuv1t6S5GhNTG";
// Pulled from the mint's own on-chain Token-2022 metadata URI
// (gateway.irys.xyz/43VPPST7A2fomJ8CEtvXE1s7NWYdfBqv2ovnJCw8Y56z), not guessed or re-hosted.
export const STONKED_LOGO_URL = "https://gateway.irys.xyz/FPrcND3ELn1mnezthUd51tbPWKdjW2KXo5pQWx8C9Ae6";

export const STONKED_CAPTION = [
  "📢 <b>Official $STONKED token</b>",
  "",
  "<b>Stonked Wojak (STONKED)</b>",
  `<code>${STONKED_MINT}</code>`,
  "",
  "This is the token for this exact site/bot — confirmed against its own on-chain metadata (external_url, X, and Telegram all point back here).",
  "",
  "🌐 https://stonkedwojak.fun/",
].join("\n");

/** Sends the official-token photo+caption to one chat and pins it — used both for a brand new user
 * (fired automatically from the webhook the moment recordKnownChat reports they're new) and for the
 * manual re-broadcast script. Never throws on failure — a pin/send hiccup for one user (e.g. they blocked
 * the bot) shouldn't break whatever triggered this. */
export async function sendStonkedWelcome(chatId: string): Promise<boolean> {
  try {
    const messageId = await sendTelegramPhoto(STONKED_LOGO_URL, STONKED_CAPTION, chatId);
    await pinTelegramMessage(chatId, messageId);
    return true;
  } catch (err) {
    console.error(`sendStonkedWelcome failed for chat ${chatId}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
