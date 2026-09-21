// Minimal Telegram Bot API client — no SDK, just the two HTTP calls this project actually needs.
// Create a bot via @BotFather (https://t.me/BotFather -> /newbot), put the token in TELEGRAM_BOT_TOKEN.
// TELEGRAM_CHAT_ID is whoever should receive alerts — message the bot once, then run
// `npx tsx scripts/rewardWatcher.ts --get-chat-id` to read it back via getUpdates.

const API_BASE = "https://api.telegram.org";

function requireToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set — create a bot via @BotFather and add it to .env.local.");
  return token;
}

export async function sendTelegramMessage(text: string, chatId?: string): Promise<void> {
  const token = requireToken();
  const targetChatId = chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!targetChatId) throw new Error("TELEGRAM_CHAT_ID not set — see lib/telegram.ts header for how to find it.");

  const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: targetChatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
}

/** Points Telegram at our deployed webhook so every message sent to the bot gets POSTed there. Run once
 * after deploying (or whenever the deployment URL changes) via scripts/setupTelegramWebhook.ts. */
export async function setTelegramWebhook(url: string, secretToken: string): Promise<void> {
  const token = requireToken();
  const res = await fetch(`${API_BASE}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secretToken }),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(`setWebhook failed: ${json.description}`);
}

/** Sends a photo (by URL — Telegram fetches it server-side, no upload needed) with an optional caption,
 * for announcements where a plain text message isn't enough (e.g. the official token broadcast, which
 * needs the actual logo attached, not just linked). Returns the sent message's ID — needed to pin it
 * afterward, since the Bot API has no way to look up a past message's ID after the fact. */
export async function sendTelegramPhoto(photoUrl: string, caption: string, chatId: string): Promise<number> {
  const token = requireToken();
  const res = await fetch(`${API_BASE}/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: "HTML" }),
  });
  const json = (await res.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
  if (!json.ok || !json.result) throw new Error(`Telegram sendPhoto failed: ${json.description}`);
  return json.result.message_id;
}

/** Pins a message in a chat. In a one-on-one chat with the bot (the only kind this project sends to),
 * Telegram lets a bot pin without needing any special admin rights — that's only required in groups and
 * channels. `disable_notification: true` since the send itself already notified the user; pinning is a
 * silent follow-up, not a second alert. */
export async function pinTelegramMessage(chatId: string, messageId: number): Promise<void> {
  const token = requireToken();
  const res = await fetch(`${API_BASE}/bot${token}/pinChatMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, disable_notification: true }),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(`Telegram pinChatMessage failed: ${json.description}`);
}

export interface BotCommand {
  command: string; // no leading slash, lowercase, 1-32 chars — per Telegram's own constraint
  description: string; // 3-256 chars
}

/** Registers the "/" command menu Telegram shows natively next to the message box (and in the chat's
 * attachment menu) — the actual in-app widget, not just documentation in a help message. Safe to re-run;
 * it fully replaces whatever command list was set before. */
export async function setTelegramCommands(commands: BotCommand[]): Promise<void> {
  const token = requireToken();
  const res = await fetch(`${API_BASE}/bot${token}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(`setMyCommands failed: ${json.description}`);
}

/** Reads back recent chats that have messaged the bot — used once, interactively, to find TELEGRAM_CHAT_ID
 * (there's no other way to learn it; Telegram doesn't let a bot look up a chat ID from a username alone). */
export async function fetchRecentTelegramChats(): Promise<{ chatId: string; name: string; lastMessage: string }[]> {
  const token = requireToken();
  const res = await fetch(`${API_BASE}/bot${token}/getUpdates?limit=20`);
  if (!res.ok) throw new Error(`Telegram getUpdates failed: ${res.status}`);
  const json = (await res.json()) as {
    result: { message?: { chat: { id: number; first_name?: string; title?: string; username?: string }; text?: string } }[];
  };
  const seen = new Map<string, { chatId: string; name: string; lastMessage: string }>();
  for (const update of json.result) {
    const chat = update.message?.chat;
    if (!chat) continue;
    seen.set(String(chat.id), {
      chatId: String(chat.id),
      name: chat.title ?? chat.username ?? chat.first_name ?? "unknown",
      lastMessage: update.message?.text ?? "",
    });
  }
  return Array.from(seen.values());
}
