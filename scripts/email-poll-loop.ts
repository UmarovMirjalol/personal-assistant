/**
 * Local email poller — runs every ~60s and pushes summary+priority to Telegram.
 * Vercel Hobby cron is daily-only; this keeps inbox notifications alive.
 *
 * Usage: npx tsx scripts/email-poll-loop.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!process.env[k]) process.env[k] = v;
}

const INTERVAL_MS = Number(process.env.EMAIL_POLL_INTERVAL_MS || 60_000);

async function tick() {
  const { processAllConnectedUsers } = await import("../src/lib/gmail/sync");
  const started = Date.now();
  try {
    const results = await processAllConnectedUsers();
    const ms = Date.now() - started;
    console.log(
      new Date().toISOString(),
      `poll ${ms}ms`,
      JSON.stringify(results)
    );
  } catch (err) {
    console.error(
      new Date().toISOString(),
      "poll failed",
      err instanceof Error ? err.message : err
    );
  }
}

async function main() {
  console.log(
    `email-poll-loop started, every ${INTERVAL_MS}ms (pid ${process.pid})`
  );
  await tick();
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
