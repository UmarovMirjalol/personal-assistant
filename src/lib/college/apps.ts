import { randomUUID } from "crypto";
import type { Settings, User } from "@/lib/db/client";
import { getSettings, updateSettings } from "@/lib/db/users";
import { createReminder } from "@/lib/db/reminders";
import { parseRelativeTime } from "@/lib/reminders/time";
import { escapeHtml, bold, ruWhen } from "@/lib/telegram/html";
import { isGmailConnected, searchEmails } from "@/lib/gmail";

export type AppStatus =
  | "researching"
  | "essays"
  | "submitted"
  | "interview"
  | "waitlist"
  | "accepted"
  | "rejected"
  | "withdrawn";

export type AppChecklist = {
  common_app?: boolean;
  essays?: boolean;
  lor?: boolean; // letters of rec
  transcript?: boolean;
  tests?: boolean;
  fafsa?: boolean;
  css?: boolean;
  fee_waiver?: boolean;
  interview?: boolean;
  portal?: boolean;
};

export type CollegeApp = {
  id: string;
  school: string;
  program?: string;
  deadline?: string | null; // ISO date
  status: AppStatus;
  checklist: AppChecklist;
  notes?: string;
  updated_at: string;
};

const STATUS_LABEL: Record<AppStatus, string> = {
  researching: "🔍 research",
  essays: "✍️ essays",
  submitted: "📤 submitted",
  interview: "🎤 interview",
  waitlist: "⏳ waitlist",
  accepted: "✅ accepted",
  rejected: "❌ rejected",
  withdrawn: "🗑 withdrawn",
};

const CHECK_LABELS: Array<{ key: keyof AppChecklist; label: string }> = [
  { key: "common_app", label: "Common App / заявка" },
  { key: "essays", label: "Essays" },
  { key: "lor", label: "Letters of rec" },
  { key: "transcript", label: "Transcript" },
  { key: "tests", label: "SAT/ACT/TOEFL" },
  { key: "fee_waiver", label: "Fee waiver" },
  { key: "fafsa", label: "FAFSA" },
  { key: "css", label: "CSS Profile" },
  { key: "interview", label: "Interview" },
  { key: "portal", label: "Portal / confirm" },
];

function prefs(settings: Settings): Record<string, unknown> {
  const p = settings.preferences;
  return p && typeof p === "object" && !Array.isArray(p)
    ? { ...(p as Record<string, unknown>) }
    : {};
}

export async function listCollegeApps(userId: string): Promise<CollegeApp[]> {
  const s = await getSettings(userId);
  const raw = prefs(s).college_apps;
  return Array.isArray(raw) ? (raw as CollegeApp[]) : [];
}

async function saveCollegeApps(userId: string, apps: CollegeApp[]) {
  const s = await getSettings(userId);
  const next = { ...prefs(s), college_apps: apps };
  await updateSettings(userId, { preferences: next });
}

export async function upsertCollegeApp(
  userId: string,
  input: {
    school: string;
    program?: string;
    deadline?: string | null;
    status?: AppStatus;
    notes?: string;
  }
): Promise<CollegeApp> {
  const apps = await listCollegeApps(userId);
  const key = input.school.trim().toLowerCase();
  const existing = apps.find((a) => a.school.toLowerCase() === key);
  if (existing) {
    existing.program = input.program ?? existing.program;
    existing.deadline =
      input.deadline !== undefined ? input.deadline : existing.deadline;
    existing.status = input.status ?? existing.status;
    existing.notes = input.notes ?? existing.notes;
    existing.updated_at = new Date().toISOString();
    await saveCollegeApps(userId, apps);
    return existing;
  }
  const app: CollegeApp = {
    id: randomUUID(),
    school: input.school.trim(),
    program: input.program,
    deadline: input.deadline ?? null,
    status: input.status ?? "researching",
    checklist: {},
    notes: input.notes,
    updated_at: new Date().toISOString(),
  };
  apps.push(app);
  await saveCollegeApps(userId, apps);
  return app;
}

