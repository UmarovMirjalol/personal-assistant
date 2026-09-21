import { google } from "googleapis";
import { getEnv, appUrl } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { getDb, type User } from "@/lib/db/client";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "openid",
  "email",
];

export function hasGoogleOAuthCredentials(): boolean {
  const e = getEnv();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}

export function getOAuthClient() {
  const e = getEnv();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "GOOGLE_OAUTH_NOT_CONFIGURED: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"
    );
  }
  return new google.auth.OAuth2(
    e.GOOGLE_CLIENT_ID,
    e.GOOGLE_CLIENT_SECRET,
    e.GOOGLE_REDIRECT_URI || appUrl("/api/auth/google/callback")
  );
}

/** Client for API calls — works with access token even if OAuth app creds are missing. */
function getApiAuthClient() {
  const e = getEnv();
  if (e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) {
    return new google.auth.OAuth2(
      e.GOOGLE_CLIENT_ID,
      e.GOOGLE_CLIENT_SECRET,
      e.GOOGLE_REDIRECT_URI || appUrl("/api/auth/google/callback")
    );
  }
  // Access-token-only mode (no refresh). Enough for live inbox while token is valid.
  return new google.auth.OAuth2();
}

export function getGmailAuthUrl(state: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function saveGmailTokens(
  userId: string,
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
  },
  email?: string
) {
  const db = getDb();
  const patch: Record<string, unknown> = {};
  if (tokens.access_token) {
    patch.gmail_access_token_enc = encryptSecret(tokens.access_token);
  }
  if (tokens.refresh_token) {
    patch.gmail_refresh_token_enc = encryptSecret(tokens.refresh_token);
  }
  if (tokens.expiry_date) {
    patch.gmail_token_expiry = new Date(tokens.expiry_date).toISOString();
  }
  if (email) patch.gmail_email = email;

  const { error } = await db.from("users").update(patch).eq("id", userId);
  if (error) throw error;
}

export async function getAuthorizedGmail(user: User) {
  if (!user.gmail_refresh_token_enc && !user.gmail_access_token_enc) {
    throw new Error("GMAIL_NOT_CONNECTED");
  }

  // When this host has no Google OAuth app creds, ask production to refresh
  // into shared Supabase, then reload tokens.
  const expiryMs = user.gmail_token_expiry
    ? new Date(user.gmail_token_expiry).getTime()
    : undefined;
  const needsRefresh =
    !expiryMs ||
    !Number.isFinite(expiryMs) ||
    expiryMs < Date.now() + 5 * 60_000;

  if (needsRefresh && !hasGoogleOAuthCredentials()) {
    await refreshTokensViaProduction();
    const db = getDb();
    const { data: fresh } = await db
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();
    if (fresh) user = fresh as User;
  }

  const access = user.gmail_access_token_enc
    ? decryptSecret(user.gmail_access_token_enc)
    : undefined;
  const refresh = user.gmail_refresh_token_enc
    ? decryptSecret(user.gmail_refresh_token_enc)
    : undefined;
  const expiryMs2 = user.gmail_token_expiry
    ? new Date(user.gmail_token_expiry).getTime()
    : undefined;

  const expired =
    typeof expiryMs2 === "number" && Number.isFinite(expiryMs2)
      ? expiryMs2 < Date.now() - 30_000
      : false;

  if (expired && !hasGoogleOAuthCredentials()) {
    await refreshTokensViaProduction();
    const db = getDb();
    const { data: fresh } = await db
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();
    if (fresh) {
      user = fresh as User;
    } else {
      throw new Error("GMAIL_REAUTH_REQUIRED");
    }
  }

  const access2 = user.gmail_access_token_enc
    ? decryptSecret(user.gmail_access_token_enc)
    : undefined;
  const refresh2 = user.gmail_refresh_token_enc
    ? decryptSecret(user.gmail_refresh_token_enc)
    : undefined;
  const expiryMs3 = user.gmail_token_expiry
    ? new Date(user.gmail_token_expiry).getTime()
    : undefined;

  const client = getApiAuthClient();
  client.setCredentials({
    access_token: access2,
    refresh_token: hasGoogleOAuthCredentials() ? refresh2 : undefined,
    expiry_date: expiryMs3,
  });

  if (hasGoogleOAuthCredentials()) {
    client.on("tokens", async (tokens) => {
      try {
        await saveGmailTokens(user.id, tokens);
      } catch {
        // avoid logging token material
      }
    });

    // Refresh early — Gmail access tokens live ~1h
    if (!expiryMs3 || expiryMs3 < Date.now() + 30 * 60_000) {
      try {
        const { credentials } = await client.refreshAccessToken();
        client.setCredentials(credentials);
        await saveGmailTokens(user.id, credentials);
      } catch {
        throw new Error("GMAIL_REAUTH_REQUIRED");
      }
    }
  }

  return google.gmail({ version: "v1", auth: client });
}

/** Hit production cron to refresh Gmail tokens into shared Supabase. */
async function refreshTokensViaProduction(): Promise<void> {
  const e = getEnv();
  const secret = e.CRON_SECRET;
  const base =
    e.APP_URL?.replace(/\/$/, "") ||
    "https://personal-assistant-eight-lake.vercel.app";
  if (!secret) return;
  try {
    const urls = [
      `${base}/api/cron/gmail-refresh?secret=${encodeURIComponent(secret)}`,
      `${base}/api/cron/email-poll?secret=${encodeURIComponent(secret)}`,
    ];
    for (const url of urls) {
      const res = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) return;
    }
  } catch {
    // caller will fail with REAUTH if still expired
  }
}

export function isGmailConnected(user: User): boolean {
  return Boolean(user.gmail_refresh_token_enc || user.gmail_access_token_enc);
}

export async function fetchProfileEmail(user: User): Promise<string | null> {
  const gmail = await getAuthorizedGmail(user);
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress ?? null;
}
