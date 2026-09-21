import type { Reminder, User } from "@/lib/db/client";
import { createReminder, listReminders, cancelReminder } from "@/lib/db/reminders";
import { escapeHtml, formatCountdown } from "@/lib/telegram/html";

export const TIMER_RULE = "timer";
export const POMODORO_WORK = "pomodoro:work";
export const POMODORO_BREAK = "pomodoro:break";

export function isTimerReminder(r: Reminder): boolean {
  const rule = r.recurrence_rule ?? "";
  return rule === TIMER_RULE || rule.startsWith("pomodoro:");
}

export function parseTimerCommand(text: string): {
  seconds: number;
  label: string;
  kind: "timer" | "pomodoro";
} | null {
  const t = text.trim();

  // помодоро / pomodoro / фокус
  if (/^(?:помодоро|pomodoro|фокус)(?:\s|$)/i.test(t)) {
    const custom = t.match(/(\d+)\s*(?:мин|минут|m|min)?/i);
    const mins = custom ? Number(custom[1]) : 25;
    return {
      seconds: Math.max(1, mins) * 60,
      label: `Помодоро ${mins} мин`,
      kind: "pomodoro",
    };
  }

  // таймер 10 / timer 5m / засеки 15 минут / countdown 2 hours
  const m = t.match(
    /^(?:таймер|timer|засеки|засечь|countdown|сек(?:ундомер)?)\s*(?:на\s+)?(.+)$/i
  );
  if (!m) {
    // bare: "25 минут таймер" or "таймер на чай"
    const m2 = t.match(
      /^(?:через\s+)?(\d+)\s*(сек(?:унд[ыуа]?)?|s|мин(?:ут[ыуа]?)?|m|час(?:а|ов)?|h|ч)\s*(?:таймер|timer)?(?:\s+(.+))?$/i
    );
    if (m2 && /таймер|timer/i.test(t)) {
      return {
        seconds: toSeconds(Number(m2[1]), m2[2]),
        label: (m2[3] || "Таймер").trim(),
        kind: "timer",
      };
    }
    return null;
  }

  const rest = m[1].trim();
  const dur = rest.match(
    /^(\d+)\s*(сек(?:унд[ыуа]?)?|s|мин(?:ут[ыуа]?)?|m|час(?:а|ов)?|h|ч)?(?:\s+[.:,\-–]?\s*(.+))?$/i
  );
  if (!dur) return null;
  const n = Number(dur[1]);
  const unit = dur[2] || "мин";
  const label = (dur[3] || "Таймер").trim() || "Таймер";
  return { seconds: toSeconds(n, unit), label, kind: "timer" };
}

function toSeconds(n: number, unit: string): number {
  if (/^сек|^s$/i.test(unit)) return Math.max(1, n);
  if (/^час|^h|^ч/i.test(unit)) return Math.max(1, n) * 3600;
  return Math.max(1, n) * 60; // minutes default
}

export async function startTimer(
  user: User,
  opts: { seconds: number; label: string; kind?: "timer" | "pomodoro" }
): Promise<{ reminder: Reminder; endsAt: Date }> {
  const endsAt = new Date(Date.now() + opts.seconds * 1000);
  const kind = opts.kind ?? "timer";
  const reminder = await createReminder({
    userId: user.id,
    text: opts.label,
    remindAt: endsAt.toISOString(),
    recurrenceRule: kind === "pomodoro" ? POMODORO_WORK : TIMER_RULE,
  });
  return { reminder, endsAt };
}

export async function listActiveTimers(userId: string): Promise<Reminder[]> {
  const pending = await listReminders(userId, "pending");
  return pending.filter(isTimerReminder);
}

export async function cancelTimer(
  userId: string,
  idOrText: string
): Promise<number> {
  const timers = await listActiveTimers(userId);
  const matches = timers.filter(
    (r) =>
      r.id === idOrText ||
      r.id.startsWith(idOrText) ||
      r.text.toLowerCase().includes(idOrText.toLowerCase())
  );
  let n = 0;
  for (const m of matches) {
    n += await cancelReminder(userId, m.id);
  }
  return n;
}

export function formatTimerStarted(opts: {
  label: string;
  endsAt: Date;
  seconds: number;
  kind?: string;
}): string {
  const icon = opts.kind === "pomodoro" ? "🍅" : "⏱";
  const title = opts.kind === "pomodoro" ? "Помодоро запущен" : "Таймер запущен";
  return [
    `${icon} <b>${escapeHtml(title)}</b>`,
    "",
    `▸ ${escapeHtml(opts.label)}`,
    `▸ ${formatCountdown(opts.seconds)}`,
    `▸ до <b>${opts.endsAt.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}</b>`,
  ].join("\n");
}

export function formatActiveTimers(timers: Reminder[]): string {
  if (!timers.length) {
    return "⏱ <b>Активных таймеров нет</b>\n\nСкажи: <code>таймер 10 минут</code> или <code>помодоро</code>";
  }
  const now = Date.now();
  const lines = ["⏱ <b>Активные таймеры</b>", ""];
  for (const t of timers) {
    const left = Math.max(0, Math.floor((new Date(t.remind_at).getTime() - now) / 1000));
    const icon = (t.recurrence_rule ?? "").startsWith("pomodoro") ? "🍅" : "⏳";
    lines.push(
      `${icon} <b>${escapeHtml(t.text)}</b> — осталось ${formatCountdown(left)}`
    );
  }
  return lines.join("\n");
}

export function formatTimerFired(r: Reminder): string {
  const pomodoro = (r.recurrence_rule ?? "").startsWith("pomodoro");
  if (pomodoro) {
    return [
      "🍅 <b>Помодоро закончился!</b>",
      "",
      escapeHtml(r.text),
      "",
      "Отдыхай 5 минут — или сразу следующий круг.",
    ].join("\n");
  }
  return [
    "⏱ <b>Время вышло!</b>",
    "",
    escapeHtml(r.text),
    "",
    "Готово. Что дальше?",
  ].join("\n");
}
