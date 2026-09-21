import { z } from "zod";

/** Empty or invalid values become undefined — never fail the build. */
function softString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function softUrl(v: unknown): string | undefined {
  const t = softString(v);
  if (!t) return undefined;
  try {
    // Accept only absolute http(s) URLs
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return t;
  } catch {
    return undefined;
  }
}

const envSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.preprocess(softUrl, z.string().url().optional()),
  TELEGRAM_BOT_TOKEN: z.preprocess(softString, z.string().min(1).optional()),
  TELEGRAM_ALLOWED_USER_IDS: z.string().optional().default(""),
  TELEGRAM_WEBHOOK_SECRET: z.preprocess(softString, z.string().min(1).optional()),
  GOOGLE_CLIENT_ID: z.preprocess(softString, z.string().min(1).optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(softString, z.string().min(1).optional()),
  GOOGLE_REDIRECT_URI: z.preprocess(softUrl, z.string().url().optional()),
  GMAIL_PUBSUB_TOPIC: z.preprocess(softString, z.string().min(1).optional()),
  GEMINI_API_KEY: z.preprocess(softString, z.string().min(1).optional()),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(softUrl, z.string().url().optional()),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(softString, z.string().min(1).optional()),
  TOKEN_ENCRYPTION_KEY: z.preprocess(softString, z.string().min(1).optional()),
  CRON_SECRET: z.preprocess(softString, z.string().min(1).optional()),
  SERPER_API_KEY: z.preprocess(softString, z.string().min(1).optional()),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_ALLOWED_USER_IDS: process.env.TELEGRAM_ALLOWED_USER_IDS ?? "",
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GMAIL_PUBSUB_TOPIC: process.env.GMAIL_PUBSUB_TOPIC,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
  });

  if (!parsed.success) {
    // Last resort: never crash build/runtime for env shape
    cached = {
      NEXT_PUBLIC_APP_URL: softUrl(process.env.NEXT_PUBLIC_APP_URL),
      TELEGRAM_BOT_TOKEN: softString(process.env.TELEGRAM_BOT_TOKEN),
      TELEGRAM_ALLOWED_USER_IDS: process.env.TELEGRAM_ALLOWED_USER_IDS ?? "",
      TELEGRAM_WEBHOOK_SECRET: softString(process.env.TELEGRAM_WEBHOOK_SECRET),
      GOOGLE_CLIENT_ID: softString(process.env.GOOGLE_CLIENT_ID),
      GOOGLE_CLIENT_SECRET: softString(process.env.GOOGLE_CLIENT_SECRET),
      GOOGLE_REDIRECT_URI: softUrl(process.env.GOOGLE_REDIRECT_URI),
      GMAIL_PUBSUB_TOPIC: softString(process.env.GMAIL_PUBSUB_TOPIC),
      GEMINI_API_KEY: softString(process.env.GEMINI_API_KEY),
      GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3.6-flash",
      NEXT_PUBLIC_SUPABASE_URL: softUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: softString(process.env.SUPABASE_SERVICE_ROLE_KEY),
      TOKEN_ENCRYPTION_KEY: softString(process.env.TOKEN_ENCRYPTION_KEY),
      CRON_SECRET: softString(process.env.CRON_SECRET),
      SERPER_API_KEY: softString(process.env.SERPER_API_KEY),
    };
    return cached;
  }

  cached = parsed.data;
  return cached;
}

export function requireEnv<K extends keyof AppEnv>(key: K): NonNullable<AppEnv[K]> {
  const value = getEnv()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${String(key)}`);
  }
  return value as NonNullable<AppEnv[K]>;
}

export function appUrl(path = ""): string {
  const fromEnv = getEnv().NEXT_PUBLIC_APP_URL;
  const fromVercel = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : undefined;
  const base = fromEnv || fromVercel || "http://127.0.0.1:43127";
  return `${String(base).replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export function allowedTelegramIds(): number[] {
  const raw = getEnv().TELEGRAM_ALLOWED_USER_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

export function setupStatus() {
  try {
    const e = getEnv();
    return {
      telegram: Boolean(e.TELEGRAM_BOT_TOKEN),
      gemini: Boolean(e.GEMINI_API_KEY),
      supabase: Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY),
      google: Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
      encryption: Boolean(e.TOKEN_ENCRYPTION_KEY),
      cron: Boolean(e.CRON_SECRET),
      webhookSecret: Boolean(e.TELEGRAM_WEBHOOK_SECRET),
      search: Boolean(e.SERPER_API_KEY) ? ("serper" as const) : ("duckduckgo" as const),
    };
  } catch {
    return {
      telegram: false,
      gemini: false,
      supabase: false,
      google: false,
      encryption: false,
      cron: false,
      webhookSecret: false,
      search: "duckduckgo" as const,
    };
  }
}
