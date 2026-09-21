import { NextResponse } from "next/server";
import { setupStatus, getEnv } from "@/lib/env";
import { isDbConfigured, getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = setupStatus();
  let dbPing: Record<string, unknown> = { ok: false };

  if (isDbConfigured()) {
    try {
      const env = getEnv();
      const url = env.SUPABASE_URL;
      const key = env.SUPABASE_SERVICE_ROLE_KEY;
      const raw = await fetch(`${url}/rest/v1/users?select=id&limit=1`, {
        headers: {
          apikey: key || "",
          Authorization: `Bearer ${key || ""}`,
        },
      });
      const rawText = await raw.text();
      const db = getDb();
      const { data, error, count } = await db
        .from("users")
        .select("id", { count: "exact" })
        .limit(1);
      dbPing = {
        ok: raw.ok && !error,
        rawStatus: raw.status,
        rawBody: rawText.slice(0, 200),
        supabaseError: error
          ? { message: error.message, code: error.code, details: error.details }
          : null,
        rows: data?.length ?? 0,
        count: count ?? null,
        keyLen: key?.length ?? 0,
        keyPrefix: key?.slice(0, 10) ?? null,
        urlHost: url ? new URL(url).host : null,
      };
    } catch (err) {
      dbPing = {
        ok: false,
        error: err instanceof Error ? err.message : "db_ping_failed",
      };
    }
  }

  return NextResponse.json({
    ok: true,
    version: "2026-09-21-v7",
    appUrl: getEnv().APP_URL || null,
    status: {
      ...status,
      databaseReachable: isDbConfigured(),
      databasePing: dbPing,
    },
    timestamp: new Date().toISOString(),
  });
}
