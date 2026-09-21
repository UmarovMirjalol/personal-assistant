import { getDb, type User } from "@/lib/db/client";
import { getSettings } from "@/lib/db/users";
import {
  listRecentEmails,
  getEmailByGmailId,
  listHistoryMessages,
  isGmailConnected,
} from "@/lib/gmail";
import { analyzeAndStore, shouldNotify } from "@/lib/gmail/analyze";
import { formatEmailNotification } from "@/lib/telegram/format";
import { sendMessage } from "@/lib/telegram/client";
import { afterImportantKeyboard } from "@/lib/telegram/keyboards";

export async function processNewEmailsForUser(
  user: User,
  opts: { mode?: "poll" | "push"; max?: number } = {}
): Promise<{ processed: number; notified: number }> {
  if (!isGmailConnected(user)) return { processed: 0, notified: 0 };

  const settings = await getSettings(user.id);
  let gmailIds: string[] = [];

  if (opts.mode === "push" && user.gmail_history_id) {
    const hist = await listHistoryMessages(user, user.gmail_history_id);
    if (hist === null) {
      const recent = await listRecentEmails(user, { max: opts.max ?? 8 });
      gmailIds = recent.map((e) => e.gmailId);
    } else {
      gmailIds = hist;
    }
  } else {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await listRecentEmails(user, {
      max: opts.max ?? settings.max_emails_per_analysis,
      after: since,
      query: "in:inbox",
    });
    gmailIds = recent.map((e) => e.gmailId);
  }

  const db = getDb();
  let processed = 0;
  let notified = 0;

  for (const id of gmailIds.slice(0, opts.max ?? 15)) {
    const { data: existingEmail } = await db
      .from("emails")
      .select("id")
      .eq("user_id", user.id)
      .eq("gmail_id", id)
      .maybeSingle();

    if (existingEmail) {
      const { data: existingSummary } = await db
        .from("email_summaries")
        .select("*")
        .eq("email_id", existingEmail.id)
        .maybeSingle();
      if (existingSummary?.notified) continue;
    }

    const parsed = await getEmailByGmailId(user, id);
    const { rowId, summary, analysis } = await analyzeAndStore(user, parsed);
    processed += 1;

    if (shouldNotify(analysis.priority, settings.notify_email_priority) && !summary.notified) {
      const text = formatEmailNotification({
        fromName: parsed.fromName,
        fromEmail: parsed.fromEmail,
        subject: parsed.subject,
        summary,
      });
      await sendMessage(user.telegram_id, text, {
        reply_markup: afterImportantKeyboard({
          emailId: rowId,
          showDraft: analysis.action_required !== "None",
        }),
      });
      await db.from("email_summaries").update({ notified: true }).eq("id", summary.id);
      notified += 1;
    } else if (!summary.notified) {
      await db.from("email_summaries").update({ notified: true }).eq("id", summary.id);
    }
  }

  return { processed, notified };
}

export async function processAllConnectedUsers() {
  const db = getDb();
  const { data: users } = await db
    .from("users")
    .select("*")
    .not("gmail_refresh_token_enc", "is", null);

  const results = [];
  for (const user of users ?? []) {
    try {
      const r = await processNewEmailsForUser(user, { mode: "poll" });
      results.push({ userId: user.id, ...r });
    } catch {
      results.push({ userId: user.id, processed: 0, notified: 0, error: true });
    }
  }
  return results;
}
