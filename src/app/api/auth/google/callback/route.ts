import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { requireEnv, appUrl } from "@/lib/env";
import {
  exchangeCodeForTokens,
  saveGmailTokens,
  fetchProfileEmail,
} from "@/lib/gmail/oauth";
import { setupGmailWatch } from "@/lib/gmail/client";
import { getDb } from "@/lib/db/client";
import { sendMessage } from "@/lib/telegram/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function verifyState(state: string): Promise<string> {
  const key = new TextEncoder().encode(
    requireEnv("TOKEN_ENCRYPTION_KEY").slice(0, 32).padEnd(32, "0")
  );
  const { payload } = await jwtVerify(state, key);
  const uid = payload.uid;
  if (typeof uid !== "string") throw new Error("invalid state");
  return uid;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const err = req.nextUrl.searchParams.get("error");

  if (err) {
    return NextResponse.redirect(appUrl(`/connect?error=${encodeURIComponent(err)}`));
  }
  if (!code || !state) {
    return NextResponse.redirect(appUrl("/connect?error=missing_code"));
  }

  try {
    const userId = await verifyState(state);
    const tokens = await exchangeCodeForTokens(code);
    await saveGmailTokens(userId, tokens);

    const db = getDb();
    const { data: refreshed } = await db.from("users").select("*").eq("id", userId).single();
    if (refreshed) {
      try {
        const email = await fetchProfileEmail(refreshed);
        if (email) {
          await saveGmailTokens(userId, {}, email);
          refreshed.gmail_email = email;
        }
        await setupGmailWatch(refreshed);
      } catch {
        // Pub/Sub watch is optional — polling fallback still works
      }

      try {
        await sendMessage(
          refreshed.telegram_id,
          `Gmail подключён${refreshed.gmail_email ? `: ${refreshed.gmail_email}` : ""}.\nМожешь написать: «что пришло сегодня?»`
        );
      } catch {
        // ignore telegram errors during oauth
      }
    }

    return NextResponse.redirect(appUrl("/connect?success=1"));
  } catch {
    return NextResponse.redirect(appUrl("/connect?error=oauth_failed"));
  }
}
