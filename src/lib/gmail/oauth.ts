import { google } from "googleapis";
import { getEnv, requireEnv, appUrl } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { getDb, type User } from "@/lib/db/client";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "openid",
  "email",
];

export function getOAuthClient() {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    getEnv().GOOGLE_REDIRECT_URI || appUrl("/api/auth/google/callback")
  );
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

  const client = getOAuthClient();
  const access = user.gmail_access_token_enc
    ? decryptSecret(user.gmail_access_token_enc)
    : undefined;
  const refresh = user.gmail_refresh_token_enc
    ? decryptSecret(user.gmail_refresh_token_enc)
    : undefined;

  client.setCredentials({
    access_token: access,
    refresh_token: refresh,
    expiry_date: user.gmail_token_expiry
      ? new Date(user.gmail_token_expiry).getTime()
      : undefined,
  });

  client.on("tokens", async (tokens) => {
    try {
      await saveGmailTokens(user.id, tokens);
    } catch {
      // avoid logging token material
    }
  });

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
