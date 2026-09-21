import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type Tool,
} from "@google/generative-ai";
import { getEnv, requireEnv } from "@/lib/env";
import type { z } from "zod";

let client: GoogleGenerativeAI | null = null;

function getClient() {
  if (!client) client = new GoogleGenerativeAI(requireEnv("GEMINI_API_KEY"));
  return client;
}

export function isGeminiConfigured() {
  return Boolean(getEnv().GEMINI_API_KEY);
}

/** Prefer stable aliases; 3.6-flash often 503 under load. */
function modelCandidates(): string[] {
  const preferred = getEnv().GEMINI_MODEL || "gemini-flash-latest";
  const fallbacks = [
    "gemini-flash-latest",
    "gemini-3-flash-preview",
    "gemini-3.6-flash",
  ];
  return [...new Set([preferred, ...fallbacks])];
}

function isRetryable(msg: string) {
  return /503|429|high demand|unavailable|overloaded|try again|Resource exhausted/i.test(
    msg
  );
}

async function withModelFallback<T>(
  run: (modelName: string) => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (const modelName of modelCandidates()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await run(modelName);
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!isRetryable(msg)) break; // try next model only for capacity errors? also try next on 404
        if (/404|not found|no longer available/i.test(msg)) break;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : "Gemini failed";
  throw new Error(
    /503|high demand|overloaded/i.test(msg)
      ? "Gemini перегружен. Попробуй через минуту или напиши простую команду: /start, помощь, напомни…"
      : msg
  );
}

export async function generateText(opts: {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
}): Promise<string> {
  return withModelFallback(async (modelName) => {
    const model = getClient().getGenerativeModel({
      model: modelName,
      systemInstruction: opts.system,
    });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: {
        maxOutputTokens: opts.maxOutputTokens ?? 1024,
        temperature: 0.4,
      },
    });
    return result.response.text().trim();
  });
}

export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}): Promise<T> {
  const text = await generateText({
    system: `${opts.system}\n\nRespond with valid JSON only. No markdown fences.`,
    prompt: opts.prompt,
    maxOutputTokens: opts.maxOutputTokens ?? 1024,
  });

  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI returned non-JSON");
    parsed = JSON.parse(match[0]);
  }
  return opts.schema.parse(parsed);
}

export type AgentToolDeclaration = FunctionDeclaration;

export async function runWithTools(opts: {
  system: string;
  messages: Array<{ role: "user" | "model"; text: string }>;
  tools: FunctionDeclaration[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  maxSteps?: number;
}): Promise<string> {
  return withModelFallback(async (modelName) => {
    const genAI = getClient();
    const tool: Tool = { functionDeclarations: opts.tools };

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: opts.system,
      tools: [tool],
    });

    const chat = model.startChat({
      history: opts.messages.slice(0, -1).map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      })),
    });

    const last = opts.messages[opts.messages.length - 1]?.text ?? "";
    let result = await chat.sendMessage(last);
    const maxSteps = opts.maxSteps ?? 5;

    for (let step = 0; step < maxSteps; step++) {
      const calls = result.response.functionCalls();
      if (!calls?.length) {
        return result.response.text().trim();
      }

      const responseParts = [];
      for (const call of calls) {
        let toolResult: unknown;
        try {
          toolResult = await opts.executeTool(
            call.name,
            (call.args ?? {}) as Record<string, unknown>
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "tool_error";
          toolResult = { error: message };
        }
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: { result: toolResult },
          },
        });
      }
      result = await chat.sendMessage(responseParts);
    }

    return result.response.text().trim() || "Готово.";
  });
}

export { SchemaType };
