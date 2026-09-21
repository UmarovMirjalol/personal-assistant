import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!process.env[k]) process.env[k] = v;
}

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: user } = await sb
    .from("users")
    .select("*")
    .eq("telegram_id", 846682305)
    .single();
  if (!user) throw new Error("no user");

  // Allow re-notify of recent unsent / force fresh analysis for inbox
  const { processNewEmailsForUser } = await import("../src/lib/gmail/sync");
  const { sendMessage } = await import("../src/lib/telegram/client");

  await sendMessage(
    846682305,
    "Поднял бота. Сейчас проверю почту и пришлю summary + важность по новым письмам."
  );

  const result = await processNewEmailsForUser(user, {
    mode: "poll",
    max: 8,
  });
  console.log("result", result);

  if (result.notified === 0 && result.processed === 0) {
    // Nothing new in DB sense — still push a live inbox digest
    const { listRecentEmails } = await import("../src/lib/gmail/client");
    const { heuristicAnalyze } = await import("../src/lib/gmail/heuristic");
    const { formatEmailNotification } = await import("../src/lib/telegram/format");
    const emails = await listRecentEmails(user, { max: 5, query: "in:inbox" });
    for (const e of emails) {
      const a = heuristicAnalyze(e);
      if (a.priority === "low") continue;
      await sendMessage(
        846682305,
        formatEmailNotification({
          fromName: e.fromName,
          fromEmail: e.fromEmail,
          subject: e.subject,
          summary: {
            priority: a.priority,
            purpose: a.purpose,
            what_they_want: a.what_they_want,
            action_required: a.action_required,
            deadline: a.deadline,
            urgency: a.urgency,
            summary: a.summary,
            uncertain: a.uncertain,
          },
        })
      );
    }
    console.log("fallback digest sent", emails.length);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
