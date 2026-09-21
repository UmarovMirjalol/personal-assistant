# Aether — Personal Telegram AI Assistant

Production-ready personal AI assistant. Primary interface: **Telegram**.
Stack: Next.js · TypeScript · Vercel · Telegram Bot API · Gmail API · Gemini · Supabase · free web search.

## What it does

- Natural-language chat in Telegram (no slash commands required for daily use)
- Gmail intelligence: purpose, what they want from you, actions, deadline, urgency
- Priority filtering (HIGH / MEDIUM / LOW) with configurable notification threshold
- Email digest + structured action extraction + draft reply with explicit Send confirmation
- Tasks, day planner, reminders (including relative & recurring)
- Web research with sources (Serper if configured, else DuckDuckGo)
- Morning briefing (opt-in in Settings)
- Extensible tool/agent architecture (calendar hooks ready later)

---

## 1. Project structure

```
src/
  app/
    page.tsx                          # Status / landing
    connect/page.tsx                  # Gmail OAuth entry
    api/
      telegram/webhook/route.ts       # Telegram updates
      auth/google/route.ts            # Start OAuth
      auth/google/callback/route.ts   # OAuth callback
      gmail/pubsub/route.ts           # Gmail push (Pub/Sub)
      cron/reminders/route.ts         # Due reminders
      cron/email-poll/route.ts        # Gmail polling fallback
      cron/morning-briefing/route.ts  # Opt-in briefing
      setup/webhook/route.ts          # setWebhook helper
      health/route.ts
  lib/
    ai/          # Gemini + agent + tools
    gmail/       # OAuth, fetch, analyze, sync
    telegram/    # Bot client, keyboards, handler
    db/          # Supabase client + repositories
    crypto/      # AES-256-GCM token encryption
    research/    # Web search
    reminders/   # NL time parsing
    security/    # Rate limit + validation
supabase/schema.sql
.env.example
vercel.json
```

---

## 2. Environment variables

Copy `.env.example` → `.env.local` (local) and set the same keys in Vercel.

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | yes | Public URL, e.g. `https://xxx.vercel.app` |
| `TELEGRAM_BOT_TOKEN` | yes | From @BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | recommended | Your Telegram user id(s), comma-separated |
| `TELEGRAM_WEBHOOK_SECRET` | yes | Random string; appended as `?secret=` on webhook |
| `GOOGLE_CLIENT_ID` | yes | Google OAuth client |
| `GOOGLE_CLIENT_SECRET` | yes | Google OAuth secret |
| `GOOGLE_REDIRECT_URI` | yes | `{APP_URL}/api/auth/google/callback` |
| `GMAIL_PUBSUB_TOPIC` | no | `projects/PROJECT/topics/TOPIC` for push |
| `GEMINI_API_KEY` | yes | Google AI Studio |
| `GEMINI_MODEL` | no | Default `gemini-3.6-flash` |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role (server only) |
| `TOKEN_ENCRYPTION_KEY` | yes | 64-char hex (or any long secret) |
| `CRON_SECRET` | yes | Protects `/api/cron/*` and webhook setup |
| `SERPER_API_KEY` | no | Better search; else DuckDuckGo fallback |

Generate secrets:

```bash
openssl rand -hex 32   # TOKEN_ENCRYPTION_KEY
openssl rand -hex 16   # TELEGRAM_WEBHOOK_SECRET
openssl rand -base64 32 # CRON_SECRET
```

---

## 3. Create Telegram bot

