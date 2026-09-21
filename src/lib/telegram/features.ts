import type { User } from "@/lib/db/client";
import { listTasks } from "@/lib/db/tasks";
import { listReminders } from "@/lib/db/reminders";
import { isGmailConnected } from "@/lib/gmail";
import { isTimerReminder } from "@/lib/reminders/timers";
import {
  formatStatusCard,
  formatCoinFlip,
  formatDecide,
} from "@/lib/telegram/format";
import { ruWhen } from "@/lib/telegram/html";

export async function buildStatusCard(user: User): Promise<string> {
  const [tasks, reminders] = await Promise.all([
    listTasks(user.id),
    listReminders(user.id, "pending"),
  ]);
  const timers = reminders.filter(isTimerReminder);
  const normal = reminders.filter((r) => !isTimerReminder(r));
  const next = normal[0] ?? timers[0];
  return formatStatusCard({
    tasks: tasks.length,
    reminders: normal.length,
    timers: timers.length,
    nextReminder: next
      ? `${next.text} · ${ruWhen(new Date(next.remind_at))}`
      : null,
    gmailConnected: isGmailConnected(user),
  });
}

export function coinFlip(): string {
  return formatCoinFlip(Math.random() < 0.5 ? "орёл" : "решка");
}

export function decideForMe(text: string): string | null {
  // реши: а или б / выбери между x и y / pick a or b
  const m =
    text.match(
      /^(?:реши|выбери|decide|pick)(?:\s+за\s+меня)?\s*:?\s*(.+)$/i
    ) || text.match(/^(?:монетка|подбрось|flip)$/i);
  if (!m) return null;
  if (/^(?:монетка|подбрось|flip)$/i.test(text.trim())) return coinFlip();

  const rest = (m[1] || "").trim();
  const parts = rest
    .split(/\s+или\s+|\s+or\s+|\/|,|;|\|/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const pick = parts[Math.floor(Math.random() * parts.length)]!;
  return formatDecide(parts, pick);
}

export function isStatusCommand(text: string): boolean {
  return /^(?:статус|status|как\s+дела\s+у\s+меня|сводка)$/i.test(text.trim());
}
