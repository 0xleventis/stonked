// Registers the native "/" command menu Telegram shows in the message box — run once, or again anytime
// the command list changes. Safe to re-run (fully replaces the previous list).

import { config } from "dotenv";
config({ path: ".env.local" });

import { setTelegramCommands } from "../lib/telegram";

await setTelegramCommands([
  { command: "start", description: "Show what this bot does" },
  { command: "help", description: "Show what this bot does" },
  { command: "check", description: "Was a wallet included in the last harvest for a token?" },
  { command: "list", description: "See what you're currently watching" },
  { command: "remove", description: "Stop watching an address — /remove <address>" },
  { command: "cancel", description: "Bail out of the current step" },
]);

console.log("Telegram command menu registered.");
