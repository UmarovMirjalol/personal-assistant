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
  opts: { mode?: "poll" | "push"; max?: number; forceNotify?: boolean } = {}
): Promise<{ processed: number; notified: number; skipped: number }> {
  if (!isGmailConnected(user)) return { processed: 0, notified: 0, skipped: 0 };

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
    // Last 24 hours — frequent polling still skips already-notified rows
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await listRecentEmails(user, {
      max: opts.max ?? Math.min(settings.max_emails_per_analysis, 10),
      after: since,
      query: "in:inbox",
    });
    gmailIds = recent.map((e) => e.gmailId);
  }

  const db = getDb();
  let processed = 0;
  let notified = 0;
  let skipped = 0;

  for (const id of gmailIds.slice(0, opts.max ?? 10)) {
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
      if (existingSummary?.notified) {
        skipped += 1;
        continue;
      }
    }

    const parsed = await getEmailByGmailId(user, id);
    const { rowId, summary, analysis } = await analyzeAndStore(user, parsed);
    processed += 1;

    const blob = `${parsed.fromEmail ?? ""} ${parsed.subject ?? ""} ${parsed.snippet ?? ""}`;
    const admissionsHot =
      /admission|admissions|application|scholarship|fee\s*waiver|interview|decision|financial\s*aid|common\s*app|css\s*profile|fafsa|evaluation\s*form|professor|enrol?l/i.test(
        blob
      );

    const notify =
      opts.forceNotify ||
      admissionsHot ||
      shouldNotify(analysis.priority, settings.notify_email_priority);

    if (notify && !summary.notified) {
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
      // Mark low-priority as notified so we don't keep re-analyzing forever
      await db.from("email_summaries").update({ notified: true }).eq("id", summary.id);
      skipped += 1;
    }
  }

  return { processed, notified, skipped };
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
      results.push({ userId: user.id, email: user.gmail_email, ...r });
    } catch (err) {
      results.push({
        userId: user.id,
        email: user.gmail_email,
        processed: 0,
        notified: 0,
        skipped: 0,
        error: true,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
