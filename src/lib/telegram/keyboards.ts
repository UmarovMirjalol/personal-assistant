import { InlineKeyboard } from "grammy";

export function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("📧 Почта", "menu:emails")
    .text("📅 Сегодня", "menu:today")
    .row()
    .text("✅ Задачи", "menu:tasks")
    .text("⏱ Таймеры", "menu:timers")
    .row()
    .text("⏰ Напоминания", "menu:reminders")
    .text("📊 Статус", "menu:status")
    .row()
    .text("🍅 Помодоро", "timer:start:25:pomodoro")
    .text("⚙️", "menu:settings");
}

export function timerPresetsKeyboard() {
  return new InlineKeyboard()
    .text("5 мин", "timer:start:5")
    .text("10 мин", "timer:start:10")
    .text("15 мин", "timer:start:15")
    .row()
    .text("🍅 25 помодоро", "timer:start:25:pomodoro")
    .text("45 мин", "timer:start:45")
    .row()
    .text("Список", "menu:timers")
    .text("« Меню", "menu:home");
}

export function timerRunningKeyboard(reminderId: string) {
  const short = reminderId.slice(0, 8);
  return new InlineKeyboard()
    .text("+5 мин", `timer:extend:${short}:5`)
    .text("Отмена", `timer:cancel:${short}`)
    .row()
    .text("Ещё таймер", "menu:timer_presets");
}

export function timerFiredKeyboard(opts?: { pomodoro?: boolean }) {
  const kb = new InlineKeyboard()
    .text("🔄 Ещё раз", opts?.pomodoro ? "timer:start:25:pomodoro" : "menu:timer_presets")
    .text("☕ +5 отдых", "timer:start:5");
  if (opts?.pomodoro) {
    kb.row().text("🍅 Следующий помодоро", "timer:start:25:pomodoro");
  }
  return kb;
}

export function reminderFiredKeyboard(reminderId: string) {
  const short = reminderId.slice(0, 8);
  return new InlineKeyboard()
    .text("+5 мин", `rem:snooze:${short}:5`)
    .text("+15 мин", `rem:snooze:${short}:15`)
    .row()
    .text("+1 час", `rem:snooze:${short}:60`)
    .text("✓ Готово", `rem:done:${short}`);
}

export function afterImportantKeyboard(opts?: {
  emailId?: string;
  showDraft?: boolean;
}) {
  const kb = new InlineKeyboard()
    .text("Задача", opts?.emailId ? `act:task:${opts.emailId}` : "act:task")
    .text("Напомнить", opts?.emailId ? `act:remind:${opts.emailId}` : "act:remind");
  if (opts?.showDraft && opts.emailId) {
    kb.row().text("✍️ Черновик", `act:draft:${opts.emailId}`);
  }
  return kb;
}

export function draftReplyKeyboard(pendingId: string) {
  return new InlineKeyboard()
    .text("Отправить", `draft:send:${pendingId}`)
    .text("Править", `draft:edit:${pendingId}`)
    .text("Отмена", `draft:cancel:${pendingId}`);
}

export function confirmKeyboard(pendingId: string, yes = "Да", no = "Нет") {
  return new InlineKeyboard()
    .text(yes, `confirm:yes:${pendingId}`)
    .text(no, `confirm:no:${pendingId}`);
}

export function settingsKeyboard(s: {
  morning_briefing_enabled: boolean;
  notify_email_priority: string;
}) {
  return new InlineKeyboard()
    .text(
      s.morning_briefing_enabled ? "☀️ Брифинг: ON" : "☀️ Брифинг: OFF",
      "settings:briefing_toggle"
    )
    .row()
    .text(`Письма ≥ ${s.notify_email_priority.toUpperCase()}`, "settings:priority_cycle")
    .row()
    .text("🔗 Gmail", "settings:gmail")
    .row()
    .text("🗑 Забыть память", "settings:forget")
    .text("« Меню", "menu:home");
}

export function gmailConnectKeyboard(url: string) {
  return new InlineKeyboard().url("Подключить Gmail", url);
}

export function welcomeKeyboard(opts?: { connectUrl?: string }) {
  const kb = new InlineKeyboard()
    .text("⏱ Таймер", "menu:timer_presets")
    .text("📊 Статус", "menu:status")
    .row()
    .text("📧 Почта", "menu:emails")
    .text("📅 Сегодня", "menu:today");
  if (opts?.connectUrl) {
    kb.row().url("Подключить Gmail", opts.connectUrl);
  }
  return kb;
}
