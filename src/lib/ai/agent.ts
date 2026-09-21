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
import { directEmailAnswer, isEmailQuestion } from "@/lib/gmail/direct";
import {
  formatTasks,
  formatReminders,
  formatTodayPlan,
  formatHelp,
} from "@/lib/telegram/format";
import { escapeHtml, ruWhen } from "@/lib/telegram/html";
import { listTasks, getTodayPlan, createTask } from "@/lib/db/tasks";
import { listReminders, createReminder } from "@/lib/db/reminders";
import { parseRelativeTime } from "@/lib/reminders/time";
import {
  parseTimerCommand,
  startTimer,
  listActiveTimers,
  cancelTimer,
  formatTimerStarted,
  formatActiveTimers,
} from "@/lib/reminders/timers";
import {
  buildStatusCard,
  decideForMe,
  isStatusCommand,
  coinFlip,
} from "@/lib/telegram/features";
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
Умеешь таймеры (таймер 10 минут / помодоро), напоминания, задачи, почту, research.
НЕ лезь в почту, задачи, напоминания и поиск, пока человек сам об этом не попросил.
Не выдумывай факты из почты или интернета. Не начинай «сейчас гляну почту» без запроса.`;

const TOOL_SYSTEM = `${CHAT_SYSTEM}

Когда человек ЯВНО просит действие — используй tools:
- почта / письма → get_emails / search_emails / get_email
- напоминания → create_reminder
- таймер / помодоро → create_reminder с коротким when (через N минут)
- задачи / план дня → create_task / set_day_plan / get_today_plan
- research / поиск → research / web_search
- черновик ответа на письмо → draft_email (никогда не отправляй сам)

Если tool вернул GMAIL_NOT_CONNECTED или GMAIL_REAUTH_REQUIRED — скажи нормальным языком переподключить Gmail по ссылке connect_url.
На обычный smalltalk tools НЕ вызывай.
Отвечай готовым текстом человеку, не JSON.`;

/** Only clear action intents — casual chat must NOT go through tools. */
function needsTools(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (parseTimerCommand(t)) return false; // handled by fast path
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
              if (
                msg === "GMAIL_REAUTH_REQUIRED" ||
                msg.includes("GOOGLE_OAUTH_NOT_CONFIGURED")
              ) {
                return {
                  error: "GMAIL_REAUTH_REQUIRED",
                  message:
                    "Сессия Gmail истекла или OAuth не настроен. Нужно переподключить почту.",
                  connect_url: appUrl(`/connect?uid=${user.id}`),
                };
              }
              return { error: msg };
            }
          },
          maxSteps: 5,
        });
      } catch {
        // Never invent "mail is down" — hit Gmail directly for email asks
        if (isEmailQuestion(text)) {
          reply = await directEmailAnswer(user, text);
        } else {
          try {
            reply = await generateChat({
              system: `${CHAT_SYSTEM}\n\n${gmailStatus}.${memoryBlock}\nСейчас действия недоступны — ответь по-человечески без выдуманных фактов.`,
              messages: historyMsgs,
              maxOutputTokens: 700,
              temperature: 0.8,
            });
          } catch {
            reply =
              "Сейчас AI тупит. Напиши «помощь» — или конкретнее: напомни / задача / что пришло.";
          }
        }
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

  if (/^(\/timers|таймеры|мои таймеры)$/i.test(t)) {
    return formatActiveTimers(await listActiveTimers(user.id));
  }

  if (isStatusCommand(text) || t === "/status") {
    return buildStatusCard(user);
  }

  if (/^(монетка|подбрось|flip)$/i.test(t)) {
    return coinFlip();
  }

  const decided = decideForMe(text);
  if (decided) return decided;

  if (/^\/help$/.test(t) || t === "help" || t === "помощь") {
    return formatHelp();
  }

  // Timers — before generic reminders
  const timerCmd = parseTimerCommand(text);
  if (timerCmd) {
    const { reminder, endsAt } = await startTimer(user, timerCmd);
    return (
      formatTimerStarted({
        label: timerCmd.label,
        endsAt,
        seconds: timerCmd.seconds,
        kind: timerCmd.kind,
      }) + `\n<!--timer:${reminder.id}-->`
    );
  }

  if (/^(отмен(?:и|ить)\s+таймер|cancel\s+timer)(?:\s+(.+))?$/i.test(text.trim())) {
    const q = text.replace(/^(отмен(?:и|ить)\s+таймер|cancel\s+timer)\s*/i, "").trim() || "";
    const n = await cancelTimer(user.id, q || "таймер");
    return n > 0 ? `Ок, снял таймер${n > 1 ? `ы (${n})` : ""}.` : "Активного таймера не нашёл.";
  }

  // Email — always direct Gmail, never depend on AI tools for this
  if (isEmailQuestion(text)) {
    return directEmailAnswer(user, text);
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
    return [
      "⏰ <b>Напоминание поставлено</b>",
      "",
      `▸ ${escapeHtml(reminder.text)}`,
      `▸ ${escapeHtml(ruWhen(at))}`,
    ].join("\n");
  }

  // "через 10 минут выйти" without напомни
  const throughMatch = text.match(
    /^(?:через|in)\s+(\d+)\s*(минут[уы]?|мин|hours?|час(?:а|ов)?|ч|сек(?:унд[ыуа]?)?)\s+(.+)$/i
  );
  if (throughMatch && !/таймер|timer/i.test(text)) {
    const at = parseRelativeTime(
      `через ${throughMatch[1]} ${throughMatch[2]}`,
      user.timezone
    );
    const reminder = await createReminder({
      userId: user.id,
      text: throughMatch[3].trim(),
      remindAt: at.toISOString(),
    });
    return [
      "⏰ <b>Напомню</b>",
      "",
      `▸ ${escapeHtml(reminder.text)}`,
      `▸ ${escapeHtml(ruWhen(at))}`,
    ].join("\n");
  }

  const taskMatch = text.match(/^(?:задача|добавь задачу|todo)\s*[:\-]?\s*(.+)$/i);
  if (taskMatch) {
    const task = await createTask({ userId: user.id, title: taskMatch[1].trim() });
    return `✅ Записал: <b>${escapeHtml(task.title)}</b>`;
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
