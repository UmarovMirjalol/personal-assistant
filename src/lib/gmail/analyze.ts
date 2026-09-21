import { z } from "zod";
import { generateJson } from "@/lib/ai/gemini";
import type { ParsedEmail } from "@/lib/gmail/client";
import { getDb, type EmailSummary, type User } from "@/lib/db/client";
import { upsertEmailRecord } from "@/lib/gmail/client";
import { heuristicAnalyze } from "@/lib/gmail/heuristic";

const analysisSchema = z.object({
  priority: z.enum(["high", "medium", "low"]),
  purpose: z.string(),
  what_they_want: z.array(z.string()),
  action_required: z.string(),
  deadline: z.string(),
  urgency: z.enum(["HIGH", "MEDIUM", "LOW"]),
  summary: z.string(),
  uncertain: z.string().nullable(),
  extracted_actions: z.array(
    z.object({
      action: z.string(),
      deadline: z.string().nullable(),
    })
  ),
});

export type EmailAnalysis = z.infer<typeof analysisSchema>;

const SYSTEM = `You analyze personal inbox emails for a busy student/professional.
Return ONLY JSON matching the schema.
Rules:
- Distinguish WHO wrote, WHY, WHAT they want from the user, ACTION REQUIRED, DEADLINE, URGENCY.
- Do NOT invent facts. If unsure, put it in "uncertain" and keep fields honest.
- If no action needed: action_required = "None"
- If no deadline: deadline = "Not specified"
- Priority:
  HIGH: admissions, professor/research opportunity, scholarship, deadline, interview, application issue, urgent work request
  MEDIUM: normal work request, useful update, networking, potentially important
  LOW: newsletters, promotions, automated notifications, obvious spam
- summary: 2-3 simple sentences in Russian if the user context is Russian
- purpose: one clear sentence about intent
- Be concise.`;

export async function analyzeEmail(email: ParsedEmail): Promise<EmailAnalysis> {
  const prompt = `Analyze this email:

From: ${email.fromName ?? ""} <${email.fromEmail ?? ""}>
Subject: ${email.subject ?? ""}
Received: ${email.receivedAt ?? ""}
Body:
${email.bodyExcerpt.slice(0, 4500)}`;

  try {
    return await Promise.race([
      generateJson({
        system: SYSTEM,
        prompt,
        schema: analysisSchema,
        maxOutputTokens: 700,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("analyze_timeout")), 18_000)
      ),
    ]);
  } catch {
    return heuristicAnalyze(email);
  }
}

export async function analyzeAndStore(
  user: User,
  email: ParsedEmail
): Promise<{ rowId: string; summary: EmailSummary; analysis: EmailAnalysis }> {
  const row = await upsertEmailRecord(user.id, email);
  const db = getDb();

  const { data: existing } = await db
    .from("email_summaries")
    .select("*")
    .eq("email_id", row.id)
    .maybeSingle();

  if (existing) {
    return {
      rowId: row.id,
      summary: existing,
      analysis: {
        priority: existing.priority,
        purpose: existing.purpose ?? "",
        what_they_want: existing.what_they_want ?? [],
        action_required: existing.action_required ?? "None",
        deadline: existing.deadline ?? "Not specified",
        urgency: (existing.urgency as "HIGH" | "MEDIUM" | "LOW") || "MEDIUM",
        summary: existing.summary ?? "",
        uncertain: existing.uncertain,
        extracted_actions: (existing.extracted_actions as EmailAnalysis["extracted_actions"]) ?? [],
      },
    };
  }

  const analysis = await analyzeEmail(email);
  const { data: summary, error } = await db
    .from("email_summaries")
    .insert({
      email_id: row.id,
      user_id: user.id,
      priority: analysis.priority,
      purpose: analysis.purpose,
      what_they_want: analysis.what_they_want,
      action_required: analysis.action_required,
      deadline: analysis.deadline,
      urgency: analysis.urgency,
      summary: analysis.summary,
      uncertain: analysis.uncertain,
      extracted_actions: analysis.extracted_actions,
    })
    .select("*")
    .single();

  if (error || !summary) throw error ?? new Error("summary insert failed");
  return { rowId: row.id, summary, analysis };
}

export function shouldNotify(
  priority: "high" | "medium" | "low",
  threshold: "high" | "medium" | "low"
): boolean {
  const rank = { high: 3, medium: 2, low: 1 };
  return rank[priority] >= rank[threshold];
}
