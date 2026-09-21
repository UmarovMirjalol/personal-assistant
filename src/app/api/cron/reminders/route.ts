import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { dueReminders, markReminderSent, createReminder } from "@/lib/db/reminders";
import { getDb, isDbConfigured } from "@/lib/db/client";
import { sendMessage } from "@/lib/telegram/client";
import { formatReminderFired } from "@/lib/telegram/format";
import {
  formatTimerFired,
  isTimerReminder,
  POMODORO_BREAK,
} from "@/lib/reminders/timers";
import {
  reminderFiredKeyboard,
  timerFiredKeyboard,
} from "@/lib/telegram/keyboards";

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
  let timers = 0;

  for (const reminder of due) {
    const { data: user } = await db
      .from("users")
      .select("telegram_id")
      .eq("id", reminder.user_id)
      .maybeSingle();
    if (!user) continue;
    try {
      const isTimer = isTimerReminder(reminder);
      if (isTimer) {
        const pomodoro = (reminder.recurrence_rule ?? "").startsWith("pomodoro");
        await sendMessage(user.telegram_id, formatTimerFired(reminder), {
          reply_markup: timerFiredKeyboard({ pomodoro }),
        });
        // Auto-offer break after pomodoro work
        if (reminder.recurrence_rule === "pomodoro:work") {
          const breakAt = new Date(Date.now() + 5 * 60_000);
          await createReminder({
            userId: reminder.user_id,
            text: "Перерыв после помодоро",
            remindAt: breakAt.toISOString(),
            recurrenceRule: POMODORO_BREAK,
          });
        }
        timers += 1;
      } else {
        await sendMessage(user.telegram_id, formatReminderFired(reminder.text), {
          reply_markup: reminderFiredKeyboard(reminder.id),
        });
      }
      await markReminderSent(reminder);
      sent += 1;
    } catch {
      // keep pending for retry
    }
  }

  return NextResponse.json({ ok: true, checked: due.length, sent, timers });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
