import { NextRequest, NextResponse } from "next/server";
import { getDb, isDbConfigured } from "@/lib/db/client";
import { processNewEmailsForUser } from "@/lib/gmail/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Gmail Pub/Sub push endpoint.
 * Configure Google Cloud Pub/Sub topic + push subscription to this URL.
 * Body: { message: { data: base64({ emailAddress, historyId }) } }
 */
export async function POST(req: NextRequest) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "db_not_configured" }, { status: 503 });
  }

  let body: {
    message?: { data?: string };
    emailAddress?: string;
    historyId?: string | number;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let emailAddress = body.emailAddress;
  let historyId = body.historyId ? String(body.historyId) : undefined;

  if (body.message?.data) {
    try {
      const decoded = JSON.parse(
        Buffer.from(body.message.data, "base64").toString("utf8")
      ) as { emailAddress?: string; historyId?: string | number };
      emailAddress = decoded.emailAddress ?? emailAddress;
      historyId = decoded.historyId != null ? String(decoded.historyId) : historyId;
    } catch {
      return NextResponse.json({ error: "invalid_pubsub_data" }, { status: 400 });
    }
  }

  if (!emailAddress) {
    // Acknowledge empty probes
    return NextResponse.json({ ok: true, skipped: true });
  }

  const db = getDb();
  const { data: user } = await db
    .from("users")
    .select("*")
    .eq("gmail_email", emailAddress)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ ok: true, skipped: "unknown_user" });
  }

  if (historyId) {
    // Keep latest; process via history
    await db.from("users").update({ gmail_history_id: historyId }).eq("id", user.id);
    user.gmail_history_id = historyId;
  }

  const result = await processNewEmailsForUser(user, { mode: "push", max: 10 });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "gmail-pubsub",
    hint: "Push Google Pub/Sub notifications here",
  });
}
