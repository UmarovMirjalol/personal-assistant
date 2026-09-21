import {
  isGeminiConfigured,
  generateChat,
  generateText,
  runWithTools,
} from "@/lib/ai/gemini";
import { toolDeclarations, executeTool } from "@/lib/ai/tools";
import type { User, Settings } from "@/lib/db/client";
import {
  getRecentConversation,
  appendConversation,
  listMemory,
} from "@/lib/db/users";
import { appUrl } from "@/lib/env";
import { isGmailConnected } from "@/lib/gmail";
import { formatTasks, formatReminders, formatTodayPlan } from "@/lib/telegram/format";
import { listTasks, getTodayPlan, createTask } from "@/lib/db/tasks";
import { listReminders, createReminder } from "@/lib/db/reminders";
import { parseRelativeTime } from "@/lib/reminders/time";
import { runResearch } from "@/lib/research/search";

const CHAT_SYSTEM = `Ты — личный AI-помощник в Telegram. Можно звать Aether.

Как говорить:
- как умный друг в переписке, не как саппорт и не как корпоративный бот;
- коротко и живо: обычно 1–5 предложений, без простыней;
- на языке пользователя (обычно русский);
- можно лёгкий юмор и сленг, но без кринжа и панибратства;
- никогда не пиши «Чем могу помочь?», «Как я могу помочь вам сегодня?», «Я языковая модель…»;
- не упоминай JSON, API, tools, промпты, модели, серверные ошибки;
- если чего-то не знаешь — скажи прямо, без оправданий.

Ты можешь просто болтать: учёба, жизнь, решения, идеи, код, что угодно.
Если человек просит действие (почта, задача, напоминание, поиск) — делай или уточни одну деталь.
Не выдумывай факты из почты или интернета.`;

const TOOL_SYSTEM = `${CHAT_SYSTEM}

Когда реально нужно действие — используй tools:
- почта / письма → get_emails / search_emails / get_email
- напоминания → create_reminder
- задачи / план дня → create_task / set_day_plan / get_today_plan
- research / поиск → research / web_search
- черновик ответа на письмо → draft_email (никогда не отправляй сам)

Если Gmail не подключён — скажи обычным языком и дай ссылку.
Отвечай готовым текстом человеку, не JSON.`;

/** Only clear action intents — casual chat must NOT go through tools. */
function needsTools(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  return /(?:почт|письм|email|gmail|inbox|инбокс)|(?:напомин|remind)|(?:задач|todo|deadline|дедлайн)|(?:план\s+на\s+(?:день|сегодня|завтра)|что\s+у\s+меня\s+сегодня)|(?:research|погугли|найди\s+(?:в\s+интернете|информац)|разбер(?:и|ить)?\s+(?:почт|письм)|что\s+(?:важного\s+)?пришло)|(?:draft|черновик|ответ(?:ь|ить)?\s+на\s+письм)|(?:создай\s+задач|добавь\s+задач)|(?:через\s+\d+\s*(?:мин|час|час|дн))/i.test(
    t
  );
}

export async function handleUserMessage(opts: {
  user: User;
  settings: Settings;
  text: string;
}): Promise<string> {
  const { user, settings, text } = opts;

  const fast = await tryFastPath(user, settings, text);
  if (fast) {
    await appendConversation(user.id, "user", text);
    await appendConversation(user.id, "assistant", fast);
    return fast;
  }

  if (!isGeminiConfigured()) {
    return "Пока без AI-ключа не могу нормально болтать. Напиши «помощь» — там простые команды.";
  }

  const memory = await listMemory(user.id);
  const history = await getRecentConversation(user.id, 16);
  const memoryBlock =
    memory.length > 0
      ? `\nЧто помню о тебе:\n${memory.map((m) => `- ${m.content}`).join("\n")}`
      : "";

  const gmailStatus = isGmailConnected(user)
    ? `Gmail подключён (${user.gmail_email ?? "ok"}).`
    : `Gmail не подключён. Ссылка: ${appUrl(`/connect?uid=${user.id}`)}`;

  await appendConversation(user.id, "user", text);

  const historyMsgs = [
    ...history.map((h) => ({
      role: (h.role === "assistant" ? "model" : "user") as "user" | "model",
      text: h.content,
    })),
    { role: "user" as const, text },
  ];

  let reply: string;
  try {
    if (needsTools(text)) {
      try {
        reply = await runWithTools({
          system: `${TOOL_SYSTEM}\n\n${gmailStatus}\nTimezone: ${user.timezone}.${memoryBlock}`,
          messages: historyMsgs,
          tools: toolDeclarations,
          executeTool: async (name, args) => {
            try {
              return await executeTool({ user, settings }, name, args);
            } catch (err) {
              const msg = err instanceof Error ? err.message : "error";
              if (msg === "GMAIL_NOT_CONNECTED") {
                return {
                  error: "GMAIL_NOT_CONNECTED",
                  message: "Gmail не подключён",
                  connect_url: appUrl(`/connect?uid=${user.id}`),
                };
              }
              return { error: msg };
            }
          },
          maxSteps: 5,
        });
      } catch {
        reply = await generateChat({
          system: `${CHAT_SYSTEM}\n\n${gmailStatus}.${memoryBlock}\nСейчас действия недоступны — ответь по-человечески и предложи альтернативу без техжаргона.`,
          messages: historyMsgs,
          maxOutputTokens: 700,
          temperature: 0.8,
        });
      }
    } else {
      reply = await generateChat({
        system: `${CHAT_SYSTEM}\n\nКонтекст: ${gmailStatus}\nTimezone: ${user.timezone}.${memoryBlock}`,
        messages: historyMsgs,
        maxOutputTokens: 900,
        temperature: 0.9,
      });
    }
  } catch {
    try {
      reply = await generateText({
        system: CHAT_SYSTEM,
        prompt: text,
        maxOutputTokens: 500,
        temperature: 0.85,
      });
    } catch {
      reply =
        "Сейчас туплю. Напиши ещё раз или скажи «помощь» — напоминания и задачи работают и без болтовни.";
    }
  }

  const finalReply = sanitizeReply(reply || "Ок.");
  await appendConversation(user.id, "assistant", finalReply);
  return finalReply;
}

