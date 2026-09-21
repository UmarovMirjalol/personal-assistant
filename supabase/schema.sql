-- Personal Telegram AI Assistant — Supabase schema
-- Run this in Supabase SQL Editor once.

create extension if not exists "pgcrypto";

-- ─── users ─────────────────────────────────────────────
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  telegram_username text,
  display_name text,
  timezone text not null default 'UTC',
  locale text not null default 'ru',
  is_owner boolean not null default false,
  gmail_email text,
  -- AES-GCM encrypted OAuth tokens (never plaintext)
  gmail_access_token_enc text,
  gmail_refresh_token_enc text,
  gmail_token_expiry timestamptz,
  gmail_history_id text,
  gmail_watch_expiration timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_telegram_id_idx on users (telegram_id);

-- ─── settings ──────────────────────────────────────────
create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade unique,
  notify_email_priority text not null default 'medium'
    check (notify_email_priority in ('high', 'medium', 'low')),
  morning_briefing_enabled boolean not null default false,
  morning_briefing_hour int not null default 8 check (morning_briefing_hour between 0 and 23),
  language text not null default 'ru',
  email_digest_include_low boolean not null default false,
  max_emails_per_analysis int not null default 15,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── tasks ─────────────────────────────────────────────
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'open'
    check (status in ('open', 'done', 'cancelled')),
  priority text not null default 'medium'
    check (priority in ('high', 'medium', 'low')),
  due_at timestamptz,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  source text default 'manual',
  source_email_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_user_status_idx on tasks (user_id, status);
create index if not exists tasks_user_due_idx on tasks (user_id, due_at);

-- ─── reminders ─────────────────────────────────────────
create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  text text not null,
  remind_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'cancelled')),
  recurrence text, -- cron-like or natural: daily|weekly|none
  recurrence_rule text, -- e.g. "every monday at 18:00"
  related_task_id uuid references tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists reminders_due_idx
  on reminders (status, remind_at)
  where status = 'pending';

-- ─── emails (metadata + analysis cache) ────────────────
create table if not exists emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  gmail_id text not null,
  thread_id text,
  from_name text,
  from_email text,
  subject text,
  snippet text,
  received_at timestamptz,
  labels text[] default '{}',
  is_read boolean default false,
  raw_headers jsonb default '{}'::jsonb,
  -- Do NOT store full body long-term if avoidable; keep short excerpt
  body_excerpt text,
  created_at timestamptz not null default now(),
  unique (user_id, gmail_id)
);

create index if not exists emails_user_received_idx on emails (user_id, received_at desc);

-- ─── email_summaries ───────────────────────────────────
create table if not exists email_summaries (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references emails(id) on delete cascade unique,
  user_id uuid not null references users(id) on delete cascade,
  priority text not null check (priority in ('high', 'medium', 'low')),
  purpose text,
  what_they_want text[], -- action bullets
  action_required text,
  deadline text,
  urgency text,
  summary text,
  uncertain text,
  extracted_actions jsonb default '[]'::jsonb,
  notified boolean not null default false,
  draft_reply text,
  created_at timestamptz not null default now()
);

create index if not exists email_summaries_user_priority_idx
  on email_summaries (user_id, priority, created_at desc);

-- ─── conversation_messages (short-term context only) ───
create table if not exists conversation_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists conversation_user_created_idx
  on conversation_messages (user_id, created_at desc);

-- Keep only recent messages via periodic cleanup (app-side)

-- ─── memory (useful long-term facts only) ──────────────
create table if not exists memory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null default 'note'
    check (kind in ('note', 'preference', 'project', 'routine')),
  content text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── pending_actions (confirm before send email / create reminder) ─
create table if not exists pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null
    check (kind in ('send_email', 'create_reminder', 'create_task', 'draft_reply')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  telegram_message_id bigint,
  expires_at timestamptz not null default (now() + interval '1 hour'),
  created_at timestamptz not null default now()
);

-- ─── rate_limits ───────────────────────────────────────
create table if not exists rate_limits (
  key text primary key,
  count int not null default 0,
  window_start timestamptz not null default now()
);

-- updated_at trigger
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_updated_at on users;
create trigger users_updated_at before update on users
  for each row execute function set_updated_at();

drop trigger if exists settings_updated_at on settings;
create trigger settings_updated_at before update on settings
  for each row execute function set_updated_at();

drop trigger if exists tasks_updated_at on tasks;
create trigger tasks_updated_at before update on tasks
  for each row execute function set_updated_at();
