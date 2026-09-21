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
  const { sendMessage } = await import("../src/lib/telegram/client");
  await sendMessage(
    846682305,
    [
      "Готово. Бот на проде и больше не должен отваливаться.",
      "",
      "• чат и почта — через Vercel",
      "• Gmail токены обновляются сами",
      "• новые письма → summary + важность",
      "",
      "Пиши как обычно.",
    ].join("\n")
  );
  console.log("notified");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
