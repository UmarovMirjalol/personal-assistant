import { SchemaType, type AgentToolDeclaration } from "@/lib/ai/gemini";
import type { User, Settings } from "@/lib/db/client";
import { createTask, listTasks, completeTask, getTodayPlan } from "@/lib/db/tasks";
import { createReminder, listReminders, cancelReminder } from "@/lib/db/reminders";
import {
  isGmailConnected,
  listRecentEmails,
  getEmailByGmailId,
  searchEmails,
  analyzeAndStore,
} from "@/lib/gmail";
import { getDb, isDbConfigured } from "@/lib/db/client";
import { localDb } from "@/lib/db/local-store";
import { formatEmailDigest, formatEmailNotification } from "@/lib/telegram/format";
import { runResearch, webSearch } from "@/lib/research/search";
import { addMemory, forgetMemory, listMemory, clearAllMemory } from "@/lib/db/users";
import { generateText } from "@/lib/ai/gemini";
import { parseRelativeTime } from "@/lib/reminders/time";

export type ToolContext = {
  user: User;
  settings: Settings;
};

export const toolDeclarations: AgentToolDeclaration[] = [
  {
    name: "get_emails",
    description: "List recent inbox emails (optionally only today). Use for digests and 'что пришло'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        max: { type: SchemaType.NUMBER, description: "Max emails 1-15" },
        today_only: { type: SchemaType.BOOLEAN },
        analyze: { type: SchemaType.BOOLEAN, description: "Run AI analysis" },
      },
    },
  },
  {
    name: "get_email",
    description: "Get one email by Gmail ID or DB uuid and analyze it.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        email_id: { type: SchemaType.STRING },
      },
      required: ["email_id"],
    },
  },
  {
    name: "search_emails",
    description: "Search Gmail with a query string.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING },
        max: { type: SchemaType.NUMBER },
      },
      required: ["query"],
    },
  },
  {
    name: "create_task",
    description: "Create a task/todo item.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        notes: { type: SchemaType.STRING },
        priority: { type: SchemaType.STRING, description: "high|medium|low" },
        due_at: { type: SchemaType.STRING, description: "ISO datetime" },
        scheduled_start: { type: SchemaType.STRING },
        scheduled_end: { type: SchemaType.STRING },
      },
      required: ["title"],
    },
  },
  {
    name: "list_tasks",
    description: "List open tasks.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        status: { type: SchemaType.STRING, description: "open|done|all" },
      },
    },
  },
  {
    name: "complete_task",
    description: "Mark a task done by id or title fragment.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        task: { type: SchemaType.STRING },
      },
      required: ["task"],
    },
  },
  {
    name: "create_reminder",
    description:
      "Create a reminder. Prefer natural when/relative fields. Does not send email.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        text: { type: SchemaType.STRING },
        when: {
          type: SchemaType.STRING,
          description: "Natural time e.g. 'tomorrow 16:00', 'in 2 hours', 'friday 15:00'",
        },
        remind_at: { type: SchemaType.STRING, description: "ISO if already resolved" },
        recurrence: { type: SchemaType.STRING, description: "none|daily|weekly" },
      },
      required: ["text"],
    },
  },
  {
    name: "list_reminders",
    description: "List pending reminders.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "cancel_reminder",
    description: "Cancel reminder by id or text fragment.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: { reminder: { type: SchemaType.STRING } },
      required: ["reminder"],
    },
  },
  {
    name: "get_today_plan",
    description: "Get today's schedule, deadlines and open tasks.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "set_day_plan",
    description:
      "Parse a natural-language day plan into scheduled tasks. Example: 'завтра школа до 14, потом 2 часа research, в 19 футбол'",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        plan_text: { type: SchemaType.STRING },
        day: { type: SchemaType.STRING, description: "today|tomorrow|ISO date" },
      },
      required: ["plan_text"],
    },
  },
  {
    name: "web_search",
    description: "Search the web and return sources (no synthesis).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING },
      },
      required: ["query"],
    },
  },
  {
    name: "research",
    description: "Full research brief with sources, facts vs conclusions.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        question: { type: SchemaType.STRING },
      },
      required: ["question"],
    },
  },
  {
    name: "draft_email",
    description:
      "Draft a reply for an analyzed email. Never sends. Returns draft text for confirmation.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        email_id: { type: SchemaType.STRING },
        instructions: { type: SchemaType.STRING },
      },
      required: ["email_id"],
    },
  },
  {
    name: "remember",
    description: "Store a useful long-term memory (preference, project, routine).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        content: { type: SchemaType.STRING },
        kind: { type: SchemaType.STRING, description: "note|preference|project|routine" },
      },
      required: ["content"],
    },
  },
  {
    name: "forget",
    description: "Forget memories matching query, or all if query is 'all'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING },
      },
      required: ["query"],
    },
  },
  {
    name: "get_memory",
    description: "List active memory items.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "get_calendar_events",
    description:
      "Placeholder for future Google Calendar integration. Currently returns not_implemented.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        day: { type: SchemaType.STRING, description: "today|tomorrow|ISO date" },
      },
    },
  },
  {
    name: "create_calendar_event",
    description:
      "Placeholder for future Google Calendar integration. Currently returns not_implemented.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        start: { type: SchemaType.STRING },
        end: { type: SchemaType.STRING },
      },
      required: ["title", "start"],
    },
  },
];