1. Open Telegram → [@BotFather](https://t.me/BotFather)
2. `/newbot` → name + username
3. Copy the token → `TELEGRAM_BOT_TOKEN`
4. Get your user id via [@userinfobot](https://t.me/userinfobot) → `TELEGRAM_ALLOWED_USER_IDS`
5. **Security:** if a token was ever pasted into chat, revoke it in BotFather (`/revoke`) and create a new one.

---

## 4. Google OAuth + Gmail API

1. [Google Cloud Console](https://console.cloud.google.com/) → create project
2. Enable **Gmail API**
3. OAuth consent screen → External (or Internal if Workspace) → add your Google account as test user
4. Credentials → **OAuth client ID** → Web application
5. Authorized redirect URIs:
   - `http://127.0.0.1:43127/api/auth/google/callback` (local)
   - `https://YOUR_DOMAIN/api/auth/google/callback` (prod)
6. Copy Client ID / Secret → env
7. Scopes used (minimal for MVP):
   - `gmail.readonly`
   - `gmail.send`
   - `gmail.modify` (labels / watch)
   - `openid` + `email`

### Optional: Gmail Pub/Sub (event-driven, preferred)

1. Create Pub/Sub topic, e.g. `gmail-push`
2. Grant `gmail-api-push@system.gserviceaccount.com` Publisher on the topic
3. Create **Push** subscription → endpoint `https://YOUR_DOMAIN/api/gmail/pubsub`
4. Set `GMAIL_PUBSUB_TOPIC=projects/PROJECT_ID/topics/gmail-push`
5. On Gmail connect, the app calls `users.watch`

### Polling fallback (always available)

Vercel Hobby cron cannot poll every few minutes. Use a free external cron:

- [cron-job.org](https://cron-job.org) every 5–10 min:
  - `GET https://YOUR_DOMAIN/api/cron/email-poll?secret=CRON_SECRET`
  - `GET https://YOUR_DOMAIN/api/cron/reminders?secret=CRON_SECRET`

Hourly Vercel cron for reminders is configured in `vercel.json` (Pro plans honor sub-daily schedules better).

---

## 5. Gemini API key

1. Open [Google AI Studio](https://aistudio.google.com/apikey)
2. Create API key → `GEMINI_API_KEY`
3. Default model `gemini-3.6-flash` (generous free tier). Keep prompts/tool results short to stay within limits.

---

## 6. Supabase

1. Create project at [supabase.com](https://supabase.com)
2. Settings → API → copy Project URL + **service_role** key
3. SQL Editor → paste and run `supabase/schema.sql`
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

OAuth tokens are stored **encrypted** (`gmail_*_token_enc`), never plaintext.

---

## 7. Deploy on Vercel

```bash
npm i -g vercel
vercel
vercel env add ...   # set all secrets
vercel --prod
```

Or connect the GitHub repo in the Vercel dashboard and add env vars there.

Set `NEXT_PUBLIC_APP_URL` to the production URL.

---

## 8. Install Telegram webhook

After deploy:

```bash
curl -X POST "https://YOUR_DOMAIN/api/setup/webhook?secret=CRON_SECRET"
```

Webhook URL shape:

`https://YOUR_DOMAIN/api/telegram/webhook?secret=TELEGRAM_WEBHOOK_SECRET`

Verify:

```bash
curl "https://YOUR_DOMAIN/api/setup/webhook?secret=CRON_SECRET"
```

---

## 9. Local development

```bash
cp .env.example .env.local
# fill secrets
npm install
npm run dev -- -p 43127
```

For Telegram webhooks locally, use a tunnel (Cloudflare Tunnel / ngrok) and point webhook to the tunnel URL.

Then open the bot and send `/start`.

---

## 10. Security checklist

- [ ] `.env*` not committed (`.gitignore` covers it)
- [ ] Bot token rotated if it was ever exposed in chat
- [ ] `TELEGRAM_ALLOWED_USER_IDS` set to your id only
- [ ] Webhook URL includes `TELEGRAM_WEBHOOK_SECRET`
- [ ] Cron routes require `CRON_SECRET`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` only on server
- [ ] `TOKEN_ENCRYPTION_KEY` set; tokens encrypted at rest
- [ ] No API keys in client bundles / frontend
- [ ] Security headers enabled (`next.config.ts`)
- [ ] Email body contents not written to application logs
- [ ] Draft replies never auto-send — explicit **Send** only

---

## 11. Production checklist

- [ ] `supabase/schema.sql` applied
- [ ] All env vars set on Vercel
- [ ] Google OAuth redirect URI matches prod
- [ ] Webhook installed and `getWebhookInfo` shows correct URL
- [ ] External cron for `/api/cron/email-poll` and `/api/cron/reminders` (if not on Pub/Sub / Pro cron)
- [ ] Gmail connected from Telegram → Settings
- [ ] Test: reminder in 2 minutes
- [ ] Test: «что пришло сегодня?»
- [ ] Test: research query
- [ ] Morning briefing toggled only if desired
- [ ] `npm run build` succeeds

---

## Natural language examples

- «что у меня сегодня?»
- «напомни завтра в 16:00 отправить CV профессору»
- «через 2 часа напомни проверить почту»
- «что важного пришло?»
- «разбери последние письма»
- «найди последние исследования по startup failure prediction»
- «завтра у меня школа до 14, потом 2 часа research, в 19 футбол»
- «забудь это»

Slash shortcuts: `/start` `/today` `/tasks` `/emails` `/research` `/help`

---

## Email notification format

Important emails are pushed as:

```
📩 NEW EMAIL
From: …
Subject: …
PURPOSE: …
WHAT THEY WANT FROM ME: …
ACTION REQUIRED: … | None
DEADLINE: … | Not specified
URGENCY: HIGH|MEDIUM|LOW
SUMMARY: …
UNCERTAIN: …   # only when needed
```

Inline actions: Create task · Set reminder · Draft reply → Send / Edit / Cancel

---

## License

Private personal use.
