/** HTML helpers for Telegram parse_mode=HTML */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function bold(s: string): string {
  return `<b>${escapeHtml(s)}</b>`;
}

export function italic(s: string): string {
  return `<i>${escapeHtml(s)}</i>`;
}

export function code(s: string): string {
  return `<code>${escapeHtml(s)}</code>`;
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}ч ${m.toString().padStart(2, "0")}м ${sec.toString().padStart(2, "0")}с`;
  if (m > 0) return `${m}м ${sec.toString().padStart(2, "0")}с`;
  return `${sec}с`;
}

export function ruWhen(d: Date): string {
  return d.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
