import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { isDbConfigured, getDb } from "@/lib/db/client";
import { processAllConnectedUsers } from "@/lib/gmail/sync";

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

/**
 * Polling fallback for Gmail inbox.
 * Vercel Hobby cron is at most daily — use an external free cron (cron-job.org)
 * to hit this every 5–10 minutes, OR configure Gmail Pub/Sub push.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "db_not_configured" }, { status: 503 });
  }

  const results = await processAllConnectedUsers();

  // Also refresh history ids from profile when possible
  void getDb;

  return NextResponse.json({
    ok: true,
    mode: "poll",
    results,
    note: "Prefer Gmail Pub/Sub (/api/gmail/pubsub) when available. This is the reliable free fallback.",
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
