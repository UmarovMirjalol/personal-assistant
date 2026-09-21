import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { telegramUpdateSchema } from "@/lib/security/validate";
import { processTelegramUpdate } from "@/lib/telegram/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CRITICAL: Telegram kills webhooks that take > ~60s.
 * ACK immediately, then process in the background (Node keeps the promise alive).
 */
export async function POST(req: NextRequest) {
  const secret = getEnv().TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const provided = req.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
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

  const update = parsed.data;
  const debug = req.nextUrl.searchParams.get("debug") === "1";

  // Fire-and-forget — must NOT await. Local Next + Vercel Node both keep this alive.
  void (async () => {
    try {
      await processTelegramUpdate(update);
    } catch (err) {
      const chatId =
        update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      if (chatId) {
        try {
          const { sendMessage } = await import("@/lib/telegram/client");
          await sendMessage(chatId, "Секунду подтупил. Напиши ещё раз — я на связи.");
        } catch {
          // ignore
        }
      }
      if (debug) console.error("telegram webhook handler failed", err);
    }
  })();

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "telegram-webhook",
    hint: "POST Telegram updates here",
  });
}
