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
    await processTelegramUpdate(parsed.data);
  } catch (err) {
    const chatId =
      parsed.data.message?.chat.id ?? parsed.data.callback_query?.message?.chat.id;
    const msg = err instanceof Error ? err.message : "unknown";
    const stack = err instanceof Error ? err.stack : undefined;
    if (chatId) {
      try {
        const { sendMessage } = await import("@/lib/telegram/client");
        await sendMessage(
          chatId,
          /503|high demand|unavailable/i.test(msg)
            ? "AI временно недоступен (перегрузка). Напиши /start или «помощь»."
            : `Ошибка: ${msg.slice(0, 300)}`
        );
      } catch {
        // ignore
      }
    }
    // Expose error to deployer for diagnosis (no secrets in typical stack messages)
    if (req.nextUrl.searchParams.get("debug") === "1") {
      return NextResponse.json({ ok: false, error: msg, stack: stack?.slice(0, 1500) });
    }
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
