/**
 * Long-polling worker for Telegram when a public webhook URL is unavailable.
 * Usage: npx tsx scripts/telegram-poll.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN missing");
    process.exit(1);
  }

  const base = `https://api.telegram.org/bot${token}`;

  // Clear webhook so getUpdates works
  const wh = await fetch(`${base}/deleteWebhook?drop_pending_updates=false`);
  console.log("deleteWebhook", await wh.json());

  let offset = 0;
  console.log("Polling @assistant… Ctrl+C to stop");

  for (;;) {
    try {
      const res = await fetch(
        `${base}/getUpdates?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent(
          JSON.stringify(["message", "callback_query"])
        )}`
      );
      const data = (await res.json()) as {
        ok: boolean;
        result?: Array<{ update_id: number } & Record<string, unknown>>;
        description?: string;
      };

      if (!data.ok) {
        console.error("getUpdates error", data.description);
        await sleep(2000);
        continue;
      }

      for (const update of data.result ?? []) {
        offset = update.update_id + 1;
        const app = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:43127";
        const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
        const url = secret
          ? `${app}/api/telegram/webhook?secret=${encodeURIComponent(secret)}`
          : `${app}/api/telegram/webhook`;

        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });
        console.log(`update ${update.update_id} -> ${r.status}`);
      }
    } catch (err) {
      console.error("poll loop error", err);
      await sleep(2000);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main();