export async function setAppStatus(
  userId: string,
  schoolQuery: string,
  status: AppStatus
): Promise<CollegeApp | null> {
  const apps = await listCollegeApps(userId);
  const app = apps.find((a) =>
    a.school.toLowerCase().includes(schoolQuery.toLowerCase())
  );
  if (!app) return null;
  app.status = status;
  app.updated_at = new Date().toISOString();
  await saveCollegeApps(userId, apps);
  return app;
}

export async function toggleChecklist(
  userId: string,
  schoolQuery: string,
  item: keyof AppChecklist
): Promise<CollegeApp | null> {
  const apps = await listCollegeApps(userId);
  const app = apps.find((a) =>
    a.school.toLowerCase().includes(schoolQuery.toLowerCase())
  );
  if (!app) return null;
  app.checklist = { ...app.checklist, [item]: !app.checklist[item] };
  app.updated_at = new Date().toISOString();
  await saveCollegeApps(userId, apps);
  return app;
}

export function formatCollegeHub(apps: CollegeApp[]): string {
  if (!apps.length) {
    return [
      "🎓 " + bold("Поступление · US colleges"),
      "",
      "Пока пусто. Добавь вуз:",
      "<code>добавь вуз MIT дедлайн 2026-01-01</code>",
      "<code>добавь вуз Stanford essays</code>",
      "",
      "Потом: <code>вузы</code> · <code>чеклист MIT</code> · <code>поступление сегодня</code>",
    ].join("\n");
  }

  const sorted = [...apps].sort((a, b) => {
    const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return da - db;
  });

  const lines = ["🎓 " + bold("Твои вузы"), ""];
  const now = Date.now();
  for (const a of sorted) {
    const done = CHECK_LABELS.filter((c) => a.checklist[c.key]).length;
    const total = CHECK_LABELS.length;
    let dl = "без дедлайна";
    if (a.deadline) {
      const t = new Date(a.deadline).getTime();
      const days = Math.ceil((t - now) / 86400000);
      dl =
        days < 0
          ? `дедлайн прошёл (${escapeHtml(a.deadline.slice(0, 10))})`
          : days === 0
            ? "дедлайн СЕГОДНЯ"
            : `${days}д · ${escapeHtml(a.deadline.slice(0, 10))}`;
    }
    lines.push(
      `${STATUS_LABEL[a.status]} <b>${escapeHtml(a.school)}</b>`,
      `   ${dl} · чеклист ${done}/${total}`,
      a.program ? `   <i>${escapeHtml(a.program)}</i>` : ""
    );
  }
  return lines.filter(Boolean).join("\n");
}

export function formatChecklist(app: CollegeApp): string {
  const lines = [
    `✅ ${bold(`Чеклист · ${app.school}`)}`,
    STATUS_LABEL[app.status],
    app.deadline ? `Дедлайн: <code>${escapeHtml(app.deadline.slice(0, 10))}</code>` : "",
    "",
  ];
  for (const c of CHECK_LABELS) {
    const on = Boolean(app.checklist[c.key]);
    lines.push(`${on ? "☑" : "☐"} ${c.label}`);
  }
  lines.push(
    "",
    `Переключить: <code>чеклист ${escapeHtml(app.school)} essays</code>`
  );
  return lines.filter(Boolean).join("\n");
}

export async function formatAdmissionsToday(
  user: User
): Promise<string> {
  const apps = await listCollegeApps(user.id);
  const now = Date.now();
  const urgent = apps
    .filter((a) => a.deadline && !["accepted", "rejected", "withdrawn"].includes(a.status))
    .map((a) => ({
      app: a,
      days: Math.ceil((new Date(a.deadline!).getTime() - now) / 86400000),
    }))
    .filter((x) => x.days <= 21)
    .sort((a, b) => a.days - b.days);

  const lines = ["🎯 " + bold("Поступление · что делать"), ""];

  if (!apps.length) {
    lines.push("Добавь хотя бы 1 вуз — соберу план.");
    return lines.join("\n");
  }

  if (urgent.length) {
    lines.push(bold("Горящие дедлайны:"));
    for (const u of urgent.slice(0, 5)) {
      const label =
        u.days < 0 ? "просрочен" : u.days === 0 ? "сегодня" : `через ${u.days}д`;
      lines.push(`• <b>${escapeHtml(u.app.school)}</b> — ${label}`);
      const missing = CHECK_LABELS.filter((c) => !u.app.checklist[c.key])
        .slice(0, 3)
        .map((c) => c.label);
      if (missing.length) lines.push(`   todo: ${escapeHtml(missing.join(", "))}`);
    }
    lines.push("");
  }

  const essays = apps.filter((a) => a.status === "essays" || a.status === "researching");
  if (essays.length) {
    lines.push(bold("Essays / research:"));
    for (const a of essays.slice(0, 4)) {
      lines.push(`• ${escapeHtml(a.school)} — ${STATUS_LABEL[a.status]}`);
    }
    lines.push("");
  }

  lines.push(
    bold("Быстрые ходы:"),
    "1) Добей 1 essay draft сегодня",
    "2) Проверь admissions-почту",
    "3) Запроси/пингани 1 recommendation",
    "",
    "<code>письма поступление</code> · <code>вузы</code> · <code>эссе идея …</code>"
  );
  return lines.join("\n");
}

