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
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: user } = await sb.from("users").select("*").eq("telegram_id", 846682305).single();
  if (!user) throw new Error("no user");
  const { directEmailAnswer } = await import("../src/lib/gmail/direct");
  const { sendMessage } = await import("../src/lib/telegram/client");
  const reply = await directEmailAnswer(user, "посмотри кто мне написал письмо последним");
  await sendMessage(846682305, reply);
  console.log(reply);
}
main().catch((e) => { console.error(e); process.exit(1); });
