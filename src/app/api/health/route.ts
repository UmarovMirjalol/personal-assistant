import { NextResponse } from "next/server";
import { setupStatus } from "@/lib/env";
import { isDbConfigured } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = setupStatus();
  return NextResponse.json({
    ok: true,
    status: {
      ...status,
      databaseReachable: isDbConfigured(),
    },
    timestamp: new Date().toISOString(),
  });
}