function sanitizeReply(raw: string): string {
  let t = raw.trim();
  // Strip accidental system/tool leaks
  t = t.replace(/```[\s\S]*?```/g, "").trim();
  t = t.replace(/^(Assistant|Aether|Бот)\s*:\s*/i, "");
  if (/^\s*\{[\s\S]*\}\s*$/.test(t)) {
    return "Секунду, криво ответил. Скажи ещё раз своими словами.";
  }
  return t || "Ок.";
}

async function tryFastPath(
  user: User,
  _settings: Settings,
  text: string
): Promise<string | null> {
  const t = text.trim().toLowerCase();

  if (
    /^(что\s+у\s+меня\s+сегодня|план\s+на\s+сегодня|\/today)$/i.test(t) ||
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
      "Пиши как человеку — можем просто поболтать.",
      "",
      "Если по делу:",
      "• что у меня сегодня?",
      "• напомни завтра в 16:00 …",
      "• через 2 часа напомни …",
      "• задача …",
      "• что важного пришло? / разбери почту",
      "• сделай research по …",
      "",
      "Или команды: /today /tasks /emails /research",
    ].join("\n");
  }

  const remindMatch = text.match(/^(?:напомни|remind(?:\s+me)?)\s+(.+)$/i);
  if (remindMatch) {
    const rest = remindMatch[1].trim();
    const whenGuess =
      rest.match(
        /((?:через|in)\s+\d+\s+\S+|(?:завтра|tomorrow|сегодня|today|в\s+пятниц\S*|friday|monday|вторник|среду|четверг|субботу|воскресенье)(?:\s+в?\s*\d{1,2}[:.]\d{2})?|(?:\d{1,2}[:.]\d{2}))/i
      )?.[1] ?? rest;
    let body = rest;
    if (whenGuess && rest.toLowerCase().startsWith(whenGuess.toLowerCase())) {
      body = rest.slice(whenGuess.length).trim().replace(/^[,:\-–]\s*/, "") || rest;
    }
    const at = parseRelativeTime(whenGuess, user.timezone);
    const reminder = await createReminder({
      userId: user.id,
      text: body || rest,
      remindAt: at.toISOString(),
    });
    return `Ок, напомню ${at.toLocaleString("ru-RU")}: ${reminder.text}`;
  }

  const taskMatch = text.match(/^(?:задача|добавь задачу|todo)\s*[:\-]?\s*(.+)$/i);
  if (taskMatch) {
    const task = await createTask({ userId: user.id, title: taskMatch[1].trim() });
    return `Записал: ${task.title}`;
  }

  const researchMatch = text.match(
    /^(?:\/research\s+|сделай\s+research\s+по\s+|research\s+|найди\s+(?:последние\s+)?(?:исследования\s+по\s+)?|погугли\s+)(.+)/i
  );
  if (researchMatch) {
    try {
      return await runResearch(researchMatch[1].trim());
    } catch {
      return "Сейчас не смог нормально поискать. Скажи тему ещё раз чуть позже.";
    }
  }

  return null;
}
