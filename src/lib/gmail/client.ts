import type { gmail_v1 } from "googleapis";
import { getAuthorizedGmail, isGmailConnected } from "@/lib/gmail/oauth";
import { getDb, type User, type EmailRow } from "@/lib/db/client";

export type ParsedEmail = {
  gmailId: string;
  threadId?: string;
  fromName?: string;
  fromEmail?: string;
  subject?: string;
  snippet?: string;
  receivedAt?: string;
  labels?: string[];
  bodyExcerpt: string;
  isRead: boolean;
};

function decodeBody(data?: string | null): string {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function header(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string | undefined {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

function extractText(payload?: gmail_v1.Schema$MessagePart): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBody(payload.body.data);
  }
  if (payload.parts?.length) {
    for (const part of payload.parts) {
      const text = extractText(part);
      if (text) return text;
    }
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBody(payload.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return decodeBody(payload.body?.data);
}

function parseFrom(raw?: string): { name?: string; email?: string } {
  if (!raw) return {};
  const m = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].replace(/"/g, "").trim(), email: m[2].trim() };
  if (raw.includes("@")) return { email: raw.trim() };
  return { name: raw.trim() };
}

export function parseGmailMessage(msg: gmail_v1.Schema$Message): ParsedEmail {
  const headers = msg.payload?.headers;
  const from = parseFrom(header(headers, "From"));
  const subject = header(headers, "Subject");
  const dateHeader = header(headers, "Date");
  const body = extractText(msg.payload).slice(0, 6000);
  const receivedAt = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : dateHeader
      ? new Date(dateHeader).toISOString()
      : undefined;

  return {
    gmailId: msg.id!,
    threadId: msg.threadId ?? undefined,
    fromName: from.name,
    fromEmail: from.email,
    subject,
    snippet: msg.snippet ?? undefined,
    receivedAt,
    labels: msg.labelIds ?? undefined,
    bodyExcerpt: body || msg.snippet || "",
    isRead: !(msg.labelIds ?? []).includes("UNREAD"),
  };
}

export async function listRecentEmails(
  user: User,
  opts: { max?: number; query?: string; after?: Date } = {}
): Promise<ParsedEmail[]> {
  if (!isGmailConnected(user)) throw new Error("GMAIL_NOT_CONNECTED");
  const gmail = await getAuthorizedGmail(user);
  const max = Math.min(opts.max ?? 10, 25);
  let q = opts.query ?? "in:inbox";
  if (opts.after) {
    const epoch = Math.floor(opts.after.getTime() / 1000);
    q += ` after:${epoch}`;
  }

  const list = await gmail.users.messages.list({
    userId: "me",
    q,
    maxResults: max,
  });

  const ids = list.data.messages ?? [];
  const results: ParsedEmail[] = [];
  for (const item of ids) {
    if (!item.id) continue;
    const full = await gmail.users.messages.get({
      userId: "me",
      id: item.id,
      format: "full",
    });
    results.push(parseGmailMessage(full.data));
  }
  return results;
}

export async function getEmailByGmailId(user: User, gmailId: string): Promise<ParsedEmail> {
  if (!isGmailConnected(user)) throw new Error("GMAIL_NOT_CONNECTED");
  const gmail = await getAuthorizedGmail(user);
  const full = await gmail.users.messages.get({
    userId: "me",
    id: gmailId,
    format: "full",
  });
  return parseGmailMessage(full.data);
}

export async function searchEmails(user: User, query: string, max = 10) {
  return listRecentEmails(user, { query, max });
}

export async function upsertEmailRecord(userId: string, email: ParsedEmail): Promise<EmailRow> {
  const db = getDb();
  const { data, error } = await db
    .from("emails")
    .upsert(
      {
        user_id: userId,
        gmail_id: email.gmailId,
        thread_id: email.threadId ?? null,
        from_name: email.fromName ?? null,
        from_email: email.fromEmail ?? null,
        subject: email.subject ?? null,
        snippet: email.snippet ?? null,
        received_at: email.receivedAt ?? null,
        labels: email.labels ?? [],
        is_read: email.isRead,
        body_excerpt: email.bodyExcerpt.slice(0, 4000),
      },
      { onConflict: "user_id,gmail_id" }
    )
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("email upsert failed");
  return data;
}

export async function sendGmailReply(user: User, input: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
}) {
  if (!isGmailConnected(user)) throw new Error("GMAIL_NOT_CONNECTED");
  const gmail = await getAuthorizedGmail(user);
  const subject = input.subject.startsWith("Re:") ? input.subject : `Re: ${input.subject}`;
  const raw = [
    `To: ${input.to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
  ].join("\r\n");

  const encoded = Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encoded,
      threadId: input.threadId,
    },
  });
}

export async function setupGmailWatch(user: User): Promise<{ historyId?: string; expiration?: string }> {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic) return {};
  if (!isGmailConnected(user)) throw new Error("GMAIL_NOT_CONNECTED");
  const gmail = await getAuthorizedGmail(user);
  const res = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName: topic,
      labelIds: ["INBOX"],
    },
  });

  const db = getDb();
  await db
    .from("users")
    .update({
      gmail_history_id: res.data.historyId ?? null,
      gmail_watch_expiration: res.data.expiration
        ? new Date(Number(res.data.expiration)).toISOString()
        : null,
    })
    .eq("id", user.id);

  return {
    historyId: res.data.historyId ?? undefined,
    expiration: res.data.expiration
      ? new Date(Number(res.data.expiration)).toISOString()
      : undefined,
  };
}

export async function listHistoryMessages(user: User, startHistoryId: string) {
  if (!isGmailConnected(user)) throw new Error("GMAIL_NOT_CONNECTED");
  const gmail = await getAuthorizedGmail(user);
  try {
    const history = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded"],
      labelId: "INBOX",
    });
    const ids = new Set<string>();
    for (const h of history.data.history ?? []) {
      for (const added of h.messagesAdded ?? []) {
        if (added.message?.id) ids.add(added.message.id);
      }
    }
    if (history.data.historyId) {
      await getDb()
        .from("users")
        .update({ gmail_history_id: history.data.historyId })
        .eq("id", user.id);
    }
    return [...ids];
  } catch {
    // historyId too old — caller should fall back to recent poll
    return null;
  }
}
