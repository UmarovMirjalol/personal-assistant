import { NextRequest, NextResponse } from "next/server";
import { getGmailAuthUrl } from "@/lib/gmail/oauth";
import { getDb, isDbConfigured } from "@/lib/db/client";
import { SignJWT } from "jose";
import { requireEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function makeState(userId: string): Promise<string> {
  const key = new TextEncoder().encode(requireEnv("TOKEN_ENCRYPTION_KEY").slice(0, 32).padEnd(32, "0"));
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(key);
}

export async function GET(req: NextRequest) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const uid = req.nextUrl.searchParams.get("uid");
  if (!uid) {
    return NextResponse.json({ error: "Missing uid" }, { status: 400 });
  }

  const db = getDb();
  const { data: user } = await db.from("users").select("id").eq("id", uid).maybeSingle();
  if (!user) {
    return NextResponse.json({ error: "Unknown user" }, { status: 404 });
  }

  try {
    const state = await makeState(uid);
    const url = getGmailAuthUrl(state);
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.json(
      { error: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID/SECRET." },
      { status: 503 }
    );
  }
}
