import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type User = {
  id: string;
  telegram_id: number;
  telegram_username: string | null;
  display_name: string | null;
  timezone: string;
  locale: string;
  is_owner: boolean;
  gmail_email: string | null;
  gmail_access_token_enc: string | null;
  gmail_refresh_token_enc: string | null;
  gmail_token_expiry: string | null;
  gmail_history_id: string | null;
  gmail_watch_expiration: string | null;
  created_at: string;
  updated_at: string;
};

export type Settings = {
  id: string;
  user_id: string;
  notify_email_priority: "high" | "medium" | "low";
  morning_briefing_enabled: boolean;
  morning_briefing_hour: number;
  language: string;
  email_digest_include_low: boolean;
  max_emails_per_analysis: number;
  preferences: Json;
  created_at: string;
  updated_at: string;
};

export type Task = {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  status: "open" | "done" | "cancelled";
  priority: "high" | "medium" | "low";
  due_at: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  source: string | null;
  source_email_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type Reminder = {
  id: string;
  user_id: string;
  text: string;
  remind_at: string;
  status: "pending" | "sent" | "cancelled";
  recurrence: string | null;
  recurrence_rule: string | null;
  related_task_id: string | null;
  created_at: string;
  sent_at: string | null;
};

export type EmailRow = {
  id: string;
  user_id: string;
  gmail_id: string;
  thread_id: string | null;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  labels: string[] | null;
  is_read: boolean | null;
  raw_headers: Json;
  body_excerpt: string | null;
  created_at: string;
};

export type EmailSummary = {
  id: string;
  email_id: string;
  user_id: string;
  priority: "high" | "medium" | "low";
  purpose: string | null;
  what_they_want: string[] | null;
  action_required: string | null;
  deadline: string | null;
  urgency: string | null;
  summary: string | null;
  uncertain: string | null;
  extracted_actions: Json;
  notified: boolean;
  draft_reply: string | null;
  created_at: string;
};

export type MemoryItem = {
  id: string;
  user_id: string;
  kind: "note" | "preference" | "project" | "routine";
  content: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type PendingAction = {
  id: string;
  user_id: string;
  kind: "send_email" | "create_reminder" | "create_task" | "draft_reply";
  payload: Record<string, unknown>;
  status: "pending" | "confirmed" | "cancelled" | "expired";
  telegram_message_id: number | null;
  expires_at: string;
  created_at: string;
};

export type ConversationMessage = {
  id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

let client: SupabaseClient | null = null;

/** Untyped client — schema enforced in repositories via casts. */
export function getDb(): SupabaseClient {
  if (client) return client;
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function isDbConfigured(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}
