import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { isDbConfigured, getDb } from "@/lib/db/client";
import {
  getOAuthClient,
  hasGoogleOAuthCredentials,
  isGmailConnected,
  saveGmailTokens,
} from "@/lib/gmail/oauth";
import { decryptSecret } from "@/lib/crypto/tokens";

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
 * Force-refresh Gmail OAuth access tokens for all connected users.
 * Local keep-alive / pollers call this on Vercel (where Google OAuth exists).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "db_not_configured" }, { status: 503 });
  }
  if (!hasGoogleOAuthCredentials()) {
    return NextResponse.json(
      { error: "google_oauth_not_configured_on_this_host" },
      { status: 503 }
    );
  }

  const db = getDb();
  const { data: users } = await db
    .from("users")
    .select("*")
    .not("gmail_refresh_token_enc", "is", null);

  const results = [];
  for (const user of users ?? []) {
    if (!isGmailConnected(user)) {
      results.push({ userId: user.id, ok: false, error: "not_connected" });
      continue;
    }
    try {
      if (!user.gmail_refresh_token_enc) {
        results.push({ userId: user.id, ok: false, error: "no_refresh_token" });
        continue;
      }
      const client = getOAuthClient();
      client.setCredentials({
        refresh_token: decryptSecret(user.gmail_refresh_token_enc),
      });
      const { credentials } = await client.refreshAccessToken();
      await saveGmailTokens(user.id, credentials);

      // Prove it works
      client.setCredentials(credentials);
      const gmail = google.gmail({ version: "v1", auth: client });
      const profile = await gmail.users.getProfile({ userId: "me" });

      results.push({
        userId: user.id,
        ok: true,
        email: profile.data.emailAddress,
        expiry: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : null,
      });
    } catch (err) {
      results.push({
        userId: user.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
