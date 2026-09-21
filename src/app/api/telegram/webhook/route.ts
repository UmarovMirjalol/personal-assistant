import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { telegramUpdateSchema } from "@/lib/security/validate";
import { processTelegramUpdate } from "@/lib/telegram/handler";

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

  try {
    // Await so work isn't cancelled when the response is sent (Next.js).
    // Email path is now direct/fast; chat usually finishes well under 60s.
    await processTelegramUpdate(parsed.data);
  } catch {
    const chatId =
      parsed.data.message?.chat.id ?? parsed.data.callback_query?.message?.chat.id;
    if (chatId) {
      try {
        const { sendMessage } = await import("@/lib/telegram/client");
        await sendMessage(chatId, "Секунду подтупил. Напиши ещё раз — я на связи.");
      } catch {
        // ignore
      }
    }
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
