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
  const { isGmailConnected, getAuthorizedGmail } = await import("../src/lib/gmail/oauth");
  const { listRecentEmails } = await import("../src/lib/gmail/client");
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: user, error } = await sb
    .from("users")
    .select("*")
    .eq("telegram_id", 846682305)
    .single();
  if (error || !user) throw error || new Error("no user");
  console.log("email", user.gmail_email, "connected", isGmailConnected(user));
  const gmail = await getAuthorizedGmail(user);
  const profile = await gmail.users.getProfile({ userId: "me" });
  console.log("profile", profile.data.emailAddress);
  const emails = await listRecentEmails(user, { max: 6, query: "in:inbox" });
  for (const e of emails) {
    console.log("-", e.subject, "|", e.fromName || e.fromEmail);
  }
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
