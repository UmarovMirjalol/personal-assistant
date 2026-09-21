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

  const access = user.gmail_access_token_enc
    ? decryptSecret(user.gmail_access_token_enc)
    : undefined;
  const refresh = user.gmail_refresh_token_enc
    ? decryptSecret(user.gmail_refresh_token_enc)
    : undefined;
  const expiryMs = user.gmail_token_expiry
    ? new Date(user.gmail_token_expiry).getTime()
    : undefined;

  const expired =
    typeof expiryMs === "number" && Number.isFinite(expiryMs)
      ? expiryMs < Date.now() - 30_000
      : false;

  // Need refresh but OAuth app credentials are not available on this host
  if (expired && !hasGoogleOAuthCredentials()) {
    if (!access) {
      throw new Error("GMAIL_REAUTH_REQUIRED");
    }
    // Try the stored access token anyway — sometimes clock skew / soft expiry
  }

  const client = getApiAuthClient();
  client.setCredentials({
    access_token: access,
    refresh_token: hasGoogleOAuthCredentials() ? refresh : undefined,
    expiry_date: expiryMs,
  });

  if (hasGoogleOAuthCredentials()) {
    client.on("tokens", async (tokens) => {
      try {
        await saveGmailTokens(user.id, tokens);
      } catch {
        // avoid logging token material
      }
    });

    // Proactively refresh if close to expiry
    if (expired || (expiryMs && expiryMs < Date.now() + 60_000)) {
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

export function isGmailConnected(user: User): boolean {
  return Boolean(user.gmail_refresh_token_enc || user.gmail_access_token_enc);
}

export async function fetchProfileEmail(user: User): Promise<string | null> {
  const gmail = await getAuthorizedGmail(user);
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress ?? null;
}
