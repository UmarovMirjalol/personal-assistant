import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getDb, isDbConfigured } from "@/lib/db/client";
import { listTasks, getTodayPlan } from "@/lib/db/tasks";
import { sendMessage } from "@/lib/telegram/client";
import { formatMorningBriefing } from "@/lib/telegram/format";

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

  const hourParam = req.nextUrl.searchParams.get("hour");
  const hour = hourParam ? Number(hourParam) : new Date().getUTCHours();

  const db = getDb();
  const { data: settingsList } = await db
    .from("settings")
    .select("*, users(*)")
    .eq("morning_briefing_enabled", true)
    .eq("morning_briefing_hour", hour);

  let sent = 0;
  for (const row of settingsList ?? []) {
    const user = row.users as unknown as {
      id: string;
      telegram_id: number;
    } | null;
    // supabase join typing is loose
    const userId = (row as { user_id: string }).user_id;
    const { data: u } = await db.from("users").select("*").eq("id", userId).maybeSingle();
    if (!u) continue;

    const tasks = await listTasks(u.id, { status: "open" });
    const plan = await getTodayPlan(u.id);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const { data: importantEmails } = await db
      .from("email_summaries")
      .select("purpose, emails(from_name, subject)")
      .eq("user_id", u.id)
      .eq("priority", "high")
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
      .limit(5);

    const emails = (importantEmails ?? []).map((e) => {
      const em = e.emails as unknown as { from_name?: string; subject?: string } | null;
      return {
        from: em?.from_name ?? "Unknown",
        subject: em?.subject ?? e.purpose ?? "Email",
      };
    });

    const priorities = [
      ...emails.map((e) => `Reply / handle: ${e.from} — ${e.subject}`),
      ...plan.dueToday.map((t) => t.title),
      ...tasks.filter((t) => t.priority === "high").map((t) => t.title),
    ].slice(0, 5);

    const text = formatMorningBriefing({
      taskCount: tasks.length,
      deadlineCount: plan.dueToday.length,
      importantEmailCount: emails.length,
      importantEmails: emails,
      priorities,
    });

    try {
      await sendMessage(u.telegram_id, text);
      sent += 1;
    } catch {
      // skip
    }
    void user;
  }

  return NextResponse.json({ ok: true, hour, sent });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
