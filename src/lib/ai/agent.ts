import type { User, Settings } from "@/lib/db/client";
import { runWithTools, isGeminiConfigured, generateText } from "@/lib/ai/gemini";
import { toolDeclarations, executeTool } from "@/lib/ai/tools";
import {
  getRecentConversation,
  appendConversation,
  listMemory,
} from "@/lib/db/users";
import { appUrl } from "@/lib/env";
import { isGmailConnected } from "@/lib/gmail";
import { formatTasks, formatReminders, formatTodayPlan } from "@/lib/telegram/format";
import { listTasks, getTodayPlan } from "@/lib/db/tasks";
import { listReminders } from "@/lib/db/reminders";
import { runResearch } from "@/lib/research/search";

const SYSTEM = `You are a personal Telegram AI assistant.
Personality: concise, practical, intelligent, proactive but not annoying.
No corporate fluff. No huge answers. Don't repeat the obvious.
Language: answer in the user's language (usually Russian).

When the user needs to act, lead with what they must do.

You have tools. Use them instead of guessing.
Never send emails yourself — only draft via draft_email tool.
Never invent email contents, research facts, deadlines, or calendar data.
If Gmail is not connected and email tools fail with GMAIL_NOT_CONNECTED, tell the user:
"Чтобы анализировать почту, сначала подключи Gmail."
If research/search fails, explain — do not fabricate results.
If unsure, say so (UNCERTAIN).

For day plans like "завтра школа до 14...", use set_day_plan.
For "что пришло" / "разбери почту" use get_emails with analyze=true and today_only when relevant.
For reminders use create_reminder with natural "when".
Future calendar tools may appear — do not pretend they exist yet.

Keep replies Telegram-sized.`;

export async function handleUserMessage(opts: {
  user: User;
  settings: Settings;
  text: string;
}): Promise<string> {
  const { user, settings, text } = opts;

  // Fast-path intents without burning Gemini when possible
  const fast = await tryFastPath(user, settings, text);
  if (fast) {
    await appendConversation(user.id, "user", text);
    await appendConversation(user.id, "assistant", fast);
    return fast;
  }

  if (!isGeminiConfigured()) {
    return "Gemini API key не настроен. Добавь GEMINI_API_KEY в environment variables.";
  }

  const memory = await listMemory(user.id);
  const history = await getRecentConversation(user.id, 10);
  const memoryBlock =
    memory.length > 0
      ? `\nKnown useful context:\n${memory.map((m) => `- (${m.kind}) ${m.content}`).join("\n")}`
      : "";

  const gmailStatus = isGmailConnected(user)
    ? `Gmail connected (${user.gmail_email ?? "yes"}).`
    : "Gmail NOT connected.";

  await appendConversation(user.id, "user", text);

  const reply = await runWithTools({
    system: `${SYSTEM}\n\n${gmailStatus}\nTimezone: ${user.timezone}.${memoryBlock}\nConnect Gmail URL: ${appUrl(`/connect?uid=${user.id}`)}`,
    messages: [
      ...history.map((h) => ({
        role: (h.role === "assistant" ? "model" : "user") as "user" | "model",
        text: h.content,
      })),
      { role: "user" as const, text },
    ],
    tools: toolDeclarations,
    executeTool: async (name, args) => {
      try {
        return await executeTool({ user, settings }, name, args);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "error";
        if (msg === "GMAIL_NOT_CONNECTED") {
          return {
            error: "GMAIL_NOT_CONNECTED",
            message: "Чтобы анализировать почту, сначала подключи Gmail.",
            connect_url: appUrl(`/connect?uid=${user.id}`),
          };
        }
        return { error: msg };
      }
    },
    maxSteps: 6,
  });

  const finalReply = reply || "Готово.";
  await appendConversation(user.id, "assistant", finalReply);
  return finalReply;
}

async function tryFastPath(
  user: User,
  _settings: Settings,
  text: string
): Promise<string | null> {
  const t = text.trim().toLowerCase();

  if (
    /^(что\s+у\s+меня\s+сегодня|план\s+на\s+сегодня|\/today|сегодня\??)$/i.test(t) ||
    t === "today"
  ) {
    const plan = await getTodayPlan(user.id, user.timezone);
    return formatTodayPlan(plan);
  }

  if (/^(\/tasks|задачи|мои задачи)$/i.test(t)) {
    return formatTasks(await listTasks(user.id));
  }

  if (/^(\/reminders|напоминания)$/i.test(t)) {
    return formatReminders(await listReminders(user.id));
  }

  if (/^\/help$/.test(t) || t === "help" || t === "помощь") {
    return [
      "Я понимаю обычный язык. Примеры:",
      "• что у меня сегодня?",
      "• напомни завтра в 16:00 отправить CV",
      "• через 2 часа напомни проверить почту",
      "• что важного пришло?",
      "• разбери последние письма",
      "• найди исследования по startup failure prediction",
      "• что мне сейчас нужно сделать?",
      "",
      "Shortcuts: /today /tasks /emails /research /help",
    ].join("\n");
  }

  // Lightweight research shortcut
  const researchMatch = text.match(
    /^(?:\/research\s+|сделай\s+research\s+по\s+|research\s+|найди\s+(?:последние\s+)?(?:исследования\s+по\s+)?|погугли\s+)(.+)/i
  );
  if (researchMatch) {
    return runResearch(researchMatch[1].trim());
  }

  return null;
}

export async function suggestNextActions(user: User): Promise<string> {
  const tasks = await listTasks(user.id, { status: "open", limit: 10 });
  const plan = await getTodayPlan(user.id);
  if (!isGeminiConfigured()) {
    return formatTodayPlan(plan);
  }
  return generateText({
    system: "List top 3 concrete next actions. Concise. User language Russian if tasks are RU.",
    prompt: JSON.stringify({ tasks, plan }),
    maxOutputTokens: 400,
  });
}
