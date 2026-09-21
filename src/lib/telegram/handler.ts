import { getOrCreateUser, updateSettings, getSettings, clearAllMemory } from "@/lib/db/users";
import { AccessDeniedError } from "@/lib/db/users";
import { handleUserMessage } from "@/lib/ai/agent";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { sanitizeUserText } from "@/lib/security/validate";
import {
  sendMessage,
  answerCallback,
  editMessage,
} from "@/lib/telegram/client";
import {
  mainMenuKeyboard,
  settingsKeyboard,
  gmailConnectKeyboard,
  draftReplyKeyboard,
  afterImportantKeyboard,
} from "@/lib/telegram/keyboards";
import {
  formatTasks,
  formatReminders,
  formatTodayPlan,
} from "@/lib/telegram/format";
import { listTasks, getTodayPlan, createTask } from "@/lib/db/tasks";
import { listReminders, createReminder } from "@/lib/db/reminders";
import { appUrl } from "@/lib/env";
import { getDb, isDbConfigured } from "@/lib/db/client";
import { localDb } from "@/lib/db/local-store";
import { sendGmailReply, isGmailConnected } from "@/lib/gmail";
import { parseRelativeTime } from "@/lib/reminders/time";
import { executeTool } from "@/lib/ai/tools";

type TgUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export async function processTelegramUpdate(update: {
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number };
    from?: TgUser;
  };
  callback_query?: {
    id: string;
    data?: string;
    from: TgUser;
    message?: { message_id: number; chat: { id: number } };
  };
}): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }
  if (update.message?.from && update.message.text) {
    await handleMessage(update.message);
  }
}

