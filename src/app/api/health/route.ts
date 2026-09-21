import { NextResponse } from "next/server";
import { setupStatus, getEnv } from "@/lib/env";
import { isDbConfigured, getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = setupStatus();
  let dbPing: { ok: boolean; error?: string; userCount?: number } = {
    ok: false,
  };

  if (isDbConfigured()) {
    try {
      const db = getDb();
      const { count, error } = await db
        .from("users")
        .select("*", { count: "exact", head: true });
      if (error) dbPing = { ok: false, error: error.message };
      else dbPing = { ok: true, userCount: count ?? 0 };
    } catch (err) {
      dbPing = {
        ok: false,
        error: err instanceof Error ? err.message : "db_ping_failed",
      };
    }
  }

  return NextResponse.json({
    ok: true,
    version: "2026-09-21-v4",
    appUrl: getEnv().APP_URL || null,
    status: {
      ...status,
      databaseReachable: isDbConfigured(),
      databasePing: dbPing,
    },
    timestamp: new Date().toISOString(),
  });
}
