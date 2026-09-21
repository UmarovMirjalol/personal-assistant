import Link from "next/link";

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ uid?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const uid = params.uid;
  const success = params.success === "1";
  const error = params.error;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-6 py-16">
      <p className="mb-3 text-sm tracking-[0.22em] text-[var(--accent)] uppercase">Aether</p>
      <h1
        className="text-3xl text-[var(--ink)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Connect Gmail
      </h1>
      <p className="mt-3 text-[var(--muted)]">
        One-time Google OAuth. Tokens are encrypted at rest. Scopes are limited to
        Gmail read/send/modify plus email identity.
      </p>

      {success && (
        <p className="mt-6 rounded-md border border-[var(--stroke)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--accent)]">
          Gmail connected. Return to Telegram and try «что пришло сегодня?»
        </p>
      )}

      {error && (
        <p className="mt-6 rounded-md border border-[var(--danger)]/40 bg-[var(--card)] px-4 py-3 text-sm text-[var(--danger)]">
          OAuth error: {error}
        </p>
      )}

      {!uid && !success && (
        <p className="mt-6 text-sm text-[var(--warn)]">
          Open this page from Telegram (Settings → Connect Gmail). The link includes
          your user id.
        </p>
      )}

      {uid && (
        <a
          href={`/api/auth/google?uid=${encodeURIComponent(uid)}`}
          className="mt-8 inline-flex w-fit rounded-md bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[#062214] transition hover:brightness-110"
        >
          Continue with Google
        </a>
      )}

      <Link href="/" className="mt-10 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
        ← Back
      </Link>
    </main>
  );
}
