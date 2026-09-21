import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { dueReminders, markReminderSent } from "@/lib/db/reminders";
import { getDb, isDbConfigured } from "@/lib/db/client";
import { sendMessage } from "@/lib/telegram/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("secret");
  return header === `Bearer ${secret}` || q === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "db_not_configured" }, { status: 503 });
  }

  const due = await dueReminders();
  const db = getDb();
  let sent = 0;

  for (const reminder of due) {
    const { data: user } = await db
      .from("users")
      .select("telegram_id")
      .eq("id", reminder.user_id)
      .maybeSingle();
    if (!user) continue;
    try {
      await sendMessage(user.telegram_id, `⏰ Reminder\n\n${reminder.text}`);
      await markReminderSent(reminder);
      sent += 1;
    } catch {
      // keep pending for retry
    }
  }

  return NextResponse.json({ ok: true, checked: due.length, sent });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
