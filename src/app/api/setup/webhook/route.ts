import { NextRequest, NextResponse } from "next/server";
import { getEnv, appUrl, requireEnv } from "@/lib/env";
import { webhookPath } from "@/lib/telegram/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Sets Telegram webhook to this deployment.
 * POST /api/setup/webhook?secret=CRON_SECRET
 */
export async function POST(req: NextRequest) {
  const secret = getEnv().CRON_SECRET;
  const provided =
    req.nextUrl.searchParams.get("secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const url = appUrl(webhookPath());
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
      secret_token: undefined,
    }),
  });
  const data = await res.json();
  return NextResponse.json({ webhookUrl: url, telegram: data });
}

export async function GET(req: NextRequest) {
  const secret = getEnv().CRON_SECRET;
  const provided = req.nextUrl.searchParams.get("secret");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const data = await res.json();
  return NextResponse.json(data);
}
