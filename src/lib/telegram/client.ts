import { Bot, InlineKeyboard } from "grammy";
import { getEnv, requireEnv } from "@/lib/env";
import { splitTelegramMessages } from "@/lib/security/validate";

let bot: Bot | null = null;

export function getBot(): Bot {
  if (bot) return bot;
  bot = new Bot(requireEnv("TELEGRAM_BOT_TOKEN"));
  return bot;
}

export async function sendMessage(
  chatId: number,
  text: string,
  opts?: { reply_markup?: InlineKeyboard; parse_mode?: "HTML" | "Markdown" }
) {
  const b = getBot();
  const parts = splitTelegramMessages(text);
  let last = null as Awaited<ReturnType<typeof b.api.sendMessage>> | null;
  for (let i = 0; i < parts.length; i++) {
    try {
      last = await b.api.sendMessage(chatId, parts[i], {
        reply_markup: i === parts.length - 1 ? opts?.reply_markup : undefined,
        parse_mode: opts?.parse_mode,
        // older-compatible flag (avoids Bot API quirks with link_preview_options)
        disable_web_page_preview: true,
      } as Parameters<typeof b.api.sendMessage>[2]);
    } catch (err) {
      // Retry once without keyboard / parse_mode
      if (opts?.reply_markup || opts?.parse_mode) {
        last = await b.api.sendMessage(chatId, parts[i], {
          disable_web_page_preview: true,
        } as Parameters<typeof b.api.sendMessage>[2]);
      } else {
        throw err;
      }
    }
  }
  return last;
}

export async function answerCallback(id: string, text?: string) {
  await getBot().api.answerCallbackQuery(id, { text, show_alert: false });
}

export async function editMessage(
  chatId: number,
  messageId: number,
  text: string,
  reply_markup?: InlineKeyboard
) {
  await getBot().api.editMessageText(chatId, messageId, text, {
    reply_markup,
    disable_web_page_preview: true,
  } as Parameters<Bot["api"]["editMessageText"]>[3]);
}

export function webhookPath(): string {
  const secret = getEnv().TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return "/api/telegram/webhook";
  return `/api/telegram/webhook?secret=${encodeURIComponent(secret)}`;
}
