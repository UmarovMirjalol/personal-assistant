import type { EmailSummary, Task, Reminder } from "@/lib/db/client";
import { escapeHtml, bold, formatCountdown, ruWhen } from "@/lib/telegram/html";
import { isTimerReminder } from "@/lib/reminders/timers";

const PRIORITY_ICON = {
  high: "🔴",
  medium: "🟡",
  low: "⚪",
} as const;

export function formatEmailNotification(input: {
  fromName?: string | null;
  fromEmail?: string | null;
  subject?: string | null;
  summary: Pick<
    EmailSummary,
    | "purpose"
    | "what_they_want"
    | "action_required"
    | "deadline"
    | "urgency"
    | "summary"
    | "uncertain"
    | "priority"
  >;
}): string {
  const from =
    input.fromName && input.fromEmail
      ? `${input.fromName} <${input.fromEmail}>`
      : input.fromName || input.fromEmail || "Unknown";

  const priority = (input.summary.priority || "medium") as keyof typeof PRIORITY_ICON;
  const icon = PRIORITY_ICON[priority] ?? "🟡";
  const urgency = (input.summary.urgency || priority || "medium").toString().toUpperCase();

  const wants = (input.summary.what_they_want ?? [])
    .filter(Boolean)
    .map((w) => `• ${escapeHtml(w)}`)
    .join("\n");

  const lines = [
    `${icon} ${bold(`Новое письмо · ${urgency}`)}`,
    "",
    `От: ${escapeHtml(from)}`,
    `Тема: ${bold(input.subject ?? "(без темы)")}`,
    "",
    `<i>${escapeHtml(input.summary.purpose || input.summary.summary || "неясно")}</i>`,
  ];

  if (input.summary.summary && input.summary.summary !== input.summary.purpose) {
    lines.push("", escapeHtml(input.summary.summary));
  }

  if (wants) {
    lines.push("", bold("Что хотят:"), wants);
  }

  const action = input.summary.action_required;
  if (action && action !== "None") {
    lines.push("", `⚡ ${bold("Действие:")} ${escapeHtml(action)}`);
  }

  if (input.summary.deadline && input.summary.deadline !== "Not specified") {
    lines.push(`📅 Дедлайн: ${escapeHtml(input.summary.deadline)}`);
  }

  return lines.join("\n");
}

export function formatEmailDigest(
  counts: { high: number; medium: number; low: number },
  importants: Array<{
    from_name: string | null;
    subject: string | null;
    purpose: string | null;
    priority: "high" | "medium" | "low";
  }>
): string {
  const lines = [
    "📬 " + bold("Почта"),
    "",
    `${PRIORITY_ICON.high} ${counts.high} важных · ${PRIORITY_ICON.medium} ${counts.medium} средних · ${PRIORITY_ICON.low} ${counts.low} прочих`,
  ];

  if (importants.length) {
    lines.push("", bold("На радаре:"));
    for (const e of importants.slice(0, 8)) {
      lines.push(
        `${PRIORITY_ICON[e.priority]} ${escapeHtml(e.from_name ?? "Unknown")} — ${escapeHtml(e.subject ?? "(без темы)")}`
      );
      if (e.purpose) lines.push(`   <i>${escapeHtml(e.purpose)}</i>`);
    }
  } else {
    lines.push("", "Важных писем нет — можно выдохнуть.");
  }

  return lines.join("\n");
}

export function formatTodayPlan(input: {
  scheduled: Task[];
  dueToday: Task[];
  unscheduled: Task[];
}): string {
  const lines = ["☀️ " + bold("Сегодня"), ""];

  if (input.scheduled.length === 0 && input.dueToday.length === 0 && input.unscheduled.length === 0) {
    lines.push("Пока пусто. Напиши план — разложу по слотам.");
    return lines.join("\n");
  }

  for (const t of input.scheduled) {
    const start = t.scheduled_start ? formatTime(t.scheduled_start) : "??";
    const end = t.scheduled_end ? formatTime(t.scheduled_end) : "";
    lines.push(
      end
        ? `<code>${start}–${end}</code> ${escapeHtml(t.title)}`
        : `<code>${start}</code> ${escapeHtml(t.title)}`
    );
  }

  if (input.dueToday.length) {
    lines.push("", bold("Дедлайны:"));
    for (const t of input.dueToday) {
      lines.push(
        `• ${escapeHtml(t.title)}${t.due_at ? ` <i>(до ${formatTime(t.due_at)})</i>` : ""}`
      );
    }
  }

  if (input.unscheduled.length) {
    lines.push("", bold("Открытые задачи:"));
    for (const t of input.unscheduled.slice(0, 10)) {
      const p = t.priority === "high" ? "🔴" : t.priority === "low" ? "⚪" : "🟡";
      lines.push(`${p} ${escapeHtml(t.title)}`);
    }
  }

  return lines.join("\n");
}

export function formatTasks(tasks: Task[]): string {
  if (!tasks.length) return "✅ " + bold("Нет открытых задач") + "\n\nНапиши: <code>задача …</code>";
  const lines = ["✅ " + bold("Задачи"), ""];
  for (const t of tasks) {
    const p = t.priority === "high" ? "🔴" : t.priority === "low" ? "⚪" : "🟡";
    const due = t.due_at ? ` — до ${escapeHtml(formatDate(t.due_at))}` : "";
    lines.push(`${p} ${escapeHtml(t.title)}${due}`);
  }
  return lines.join("\n");
}

