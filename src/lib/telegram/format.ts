import type { EmailSummary, Task, Reminder } from "@/lib/db/client";

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

  const wants = (input.summary.what_they_want ?? [])
    .map((w) => `• ${w}`)
    .join("\n");

  const lines = [
    "📩 NEW EMAIL",
    "",
    `From: ${from}`,
    `Subject: ${input.subject ?? "(no subject)"}`,
    "",
    "PURPOSE:",
    input.summary.purpose ?? "Not clear",
    "",
    "WHAT THEY WANT FROM ME:",
    wants || "• None specified",
    "",
    `ACTION REQUIRED:\n${input.summary.action_required ?? "None"}`,
    "",
    `DEADLINE:\n${input.summary.deadline || "Not specified"}`,
    "",
    `URGENCY:\n${(input.summary.urgency || input.summary.priority || "medium").toUpperCase()}`,
    "",
    "SUMMARY:",
    input.summary.summary ?? "",
  ];

  if (input.summary.uncertain) {
    lines.push("", `UNCERTAIN:\n${input.summary.uncertain}`);
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
    "📬 EMAIL DIGEST",
    "",
    `${PRIORITY_ICON.high} ${counts.high} important`,
    `${PRIORITY_ICON.medium} ${counts.medium} medium`,
    `${PRIORITY_ICON.low} ${counts.low} low`,
  ];

  if (importants.length) {
    lines.push("", "IMPORTANT:");
    for (const e of importants.slice(0, 8)) {
      lines.push(
        `${PRIORITY_ICON[e.priority]} ${e.from_name ?? "Unknown"} — ${e.subject ?? "(no subject)"}`
      );
      if (e.purpose) lines.push(`   ${e.purpose}`);
    }
  } else {
    lines.push("", "Важных писем нет.");
  }

  return lines.join("\n");
}

export function formatTodayPlan(input: {
  scheduled: Task[];
  dueToday: Task[];
  unscheduled: Task[];
}): string {
  const lines = ["☀️ TODAY", ""];

  if (input.scheduled.length === 0 && input.dueToday.length === 0) {
    lines.push("Пока пусто. Напиши план — разложу по слотам.");
  }

  for (const t of input.scheduled) {
    const start = t.scheduled_start ? formatTime(t.scheduled_start) : "??";
    const end = t.scheduled_end ? formatTime(t.scheduled_end) : "";
    lines.push(end ? `${start}–${end} ${t.title}` : `${start} ${t.title}`);
  }

  if (input.dueToday.length) {
    lines.push("", "DEADLINES:");
    for (const t of input.dueToday) {
      lines.push(`• ${t.title}${t.due_at ? ` (до ${formatTime(t.due_at)})` : ""}`);
    }
  }

  if (input.unscheduled.length) {
    lines.push("", "OPEN TASKS:");
    for (const t of input.unscheduled.slice(0, 10)) {
      lines.push(`• ${t.title}`);
    }
  }

  return lines.join("\n");
}

export function formatTasks(tasks: Task[]): string {
  if (!tasks.length) return "✅ Нет открытых задач.";
  const lines = ["✅ TASKS", ""];
  for (const t of tasks) {
    const p = t.priority === "high" ? "🔴" : t.priority === "low" ? "⚪" : "🟡";
    const due = t.due_at ? ` — до ${formatDate(t.due_at)}` : "";
    lines.push(`${p} ${t.title}${due}`);
  }
  return lines.join("\n");
}

export function formatReminders(reminders: Reminder[]): string {
  if (!reminders.length) return "⏰ Нет активных напоминаний.";
  const lines = ["⏰ REMINDERS", ""];
  for (const r of reminders) {
    lines.push(`• ${formatDateTime(r.remind_at)} — ${r.text}`);
  }
  return lines.join("\n");
}

export function formatMorningBriefing(input: {
  taskCount: number;
  deadlineCount: number;
  importantEmailCount: number;
  importantEmails: Array<{ from: string; subject: string }>;
  priorities: string[];
}): string {
  const lines = [
    "☀️ GOOD MORNING",
    "",
    "TODAY",
    `• ${input.taskCount} tasks`,
    `• ${input.deadlineCount} deadline${input.deadlineCount === 1 ? "" : "s"}`,
    `• ${input.importantEmailCount} important emails`,
  ];

  if (input.importantEmails.length) {
    lines.push("", "IMPORTANT EMAILS");
    for (const e of input.importantEmails.slice(0, 5)) {
      lines.push(`• ${e.from} — ${e.subject}`);
    }
  }

  if (input.priorities.length) {
    lines.push("", "TOP PRIORITIES");
    input.priorities.slice(0, 5).forEach((p, i) => {
      lines.push(`${i + 1}. ${p}`);
    });
  }

  return lines.join("\n");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} ${formatTime(iso)}`;
}
