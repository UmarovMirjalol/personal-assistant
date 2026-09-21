import type { User } from "@/lib/db/client";
import { isGmailConnected, listRecentEmails } from "@/lib/gmail";
import { analyzeAndStore } from "@/lib/gmail/analyze";
import { heuristicAnalyze } from "@/lib/gmail/heuristic";
import { appUrl } from "@/lib/env";

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
        `Последнее письмо — от ${from}.`,
        `Тема: ${e.subject || "(без темы)"}`,
        `${icon} Важность: ${analysis.priority.toUpperCase()}`,
        "",
        analysis.summary || analysis.purpose,
      ];
      if (analysis.action_required && analysis.action_required !== "None") {
        lines.push("", `Действие: ${analysis.action_required}`);
      }
      return lines.join("\n");
    }

    const lines = ["Вот что в inbox:", ""];
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
        `${i + 1}. ${icon} ${from} — ${e.subject || "(без темы)"}`,
        `   ${analysis.purpose || analysis.summary}`
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
