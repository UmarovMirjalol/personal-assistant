import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_ALLOWED_USER_IDS: z.string().optional().default(""),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GMAIL_PUBSUB_TOPIC: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  SERPER_API_KEY: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  cached = envSchema.parse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_ALLOWED_USER_IDS: process.env.TELEGRAM_ALLOWED_USER_IDS ?? "",
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GMAIL_PUBSUB_TOPIC: process.env.GMAIL_PUBSUB_TOPIC,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
  });
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
  const base = getEnv().NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:43127";
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
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
  const e = getEnv();
  return {
    telegram: Boolean(e.TELEGRAM_BOT_TOKEN),
    gemini: Boolean(e.GEMINI_API_KEY),
    supabase: Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY),
    google: Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
    encryption: Boolean(e.TOKEN_ENCRYPTION_KEY),
    cron: Boolean(e.CRON_SECRET),
    webhookSecret: Boolean(e.TELEGRAM_WEBHOOK_SECRET),
    search: Boolean(e.SERPER_API_KEY) ? "serper" : "duckduckgo",
  };
}