export async function executeTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "get_emails":
      return toolGetEmails(ctx, args);
    case "get_email":
      return toolGetEmail(ctx, String(args.email_id ?? ""));
    case "search_emails":
      return toolSearchEmails(ctx, String(args.query ?? ""), Number(args.max ?? 8));
    case "create_task":
      return createTask({
        userId: ctx.user.id,
        title: String(args.title),
        notes: args.notes ? String(args.notes) : undefined,
        priority: normalizePriority(args.priority),
        dueAt: args.due_at ? String(args.due_at) : null,
        scheduledStart: args.scheduled_start ? String(args.scheduled_start) : null,
        scheduledEnd: args.scheduled_end ? String(args.scheduled_end) : null,
      });
    case "list_tasks":
      return listTasks(ctx.user.id, {
        status: (args.status as "open" | "done" | "all") || "open",
      });
    case "complete_task":
      return completeTask(ctx.user.id, String(args.task));
    case "create_reminder": {
      let remindAt = args.remind_at ? String(args.remind_at) : null;
      if (!remindAt && args.when) {
        remindAt = parseRelativeTime(String(args.when), ctx.user.timezone).toISOString();
      }
      if (!remindAt) throw new Error("Need when or remind_at");
      return createReminder({
        userId: ctx.user.id,
        text: String(args.text),
        remindAt,
        recurrence: args.recurrence ? String(args.recurrence) : null,
      });
    }
    case "list_reminders":
      return listReminders(ctx.user.id, "pending");
    case "cancel_reminder":
      return { cancelled: await cancelReminder(ctx.user.id, String(args.reminder)) };
    case "get_today_plan":
      return getTodayPlan(ctx.user.id, ctx.user.timezone);
    case "set_day_plan":
      return toolSetDayPlan(ctx, String(args.plan_text), String(args.day ?? "today"));
    case "web_search":
      return webSearch(String(args.query), 5);
    case "research":
      return { report: await runResearch(String(args.question)) };
    case "draft_email":
      return toolDraftEmail(ctx, String(args.email_id), args.instructions ? String(args.instructions) : undefined);
    case "remember":
      return addMemory(
        ctx.user.id,
        String(args.content),
        (args.kind as "note" | "preference" | "project" | "routine") || "note"
      );
    case "forget": {
      const q = String(args.query);
      if (q.toLowerCase() === "all") {
        await clearAllMemory(ctx.user.id);
        return { forgotten: "all" };
      }
      return { forgotten: await forgetMemory(ctx.user.id, q) };
    }
    case "get_memory":
      return listMemory(ctx.user.id);
    case "get_calendar_events":
    case "create_calendar_event":
      return {
        error: "not_implemented",
        message:
          "Google Calendar ещё не подключён. Пока используй tasks/reminders и план дня.",
      };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function normalizePriority(p: unknown): "high" | "medium" | "low" {
  if (p === "high" || p === "low" || p === "medium") return p;
  return "medium";
}

async function ensureGmail(ctx: ToolContext) {
  if (!isGmailConnected(ctx.user)) {
    throw new Error("GMAIL_NOT_CONNECTED");
  }
}

async function toolGetEmails(ctx: ToolContext, args: Record<string, unknown>) {
  await ensureGmail(ctx);
  const max = Math.min(Number(args.max ?? 12), 15);
  const todayOnly = Boolean(args.today_only);
  const analyze = args.analyze !== false;
  const after = todayOnly
    ? (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
      })()
    : undefined;

  const emails = await listRecentEmails(ctx.user, { max, after, query: "in:inbox" });
  if (!analyze) {
    return emails.map((e) => ({
      gmailId: e.gmailId,
      from: e.fromName || e.fromEmail,
      subject: e.subject,
      receivedAt: e.receivedAt,
    }));
  }

  const analyzed = [];
  const counts = { high: 0, medium: 0, low: 0 };
  for (const e of emails) {
    const { rowId, analysis, summary } = await analyzeAndStore(ctx.user, e);
    counts[analysis.priority] += 1;
    analyzed.push({
      id: rowId,
      gmailId: e.gmailId,
      from: e.fromName || e.fromEmail,
      subject: e.subject,
      priority: analysis.priority,
      purpose: analysis.purpose,
      action_required: analysis.action_required,
      deadline: analysis.deadline,
      summary: analysis.summary,
      notification_preview: formatEmailNotification({
        fromName: e.fromName,
        fromEmail: e.fromEmail,
        subject: e.subject,
        summary,
      }),
    });
  }

  const importants = analyzed.filter((a) => a.priority === "high" || a.priority === "medium");
  return {
    counts,
    digest: formatEmailDigest(
      counts,
      importants.map((a) => ({
        from_name: String(a.from ?? ""),
        subject: a.subject ?? null,
        purpose: a.purpose,
        priority: a.priority,
      }))
    ),
    emails: analyzed,
  };
}

