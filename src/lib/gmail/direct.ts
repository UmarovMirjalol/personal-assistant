import type { User } from "@/lib/db/client";
import { isGmailConnected, listRecentEmails } from "@/lib/gmail";
import { analyzeAndStore } from "@/lib/gmail/analyze";
import { heuristicAnalyze } from "@/lib/gmail/heuristic";
import { appUrl } from "@/lib/env";
import { escapeHtml } from "@/lib/telegram/html";

/** Natural-language email asks — answer via Gmail API, not flaky AI tools. */
export function isEmailQuestion(text: string): boolean {
  return /(?:почт|письм|email|gmail|inbox|инбокс|кто\s+мне\s+написал|последн\w*\s+письм|что\s+(?:важного\s+)?пришло|разбер(?:и|ить)?\s+(?:почт|письм)|какие\s+письм|посмотри.*(почт|письм)|написал.*письм)/i.test(
    text
  );
}

export async function directEmailAnswer(
  user: User,
  text: string
): Promise<string> {
  if (!isGmailConnected(user)) {
    return `Gmail ещё не подключён. Открой: ${appUrl(`/connect?uid=${user.id}`)}`;
  }

  try {
    const wantLatest =
      /последн|кто\s+мне\s+написал|кто\s+написал/i.test(text) &&
      !/все|список|какие|разбер|digest|важн/i.test(text);

    const emails = await listRecentEmails(user, {
      max: wantLatest ? 3 : 8,
      query: "in:inbox",
    });

    if (!emails.length) {
      return "В inbox сейчас пусто.";
    }

    if (wantLatest) {
      const e = emails[0]!;
      let analysis;
      try {
        ({ analysis } = await analyzeAndStore(user, e));
      } catch {
        analysis = heuristicAnalyze(e);
      }
      const from = e.fromName || e.fromEmail || "неизвестно";
      const icon =
        analysis.priority === "high"
          ? "🔴"
          : analysis.priority === "low"
            ? "⚪"
            : "🟡";
      const lines = [
        `Последнее письмо — от <b>${escapeHtml(from)}</b>.`,
        `Тема: <b>${escapeHtml(e.subject || "(без темы)")}</b>`,
        `${icon} Важность: <b>${analysis.priority.toUpperCase()}</b>`,
        "",
        escapeHtml(analysis.summary || analysis.purpose),
      ];
      if (analysis.action_required && analysis.action_required !== "None") {
        lines.push("", `Действие: ${escapeHtml(analysis.action_required)}`);
      }
      return lines.join("\n");
    }

    const lines = ["<b>Вот что в inbox:</b>", ""];
    for (const [i, e] of emails.entries()) {
      let analysis;
      try {
        ({ analysis } = await analyzeAndStore(user, e));
      } catch {
        analysis = heuristicAnalyze(e);
      }
      const icon =
        analysis.priority === "high"
          ? "🔴"
          : analysis.priority === "low"
            ? "⚪"
            : "🟡";
      const from = e.fromName || e.fromEmail || "?";
      lines.push(
        `${i + 1}. ${icon} <b>${escapeHtml(from)}</b> — ${escapeHtml(e.subject || "(без темы)")}`,
        `   <i>${escapeHtml(analysis.purpose || analysis.summary)}</i>`
      );
    }
    return lines.join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/GMAIL_REAUTH|NOT_CONNECTED|invalid_grant|401|403/i.test(msg)) {
      return `Сессия Gmail слетела. Переподключи: ${appUrl(`/connect?uid=${user.id}`)}`;
    }
    return `Не смог открыть почту (${msg.slice(0, 80) || "ошибка"}). Напиши ещё раз через минуту.`;
  }
}
