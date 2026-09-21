import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!process.env[k]) process.env[k] = v;
}

async function main() {
  const { processTelegramUpdate } = await import("../src/lib/telegram/handler");
  await processTelegramUpdate({
    message: {
      message_id: 303,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 846682305 },
      from: { id: 846682305, first_name: "Mirjalol" },
      text: "кто мне написал письмо последним",
    },
  });
  console.log("handler done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