async function toolGetEmail(ctx: ToolContext, emailId: string) {
  await ensureGmail(ctx);
  const db = getDb();
  const { data: byDb } = await db
    .from("emails")
    .select("*")
    .eq("user_id", ctx.user.id)
    .eq("id", emailId)
    .maybeSingle();

  const gmailId = byDb?.gmail_id ?? emailId;
  const parsed = await getEmailByGmailId(ctx.user, gmailId);
  const { rowId, analysis, summary } = await analyzeAndStore(ctx.user, parsed);
  return {
    id: rowId,
    analysis,
    formatted: formatEmailNotification({
      fromName: parsed.fromName,
      fromEmail: parsed.fromEmail,
      subject: parsed.subject,
      summary,
    }),
  };
}

async function toolSearchEmails(ctx: ToolContext, query: string, max: number) {
  await ensureGmail(ctx);
  const emails = await searchEmails(ctx.user, query, Math.min(max, 15));
  return emails.map((e) => ({
    gmailId: e.gmailId,
    from: e.fromName || e.fromEmail,
    subject: e.subject,
    snippet: e.snippet,
    receivedAt: e.receivedAt,
  }));
}

async function toolSetDayPlan(ctx: ToolContext, planText: string, day: string) {
  const base = new Date();
  if (day === "tomorrow") base.setDate(base.getDate() + 1);
  else if (day !== "today" && !Number.isNaN(Date.parse(day))) {
    base.setTime(Date.parse(day));
  }
  base.setHours(0, 0, 0, 0);

  const parsed = await generateText({
    system: `Parse a day plan into JSON array only:
[{"title":"...","start":"HH:MM","end":"HH:MM"|null}]
Use 24h times. Infer reasonable blocks. No markdown.`,
    prompt: planText,
    maxOutputTokens: 500,
  });

  let items: Array<{ title: string; start: string; end: string | null }>;
  try {
    const cleaned = parsed.replace(/```json|```/g, "").trim();
    items = JSON.parse(cleaned);
  } catch {
    throw new Error("Could not parse day plan");
  }

  const created = [];
  for (const item of items) {
    const [sh, sm] = item.start.split(":").map(Number);
    const start = new Date(base);
    start.setHours(sh, sm || 0, 0, 0);
    let end: Date | null = null;
    if (item.end) {
      const [eh, em] = item.end.split(":").map(Number);
      end = new Date(base);
      end.setHours(eh, em || 0, 0, 0);
    }
    const task = await createTask({
      userId: ctx.user.id,
      title: item.title,
      scheduledStart: start.toISOString(),
      scheduledEnd: end?.toISOString() ?? null,
      source: "plan",
    });
    created.push(task);
  }
  return { created, plan: await getTodayPlan(ctx.user.id, ctx.user.timezone) };
}

async function toolDraftEmail(ctx: ToolContext, emailId: string, instructions?: string) {
  await ensureGmail(ctx);
  const db = getDb();
  let body = "";
  let subject = "";
  let from = "";

  const { data: row } = await db
    .from("emails")
    .select("*, email_summaries(*)")
    .eq("user_id", ctx.user.id)
    .eq("id", emailId)
    .maybeSingle();

  if (row) {
    body = row.body_excerpt ?? row.snippet ?? "";
    subject = row.subject ?? "";
    from = row.from_name || row.from_email || "";
  } else {
    const parsed = await getEmailByGmailId(ctx.user, emailId);
    body = parsed.bodyExcerpt;
    subject = parsed.subject ?? "";
    from = parsed.fromName || parsed.fromEmail || "";
  }

  const draft = await generateText({
    system: `Draft a natural email reply.
- Match context, be concise and human
- Do NOT invent facts
- Not overly formal, not corporate, not AI-sounding
- Do not include subject line unless asked
- Write in the same language as the original email`,
    prompt: `From: ${from}\nSubject: ${subject}\n\nEmail:\n${body.slice(0, 3500)}\n\nExtra instructions: ${instructions ?? "none"}`,
    maxOutputTokens: 700,
  });

  // Store pending draft action
  const { data: pending } = await db
    .from("pending_actions")
    .insert({
      user_id: ctx.user.id,
      kind: "draft_reply",
      payload: {
        email_id: row?.id ?? emailId,
        gmail_id: row?.gmail_id ?? emailId,
        to: row?.from_email,
        subject,
        thread_id: row?.thread_id,
        draft,
      },
    })
    .select("*")
    .single();

  if (row?.id) {
    await db.from("email_summaries").update({ draft_reply: draft }).eq("email_id", row.id);
  }

  return { draft, pending_id: pending?.id, email_id: row?.id ?? emailId };
}