export function formatReminders(reminders: Reminder[]): string {
  const timers = reminders.filter(isTimerReminder);
  const normal = reminders.filter((r) => !isTimerReminder(r));

  if (!reminders.length) {
    return (
      "⏰ " +
      bold("Пусто") +
      "\n\n<code>напомни через 20 минут …</code>\n<code>таймер 10 минут</code>\n<code>помодоро</code>"
    );
  }

  const lines: string[] = [];
  if (timers.length) {
    lines.push("⏱ " + bold("Таймеры"), "");
    const now = Date.now();
    for (const r of timers) {
      const left = Math.max(0, Math.floor((new Date(r.remind_at).getTime() - now) / 1000));
      const icon = (r.recurrence_rule ?? "").startsWith("pomodoro") ? "🍅" : "⏳";
      lines.push(`${icon} ${escapeHtml(r.text)} — ${formatCountdown(left)}`);
    }
  }
  if (normal.length) {
    if (lines.length) lines.push("");
    lines.push("⏰ " + bold("Напоминания"), "");
    for (const r of normal) {
      lines.push(`• <code>${escapeHtml(ruWhen(new Date(r.remind_at)))}</code> — ${escapeHtml(r.text)}`);
    }
  }
  return lines.join("\n");
}

export function formatReminderFired(text: string): string {
  return ["⏰ " + bold("Напоминание"), "", escapeHtml(text)].join("\n");
}

export function formatMorningBriefing(input: {
  taskCount: number;
  deadlineCount: number;
  importantEmailCount: number;
  importantEmails: Array<{ from: string; subject: string }>;
  priorities: string[];
}): string {
  const lines = [
    "☀️ " + bold("Доброе утро"),
    "",
    bold("На сегодня:"),
    `• ${input.taskCount} задач`,
    `• ${input.deadlineCount} дедлайн${input.deadlineCount === 1 ? "" : "ов"}`,
    `• ${input.importantEmailCount} важных писем`,
  ];

  if (input.importantEmails.length) {
    lines.push("", bold("Почта:"));
    for (const e of input.importantEmails.slice(0, 5)) {
      lines.push(`• ${escapeHtml(e.from)} — ${escapeHtml(e.subject)}`);
    }
  }

  if (input.priorities.length) {
    lines.push("", bold("Приоритеты:"));
    input.priorities.slice(0, 5).forEach((p, i) => {
      lines.push(`${i + 1}. ${escapeHtml(p)}`);
    });
  }

  return lines.join("\n");
}

export function formatWelcome(opts: {
  name?: string;
  gmail?: string | null;
  connected: boolean;
}): string {
  const hi = opts.name ? `Йо, ${escapeHtml(opts.name.split(" ")[0]!)}.` : "Йо.";
  return [
    `✨ ${bold("Aether")} — твой личный AI`,
    "",
    hi + " Заточен под жизнь + поступление в US.",
    "",
    bold("Фишки:"),
    "🎓 вузы / дедлайны / чеклисты",
    "📧 admissions-почта",
    "✍️ каркас эссе",
    "⏱ таймер / помодоро",
    "⏰ напоминания · ✅ задачи",
    "",
    opts.connected
      ? `Gmail: <code>${escapeHtml(opts.gmail ?? "ok")}</code>`
      : "Почту подключим, когда надо.",
  ].join("\n");
}

export function formatHelp(): string {
  return [
    "✨ " + bold("Как со мной говорить"),
    "",
    bold("🎓 Поступление"),
    "• <code>вузы</code> / <code>поступление сегодня</code>",
    "• <code>добавь вуз MIT дедлайн 2026-01-01</code>",
    "• <code>чеклист MIT</code> · <code>чеклист MIT essays</code>",
    "• <code>письма поступление</code>",
    "• <code>эссе идея …</code>",
    "",
    bold("Таймеры"),
    "• <code>таймер 10 минут</code> · <code>помодоро</code>",
    "",
    bold("Напоминания"),
    "• <code>напомни через 20 минут …</code>",
    "",
    bold("Остальное"),
    "• статус · задача … · что важного пришло?",
    "• research · монетка · реши: а или б",
  ].join("\n");
}

export function formatStatusCard(input: {
  tasks: number;
  reminders: number;
  timers: number;
  nextReminder?: string | null;
  gmailConnected: boolean;
}): string {
  return [
    "📊 " + bold("Статус"),
    "",
    `✅ задач: <b>${input.tasks}</b>`,
    `⏰ напоминаний: <b>${input.reminders}</b>`,
    `⏱ таймеров: <b>${input.timers}</b>`,
    input.nextReminder
      ? `⏭ следующее: <i>${escapeHtml(input.nextReminder)}</i>`
      : "⏭ следующего нет",
    "",
    input.gmailConnected ? "📧 Gmail на связи" : "📧 Gmail не подключён",
  ].join("\n");
}

export function formatCoinFlip(side: "орёл" | "решка"): string {
  return `🪙 ${bold("Монетка")}\n\nВыпало: <b>${side}</b>`;
}

export function formatDecide(options: string[], pick: string): string {
  return [
    "🎲 " + bold("Решаю за тебя"),
    "",
    ...options.map((o) => `• ${escapeHtml(o)}`),
    "",
    `Бери: ${bold(pick)}`,
  ].join("\n");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
  });
}
