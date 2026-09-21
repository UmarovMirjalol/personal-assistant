import Link from "next/link";
import { setupStatus } from "@/lib/env";

export default function HomePage() {
  const status = setupStatus();
  const checks = [
    { label: "Telegram bot", ok: status.telegram },
    { label: "Gemini", ok: status.gemini },
    { label: "Supabase", ok: status.supabase },
    { label: "Google OAuth", ok: status.google },
    { label: "Token encryption", ok: status.encryption },
    { label: "Cron secret", ok: status.cron },
  ];

  return (
    <main className="relative flex-1 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="glow-dot absolute left-[12%] top-[28%] h-2 w-2 rounded-full bg-[var(--accent)]" />
        <div className="glow-dot absolute right-[18%] top-[42%] h-1.5 w-1.5 rounded-full bg-[var(--accent)] [animation-delay:1s]" />
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pb-20 pt-16 sm:pt-24">
        <header className="animate-rise">
          <p className="mb-3 text-sm tracking-[0.22em] text-[var(--accent)] uppercase">
            Aether
          </p>
          <h1
            className="max-w-xl text-4xl leading-tight text-[var(--ink)] sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Your private Telegram AI for mail, plans, and research.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-[var(--muted)]">
            Talk normally in Telegram. Aether reads what people want from your
            Gmail, builds your day, sets reminders, and researches the web —
            without slash-command gymnastics.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/connect"
              className="rounded-md bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[#062214] transition hover:brightness-110"
            >
              Connect Gmail
            </Link>
            <a
              href="/api/health"
              className="rounded-md border border-[var(--stroke)] px-5 py-2.5 text-sm text-[var(--ink)] transition hover:bg-[var(--card)]"
            >
              Health check
            </a>
          </div>
        </header>

        <section className="animate-rise-delay border-t border-[var(--stroke)] pt-8">
          <h2 className="text-sm tracking-[0.18em] text-[var(--muted)] uppercase">
            Environment
          </h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {checks.map((c) => (
              <li
                key={c.label}
                className="flex items-center justify-between rounded-md border border-[var(--stroke)] bg-[var(--card)] px-3 py-2 text-sm"
              >
                <span>{c.label}</span>
                <span className={c.ok ? "text-[var(--accent)]" : "text-[var(--warn)]"}>
                  {c.ok ? "ready" : "missing"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-[var(--muted)]">
            Search provider: <span className="text-[var(--ink)]">{status.search}</span>
            . Full setup guide is in the README.
          </p>
        </section>
      </div>
    </main>
  );
}
