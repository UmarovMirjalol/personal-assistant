import { InlineKeyboard } from "grammy";

export function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("📧 Emails", "menu:emails")
    .text("📅 Today", "menu:today")
    .row()
    .text("✅ Tasks", "menu:tasks")
    .text("🔬 Research", "menu:research")
    .row()
    .text("⏰ Reminders", "menu:reminders")
    .text("⚙️ Settings", "menu:settings");
}

export function afterImportantKeyboard(opts?: {
  emailId?: string;
  showDraft?: boolean;
}) {
  const kb = new InlineKeyboard()
    .text("Create task", opts?.emailId ? `act:task:${opts.emailId}` : "act:task")
    .text("Set reminder", opts?.emailId ? `act:remind:${opts.emailId}` : "act:remind");
  if (opts?.showDraft && opts.emailId) {
    kb.row().text("✍️ Draft reply", `act:draft:${opts.emailId}`);
  }
  return kb;
}

export function draftReplyKeyboard(pendingId: string) {
  return new InlineKeyboard()
    .text("Send", `draft:send:${pendingId}`)
    .text("Edit", `draft:edit:${pendingId}`)
    .text("Cancel", `draft:cancel:${pendingId}`);
}

export function confirmKeyboard(pendingId: string, yes = "Confirm", no = "Cancel") {
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
      s.morning_briefing_enabled ? "☀️ Briefing: ON" : "☀️ Briefing: OFF",
      "settings:briefing_toggle"
    )
    .row()
    .text(`Notify ≥ ${s.notify_email_priority.toUpperCase()}`, "settings:priority_cycle")
    .row()
    .text("🔗 Connect Gmail", "settings:gmail")
    .row()
    .text("🗑 Forget memory", "settings:forget")
    .text("« Menu", "menu:home");
}

export function gmailConnectKeyboard(url: string) {
  return new InlineKeyboard().url("Connect Gmail", url);
}
