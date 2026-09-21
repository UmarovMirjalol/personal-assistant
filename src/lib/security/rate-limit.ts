import { isDbConfigured, getDb } from "@/lib/db/client";

/**
 * Simple DB-backed sliding window rate limiter.
 * Falls back to in-memory if DB is temporarily unavailable.
 */
const memory = new Map<string, { count: number; windowStart: number }>();

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();

  const mem = () => {
    const entry = memory.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      memory.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: limit - 1 };
    }
    if (entry.count >= limit) return { allowed: false, remaining: 0 };
    entry.count += 1;
    return { allowed: true, remaining: limit - entry.count };
  };

  if (!isDbConfigured()) return mem();

  try {
    const db = getDb();
    const { data } = await db.from("rate_limits").select("*").eq("key", key).maybeSingle();

    if (!data) {
      await db.from("rate_limits").upsert({
        key,
        count: 1,
        window_start: new Date(now).toISOString(),
      });
      return { allowed: true, remaining: limit - 1 };
    }

    const start = new Date(data.window_start).getTime();
    if (now - start > windowMs) {
      await db
        .from("rate_limits")
        .update({ count: 1, window_start: new Date(now).toISOString() })
        .eq("key", key);
      return { allowed: true, remaining: limit - 1 };
    }

    if (data.count >= limit) {
      return { allowed: false, remaining: 0 };
    }

    await db
      .from("rate_limits")
      .update({ count: data.count + 1 })
      .eq("key", key);
    return { allowed: true, remaining: limit - data.count - 1 };
  } catch {
    return mem();
  }
}
