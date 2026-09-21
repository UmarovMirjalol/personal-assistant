import { config } from "dotenv";
config({ path: ".env.local" });
import { processTelegramUpdate } from "../src/lib/telegram/handler";

async function main() {
  const update = {
    update_id: Date.now(),
    message: {
      message_id: 777,
      date: Math.floor(Date.now() / 1000),
      text: "помощь",
      chat: { id: 846682305, type: "private" },
      from: {
        id: 846682305,
        is_bot: false,
        first_name: "Mirjalol",
        username: "umarovmirjalol",
      },
    },
  };

  try {
    await processTelegramUpdate(update as never);
    console.log("LOCAL_HANDLER_OK");
  } catch (e) {
    console.error("LOCAL_HANDLER_ERR", e);
  }
}

main();
