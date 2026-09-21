import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { processTelegramUpdate } = await import("../src/lib/telegram/handler");
  const CHAT = 846682305;
  try {
    await processTelegramUpdate({
      message: {
        message_id: 999,
        date: Math.floor(Date.now() / 1000),
        text: "/start",
        chat: { id: CHAT, type: "private" },
        from: {
          id: CHAT,
          is_bot: false,
          first_name: "Mirjalol",
          last_name: "Umarov",
          username: "umarovmirjalol",
        },
      },
    });
    console.log("OK");
  } catch (e) {
    console.error("FAIL", e);
    if (e instanceof Error) console.error(e.stack);
  }
}

main();
