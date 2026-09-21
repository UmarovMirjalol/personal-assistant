/**
 * Fast offline heuristic when Gemini is slow/unavailable.
 * Still produces priority + summary so notifications never die.
 */
import type { ParsedEmail } from "@/lib/gmail/client";
import type { EmailAnalysis } from "@/lib/gmail/analyze";

const HIGH_RE =
  /admission|deadline|interview|scholarship|urgent|asap|professor|application|fee\s*waiver|evaluation\s*form|offer|invoice|payment|срок|дедлайн|срочно|собесед|стипенди|заявк|оферт/i;

const LOW_RE =
  /unsubscribe|newsletter|noreply|no-reply|marketing|promo|sale|discount|quizlet|youtube|noreply@|notification@|mailer-daemon/i;

export function heuristicAnalyze(email: ParsedEmail): EmailAnalysis {
  const blob = `${email.fromEmail ?? ""} ${email.fromName ?? ""} ${email.subject ?? ""} ${email.snippet ?? ""} ${email.bodyExcerpt.slice(0, 800)}`;
  let priority: "high" | "medium" | "low" = "medium";
  if (LOW_RE.test(blob) && !HIGH_RE.test(blob)) priority = "low";
  if (HIGH_RE.test(blob)) priority = "high";

  const from = email.fromName || email.fromEmail || "кто-то";
  const subject = email.subject || "без темы";
  const summary =
    email.snippet?.trim() ||
    email.bodyExcerpt.replace(/\s+/g, " ").trim().slice(0, 220) ||
    "Короткое письмо без текста.";

  return {
    priority,
    purpose: `Письмо от ${from}: ${subject}`,
    what_they_want: priority === "low" ? [] : ["Прочитать и решить, нужен ли ответ"],
    action_required: priority === "high" ? "Проверить и ответить" : "None",
    deadline: "Not specified",
    urgency: priority === "high" ? "HIGH" : priority === "low" ? "LOW" : "MEDIUM",
    summary,
    uncertain: "Быстрый разбор без AI — могу уточнить по запросу.",
    extracted_actions: [],
  };
}