export async function admissionsEmailsDigest(user: User): Promise<string> {
  if (!isGmailConnected(user)) {
    return "Gmail не подключён — без почты слепые. Подключи и будет разбор admissions-писем.";
  }
  const q =
    "newer_than:14d (admission OR admissions OR application OR financial aid OR fee waiver OR scholarship OR interview OR decision OR enrol OR enroll OR college OR university OR common app OR CSS OR FAFSA)";
  const emails = await searchEmails(user, q, 8);
  if (!emails.length) {
    return "🎓 За 14 дней admissions-писем не нашёл. Если ждут в другом ящике — скажи.";
  }
  const lines = ["🎓 " + bold("Письма по поступлению (14д)"), ""];
  for (const e of emails) {
    const from = e.fromName || e.fromEmail || "?";
    lines.push(
      `• <b>${escapeHtml(from)}</b> — ${escapeHtml(e.subject || "(без темы)")}`,
      e.snippet ? `   <i>${escapeHtml(e.snippet.slice(0, 120))}</i>` : ""
    );
  }
  return lines.filter(Boolean).join("\n");
}

/** Parse NL college commands. Returns reply HTML or null. */
export async function handleCollegeCommand(
  user: User,
  text: string
): Promise<string | null> {
  const t = text.trim();

  if (/^(вузы|колледжи|apps|поступление|admissions)$/i.test(t) || t === "/apps") {
    return formatCollegeHub(await listCollegeApps(user.id));
  }

  if (/^(поступление\s+сегодня|apps\s+today|что\s+по\s+поступлению)/i.test(t)) {
    return formatAdmissionsToday(user);
  }

  if (/^(письма\s+поступлен|admissions\s+mail|письма\s+по\s+поступлению)/i.test(t)) {
    return admissionsEmailsDigest(user);
  }

  const add = t.match(
    /^(?:добавь\s+вуз|add\s+(?:school|college|uni)|вуз)\s+(.+)$/i
  );
  if (add) {
    let rest = add[1].trim();
    let status: AppStatus = "researching";
    if (/\bessays?\b/i.test(rest)) status = "essays";
    if (/\bsubmitted|подал\b/i.test(rest)) status = "submitted";

    let deadline: string | null = null;
    const dlMatch = rest.match(
      /\s+(?:дедлайн|deadline|due|до)\s+(.+)$/i
    );
    let school = rest;
    if (dlMatch) {
      school = rest.slice(0, dlMatch.index).trim();
      const dlRaw = dlMatch[1].replace(/\b(essays?|submitted|подал)\b/gi, "").trim();
      try {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dlRaw)) {
          deadline = new Date(dlRaw + "T12:00:00.000Z").toISOString();
        } else {
          deadline = parseRelativeTime(dlRaw, user.timezone).toISOString();
        }
      } catch {
        deadline = null;
      }
    }
    school = school.replace(/\b(essays?|submitted|подал|researching)\b/gi, "").trim();

    const app = await upsertCollegeApp(user.id, {
      school: school || rest,
      deadline,
      status,
    });
    if (deadline) {
      const due = new Date(deadline).getTime();
      for (const days of [7, 1]) {
        const at = new Date(due - days * 86400000);
        if (at.getTime() > Date.now()) {
          await createReminder({
            userId: user.id,
            text: `🎓 Дедлайн ${app.school} через ${days}д`,
            remindAt: at.toISOString(),
          });
        }
      }
    }
    return [
      `🎓 Добавил <b>${escapeHtml(app.school)}</b>`,
      STATUS_LABEL[app.status],
      deadline
        ? `Дедлайн: <code>${escapeHtml(ruWhen(new Date(deadline)))}</code> · напомню за 7д и 1д`
        : "Дедлайн не указан",
      "",
      `<code>чеклист ${escapeHtml(app.school)}</code>`,
    ].join("\n");
  }

  // статус MIT submitted
  const st = t.match(
    /^(?:статус\s+вуза|status)\s+(.+?)\s+(researching|essays|submitted|interview|waitlist|accepted|rejected|withdrawn|эссе|подал|собес|принят|отказ)/i
  );
  if (st) {
    const map: Record<string, AppStatus> = {
      эссе: "essays",
      подал: "submitted",
      собес: "interview",
      принят: "accepted",
      отказ: "rejected",
    };
    const raw = st[2].toLowerCase();
    const status = (map[raw] ?? raw) as AppStatus;
    const app = await setAppStatus(user.id, st[1].trim(), status);
    if (!app) return `Не нашёл вуз «${escapeHtml(st[1])}».`;
    return `Ок: <b>${escapeHtml(app.school)}</b> → ${STATUS_LABEL[app.status]}`;
  }

  // чеклист MIT / чеклист MIT essays
  const ch = t.match(/^чеклист\s+(\S+)(?:\s+(\w+))?$/i);
  if (ch) {
    const school = ch[1];
    const item = ch[2]?.toLowerCase();
    const apps = await listCollegeApps(user.id);
    const app = apps.find((a) => a.school.toLowerCase().includes(school.toLowerCase()));
    if (!app) return `Нет вуза «${escapeHtml(school)}». Сначала: <code>добавь вуз …</code>`;
    if (item) {
      const keyMap: Record<string, keyof AppChecklist> = {
        essays: "essays",
        essay: "essays",
        эссе: "essays",
        lor: "lor",
        rec: "lor",
        рекомендац: "lor",
        transcript: "transcript",
        транскрипт: "transcript",
        tests: "tests",
        sat: "tests",
        toefl: "tests",
        fafsa: "fafsa",
        css: "css",
        fee: "fee_waiver",
        waiver: "fee_waiver",
        interview: "interview",
        собес: "interview",
        common: "common_app",
        app: "common_app",
        portal: "portal",
      };
      const key = keyMap[item] ?? (item as keyof AppChecklist);
      if (!CHECK_LABELS.some((c) => c.key === key)) {
        return formatChecklist(app);
      }
      const updated = await toggleChecklist(user.id, school, key);
      return updated ? formatChecklist(updated) : formatChecklist(app);
    }
    return formatChecklist(app);
  }

  // эссе идея / набросай эссе
  const essay = t.match(
    /^(?:эссе\s+идея|набросай\s+эссе|essay\s+idea|brain(?:storm)?\s+essay)\s*[:\-]?\s*(.+)$/i
  );
  if (essay) {
    return [
      "✍️ " + bold("Эссе · каркас"),
      "",
      `<i>Тема:</i> ${escapeHtml(essay[1].trim())}`,
      "",
      "1) <b>Hook</b> — 1 конкретная сцена (не «я всегда мечтал»)",
      "2) <b>Conflict</b> — что пошло не так / чему учился",
      "3) <b>Action</b> — что сделал ты (не команда/родители)",
      "4) <b>Insight</b> — как это меняет твой следующий шаг",
      "5) <b>Why us</b> — связка с программой/профом/клубом вуза",
      "",
      "Скинь draft — разберу по ритму и клише.",
    ].join("\n");
  }

  return null;
}

export function isCollegeIntent(text: string): boolean {
  return /^(вузы|колледжи|apps|поступление|admissions|поступление\s+сегодня|apps\s+today|письма\s+поступлен|добавь\s+вуз|вуз\s+|чеклист\s+|статус\s+вуза|эссе\s+идея|набросай\s+эссе|\/apps)/i.test(
    text.trim()
  );
}
