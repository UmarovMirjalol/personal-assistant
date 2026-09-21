import { z } from "zod";

export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      date: z.number(),
      text: z.string().optional(),
      chat: z.object({ id: z.number(), type: z.string() }),
      from: z
        .object({
          id: z.number(),
          is_bot: z.boolean().optional(),
          first_name: z.string().optional(),
          last_name: z.string().optional(),
          username: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      from: z.object({
        id: z.number(),
        first_name: z.string().optional(),
        username: z.string().optional(),
      }),
      message: z
        .object({
          message_id: z.number(),
          chat: z.object({ id: z.number() }),
        })
        .optional(),
    })
    .optional(),
});

export function truncate(text: string, max = 3900): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 20)}\n\n…(обрезано)`;
}

export function splitTelegramMessages(text: string, max = 3900): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= max) {
      parts.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.4) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.4) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  return parts;
}

export function sanitizeUserText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, 4000);
}