async function handleMessage(message: {
  message_id: number;
  text?: string;
  chat: { id: number };
  from?: TgUser;
}) {
  const from = message.from!;
  let text = sanitizeUserText(message.text ?? "");
  if (!text) return;

  // Common typos
  if (/^\/satrt\b/i.test(text) || /^\/strat\b/i.test(text)) {
    text = "/start";
  }

  const rl = await checkRateLimit(`tg:${from.id}`, 40, 60_000);
  if (!rl.allowed) {
    await sendMessage(message.chat.id, "Слишком много сообщений. Подожди минуту.");
    return;
  }

  let userPack;
  try {
    userPack = await getOrCreateUser({
      telegramId: from.id,
      username: from.username,
      displayName: [from.first_name, from.last_name].filter(Boolean).join(" ") || undefined,
    });
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      await sendMessage(message.chat.id, err.message);
      return;
    }
    throw err;
  }

  const { user, settings, isNew } = userPack;

  if (text === "/start" || isNew) {
    const lines = [
      "Привет. Я твой личный AI-помощник.",
      "",
      "Пиши обычным языком — задачи, почта, research, план дня.",
      "",
      isGmailConnected(user)
        ? `Gmail: ${user.gmail_email ?? "подключён"}`
        : "Gmail ещё не подключён — без него не смогу разбирать письма.",
    ];
    await sendMessage(message.chat.id, lines.join("\n"), {
      reply_markup: isGmailConnected(user)
        ? mainMenuKeyboard()
        : gmailConnectKeyboard(appUrl(`/connect?uid=${user.id}`)),
    });
    if (text === "/start") return;
  }

  // Slash shortcuts
  if (text === "/today") {
    await sendMessage(message.chat.id, formatTodayPlan(await getTodayPlan(user.id)), {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  if (text === "/tasks") {
    await sendMessage(message.chat.id, formatTasks(await listTasks(user.id)), {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  if (text === "/emails" || /^что\s+(важного\s+)?пришло/i.test(text) || /разбери.*(почт|письм)/i.test(text)) {
    if (!isGmailConnected(user)) {
      await sendMessage(
        message.chat.id,
        "Чтобы анализировать почту, сначала подключи Gmail.",
        { reply_markup: gmailConnectKeyboard(appUrl(`/connect?uid=${user.id}`)) }
      );
      return;
    }
    const result = (await executeTool({ user, settings }, "get_emails", {
      today_only: /сегодня|today/i.test(text) || text === "/emails",
      analyze: true,
      max: 12,
    })) as {
      digest?: string;
      emails?: Array<{ id: string; priority: string; action_required: string }>;
    };
    await sendMessage(message.chat.id, result.digest ?? "Нет писем.", {
      reply_markup: mainMenuKeyboard(),
    });
    const importants = (result.emails ?? []).filter((e) => e.priority === "high").slice(0, 3);
    for (const e of importants) {
      const detailed = await executeTool({ user, settings }, "get_email", { email_id: e.id });
      const formatted = (detailed as { formatted?: string }).formatted;
      if (formatted) {
        await sendMessage(message.chat.id, formatted, {
          reply_markup: afterImportantKeyboard({
            emailId: e.id,
            showDraft: e.action_required !== "None",
          }),
        });
      }
    }
    return;
  }

  if (text.startsWith("/research")) {
    const q = text.replace(/^\/research\s*/i, "").trim();
    if (!q) {
      await sendMessage(message.chat.id, "Напиши: /research <вопрос> или «сделай research по …»");
      return;
    }
  }

  // Pending draft edit mode
  if (isDbConfigured()) {
    const db = getDb();
    const { data: pendings } = await db
      .from("pending_actions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .eq("kind", "draft_reply")
      .order("created_at", { ascending: false })
      .limit(3);
    const awaitEdit = (pendings ?? []).find((p) => {
      const payload = p.payload as { awaiting_edit?: boolean };
      return payload.awaiting_edit;
    });
    if (awaitEdit) {
      const payload = { ...(awaitEdit.payload as object), draft: text, awaiting_edit: false };
      await db.from("pending_actions").update({ payload }).eq("id", awaitEdit.id);
      await sendMessage(message.chat.id, `Обновлённый черновик:\n\n${text}`, {
        reply_markup: draftReplyKeyboard(awaitEdit.id),
      });
      return;
    }
  } else {
    const pendings = await localDb.listPending(user.id, "draft_reply");
    const awaitEdit = pendings.find((p) => (p.payload as { awaiting_edit?: boolean }).awaiting_edit);
    if (awaitEdit) {
      await localDb.updatePending(awaitEdit.id, {
        payload: { ...awaitEdit.payload, draft: text, awaiting_edit: false },
      });
      await sendMessage(message.chat.id, `Обновлённый черновик:\n\n${text}`, {
        reply_markup: draftReplyKeyboard(awaitEdit.id),
      });
      return;
    }
  }

  try {
    const reply = await handleUserMessage({ user, settings, text });
    const lower = text.toLowerCase();
    const showMenu =
      lower.includes("меню") ||
      lower.startsWith("/help") ||
      reply.length < 500;
    await sendMessage(message.chat.id, reply, {
      reply_markup: showMenu ? mainMenuKeyboard() : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const friendly = /503|high demand|unavailable|overloaded/i.test(msg)
      ? "Gemini сейчас перегружен. Попробуй ещё раз через минуту — простые команды (/start, помощь, напомни…) работают всегда."
      : `Не смог ответить: ${msg.includes("API") || msg.includes("key") || msg.includes("GEMINI") ? "проблема с AI API, попробуй ещё раз" : msg.slice(0, 180)}`;
    try {
      await sendMessage(message.chat.id, friendly);
    } catch {
      // ignore
    }
  }
}

async function handleCallback(cq: {
  id: string;
  data?: string;
  from: TgUser;
  message?: { message_id: number; chat: { id: number } };
}) {
  await answerCallback(cq.id);
  const data = cq.data ?? "";
  const chatId = cq.message?.chat.id ?? cq.from.id;

  let userPack;
  try {
    userPack = await getOrCreateUser({
      telegramId: cq.from.id,
      username: cq.from.username,
      displayName: cq.from.first_name,
    });
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      await sendMessage(chatId, err.message);
      return;
    }
    throw err;
  }
  const { user, settings } = userPack;

  if (data === "menu:home") {
    await sendMessage(chatId, "Меню:", { reply_markup: mainMenuKeyboard() });
    return;
  }
  if (data === "menu:today") {
    await sendMessage(chatId, formatTodayPlan(await getTodayPlan(user.id)), {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  if (data === "menu:tasks") {
    await sendMessage(chatId, formatTasks(await listTasks(user.id)), {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  if (data === "menu:reminders") {
    await sendMessage(chatId, formatReminders(await listReminders(user.id)), {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  if (data === "menu:research") {
    await sendMessage(chatId, "Напиши тему: «сделай research по …» или /research …");
    return;
  }
  if (data === "menu:emails") {
    await handleMessage({
      message_id: 0,
      text: "/emails",
      chat: { id: chatId },
      from: cq.from,
    });
    return;
  }
  if (data === "menu:settings" || data.startsWith("settings:")) {
    await handleSettings(user.id, chatId, data, cq.message?.message_id);
    return;
  }

  if (data.startsWith("act:draft:")) {
    const emailId = data.replace("act:draft:", "");
    const result = (await executeTool({ user, settings }, "draft_email", {
      email_id: emailId,
    })) as { draft: string; pending_id?: string };
    await sendMessage(
      chatId,
      `✍️ Draft reply\n\n${result.draft}`,
      result.pending_id ? { reply_markup: draftReplyKeyboard(result.pending_id) } : undefined
    );
    return;
  }

  if (data.startsWith("act:task:")) {
    const emailId = data.replace("act:task:", "");
    let title = "Email follow-up";
    let notes: string | undefined;
    if (isDbConfigured()) {
      const db = getDb();
      const { data: email } = await db
        .from("emails")
        .select("subject, email_summaries(action_required, purpose)")
        .eq("id", emailId)
        .maybeSingle();
      const summaries = email?.email_summaries as
        | { action_required?: string; purpose?: string }
        | { action_required?: string; purpose?: string }[]
        | null;
      const s = Array.isArray(summaries) ? summaries[0] : summaries;
      title =
        s?.action_required && s.action_required !== "None"
          ? s.action_required
          : email?.subject || "Email follow-up";
      notes = s?.purpose ?? undefined;
    }
    await createTask({ userId: user.id, title, source: "email", notes });
    await sendMessage(chatId, `Задача создана: ${title}`);
    return;
  }

  if (data.startsWith("act:remind:")) {
    const emailId = data.replace("act:remind:", "");
    const when = parseRelativeTime("tomorrow 10:00", user.timezone);
    const reminder = await createReminder({
      userId: user.id,
      text: `Follow up email ${emailId}`,
      remindAt: when.toISOString(),
    });
    await sendMessage(
      chatId,
      `Напоминание на ${when.toLocaleString()}: ${reminder.text}\n(можешь уточнить время обычным сообщением)`
    );
    return;
  }

  if (data.startsWith("draft:")) {
    await handleDraftAction(user, chatId, data);
    return;
  }

  if (data.startsWith("confirm:")) {
    // reserved
    return;
  }
}

async function handleSettings(
  userId: string,
  chatId: number,
  data: string,
  messageId?: number
) {
  let settings = await getSettings(userId);
  if (data === "settings:briefing_toggle") {
    settings = await updateSettings(userId, {
      morning_briefing_enabled: !settings.morning_briefing_enabled,
    });
  }
  if (data === "settings:priority_cycle") {
    const order = ["high", "medium", "low"] as const;
    const idx = order.indexOf(settings.notify_email_priority);
    settings = await updateSettings(userId, {
      notify_email_priority: order[(idx + 1) % order.length],
    });
  }
  if (data === "settings:gmail") {
    await sendMessage(chatId, "Открой ссылку и разреши доступ к Gmail:", {
      reply_markup: gmailConnectKeyboard(appUrl(`/connect?uid=${userId}`)),
    });
    return;
  }
  if (data === "settings:forget") {
    await clearAllMemory(userId);
    await sendMessage(chatId, "Память и недавний контекст очищены.");
    return;
  }

  const text = [
    "⚙️ SETTINGS",
    "",
    `Morning briefing: ${settings.morning_briefing_enabled ? "ON" : "OFF"} (hour ${settings.morning_briefing_hour})`,
    `Email notify threshold: ${settings.notify_email_priority.toUpperCase()}`,
    "",
    "Переключатели ниже.",
  ].join("\n");

  if (messageId && data.startsWith("settings:")) {
    try {
      await editMessage(chatId, messageId, text, settingsKeyboard(settings));
      return;
    } catch {
      // fall through
    }
  }
  await sendMessage(chatId, text, { reply_markup: settingsKeyboard(settings) });
}

async function handleDraftAction(
  user: Awaited<ReturnType<typeof getOrCreateUser>>["user"],
  chatId: number,
  data: string
) {
  const [, action, pendingId] = data.split(":");

  let pending: {
    id: string;
    status: string;
    payload: Record<string, unknown>;
  } | null = null;

  if (isDbConfigured()) {
    const db = getDb();
    const { data } = await db
      .from("pending_actions")
      .select("*")
      .eq("id", pendingId)
      .eq("user_id", user.id)
      .maybeSingle();
    pending = data as typeof pending;
  } else {
    const row = await localDb.getPending(pendingId);
    pending = row && row.user_id === user.id ? row : null;
  }

  if (!pending || pending.status !== "pending") {
    await sendMessage(chatId, "Черновик устарел.");
    return;
  }

  const payload = pending.payload as {
    draft?: string;
    to?: string;
    subject?: string;
    thread_id?: string;
  };

  const setPending = async (patch: Record<string, unknown>) => {
    if (isDbConfigured()) {
      await getDb().from("pending_actions").update(patch).eq("id", pending!.id);
    } else {
      await localDb.updatePending(pending!.id, patch as never);
    }
  };

  if (action === "cancel") {
    await setPending({ status: "cancelled" });
    await sendMessage(chatId, "Отменено. Письмо не отправлено.");
    return;
  }

  if (action === "edit") {
    await setPending({ payload: { ...payload, awaiting_edit: true } });
    await sendMessage(chatId, "Пришли новый текст ответа одним сообщением.");
    return;
  }

  if (action === "send") {
    if (!payload.to || !payload.draft) {
      await sendMessage(chatId, "Не могу отправить: нет адресата или текста.");
      return;
    }
    if (!isGmailConnected(user)) {
      await sendMessage(chatId, "Gmail не подключён.");
      return;
    }
    await sendGmailReply(user, {
      to: payload.to,
      subject: payload.subject ?? "",
      body: payload.draft,
      threadId: payload.thread_id,
    });
    await setPending({ status: "confirmed" });
    await sendMessage(chatId, "Отправлено.");
  }
}
