export type AppEnv = {
  NEXT_PUBLIC_APP_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ALLOWED_USER_IDS: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GMAIL_PUBSUB_TOPIC?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  CRON_SECRET?: string;
  SERPER_API_KEY?: string;
};

function str(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

function httpUrl(v: string | undefined): string | undefined {
  const t = str(v);
  if (!t) return undefined;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return t;
  } catch {
    return undefined;
  }
}

let cached: AppEnv | null = null;

/**
 * Never throws. Invalid/empty env values become undefined.
 * This must stay safe during `next build` prerender.
 */
export function getEnv(): AppEnv {
  if (cached) return cached;
  cached = {
    NEXT_PUBLIC_APP_URL: httpUrl(process.env.NEXT_PUBLIC_APP_URL),
    TELEGRAM_BOT_TOKEN: str(process.env.TELEGRAM_BOT_TOKEN),
    TELEGRAM_ALLOWED_USER_IDS: process.env.TELEGRAM_ALLOWED_USER_IDS ?? "",
    TELEGRAM_WEBHOOK_SECRET: str(process.env.TELEGRAM_WEBHOOK_SECRET),
    GOOGLE_CLIENT_ID: str(process.env.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: str(process.env.GOOGLE_CLIENT_SECRET),
    GOOGLE_REDIRECT_URI: httpUrl(process.env.GOOGLE_REDIRECT_URI),
    GMAIL_PUBSUB_TOPIC: str(process.env.GMAIL_PUBSUB_TOPIC),
    GEMINI_API_KEY: str(process.env.GEMINI_API_KEY),
    GEMINI_MODEL: str(process.env.GEMINI_MODEL) || "gemini-3.6-flash",
    NEXT_PUBLIC_SUPABASE_URL: httpUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: str(process.env.SUPABASE_SERVICE_ROLE_KEY),
    TOKEN_ENCRYPTION_KEY: str(process.env.TOKEN_ENCRYPTION_KEY),
    CRON_SECRET: str(process.env.CRON_SECRET),
    SERPER_API_KEY: str(process.env.SERPER_API_KEY),
  };
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
}
