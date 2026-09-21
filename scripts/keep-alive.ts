/**
 * Keeps the local stack alive:
 * - refreshes Gmail tokens via Vercel (has Google OAuth)
 * - polls inbox for new mail notifications
 * - re-points Telegram webhook if tunnel URL is provided
 *
 * Usage: npx tsx scripts/keep-alive.ts
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

const APP_URL =
  process.env.APP_URL?.replace(/\/$/, "") ||
  "https://personal-assistant-eight-lake.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET || "";
const EMAIL_EVERY_MS = Number(process.env.EMAIL_POLL_INTERVAL_MS || 60_000);
const REFRESH_EVERY_MS = Number(process.env.GMAIL_REFRESH_INTERVAL_MS || 10 * 60_000);
const REMINDERS_EVERY_MS = Number(process.env.REMINDERS_POLL_INTERVAL_MS || 30_000);

async function refreshViaVercel() {
  if (!CRON_SECRET) return;
  const urls = [
    `${APP_URL}/api/cron/gmail-refresh?secret=${encodeURIComponent(CRON_SECRET)}`,
    `${APP_URL}/api/cron/email-poll?secret=${encodeURIComponent(CRON_SECRET)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(50_000) });
      const text = await res.text();
      console.log(new Date().toISOString(), "refresh", res.status, text.slice(0, 200));
      if (res.ok) return;
    } catch (err) {
      console.error(
        new Date().toISOString(),
        "refresh fail",
        err instanceof Error ? err.message : err
      );
    }
  }
}

async function pollReminders() {
  if (!CRON_SECRET) return;
  try {
    const res = await fetch(
      `${APP_URL}/api/cron/reminders?secret=${encodeURIComponent(CRON_SECRET)}`,
      { signal: AbortSignal.timeout(40_000) }
    );
    const text = await res.text();
    console.log(new Date().toISOString(), "reminders", res.status, text.slice(0, 180));
  } catch (err) {
    console.error(
      new Date().toISOString(),
      "reminders fail",
      err instanceof Error ? err.message : err
    );
  }
}

async function pollEmailViaVercel() {
  if (!CRON_SECRET) return;
  try {
    const res = await fetch(
      `${APP_URL}/api/cron/email-poll?secret=${encodeURIComponent(CRON_SECRET)}`,
      { signal: AbortSignal.timeout(55_000) }
    );
    const text = await res.text();
    console.log(new Date().toISOString(), "email-poll", res.status, text.slice(0, 220));
  } catch (err) {
    console.error(
      new Date().toISOString(),
      "email-poll fail",
      err instanceof Error ? err.message : err
    );
  }
}

async function pollLocal() {
  // Fallback only — production poll on Vercel is source of truth
  try {
    await pollEmailViaVercel();
  } catch {
    try {
      const { processAllConnectedUsers } = await import("../src/lib/gmail/sync");
      const results = await processAllConnectedUsers();
      console.log(new Date().toISOString(), "poll-local", JSON.stringify(results));
    } catch (err) {
      console.error(
        new Date().toISOString(),
        "poll fail",
        err instanceof Error ? err.message : err
      );
    }
  }
}

async function main() {
  console.log("keep-alive started", {
    APP_URL,
    EMAIL_EVERY_MS,
    REFRESH_EVERY_MS,
    REMINDERS_EVERY_MS,
  });
  await refreshViaVercel();
  await pollReminders();
  await pollLocal();
  setInterval(() => void pollLocal(), EMAIL_EVERY_MS);
  setInterval(() => void refreshViaVercel(), REFRESH_EVERY_MS);
  setInterval(() => void pollReminders(), REMINDERS_EVERY_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
