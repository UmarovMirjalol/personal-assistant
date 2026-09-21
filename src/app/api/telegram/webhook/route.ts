import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { telegramUpdateSchema } from "@/lib/security/validate";
import { processTelegramUpdate } from "@/lib/telegram/handler";
import { isDbConfigured } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = getEnv().TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const provided = req.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "database_not_configured" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = telegramUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_update" }, { status: 400 });
  }

  // Acknowledge quickly; process inline (Vercel keeps function alive for response)
  try {
    await processTelegramUpdate(parsed.data);
  } catch {
    // Do not leak internals to Telegram; still 200 to avoid retries storms for logic bugs
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "telegram-webhook",
    hint: "POST Telegram updates here",
  });
}
