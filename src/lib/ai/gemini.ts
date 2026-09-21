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

/** Prefer free-tier-friendly stable models; skip exhausted ones via fallback. */
function modelCandidates(): string[] {
  const preferred = getEnv().GEMINI_MODEL || "gemini-2.5-flash";
  const fallbacks = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
  ];
  return [...new Set([preferred, ...fallbacks])];
}

function isRetryable(msg: string) {
  return /503|429|high demand|unavailable|overloaded|try again|Resource exhausted|Too Many Requests|quota/i.test(
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
        // Always try next model on capacity / missing / quota
        if (/404|not found|no longer available/i.test(msg)) break;
        if (/429|quota|Too Many Requests|Resource exhausted/i.test(msg)) {
          // Don't burn retries on hard quota — jump to next model
          break;
        }
        if (!isRetryable(msg) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        if (!isRetryable(msg)) break;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("AI временно недоступен");
}

export async function generateText(opts: {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
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
        temperature: opts.temperature ?? 0.4,
      },
    });
    return result.response.text().trim();
  });
}

/** Multi-turn chat — feels like a real conversation, not one-shot Q&A. */
export async function generateChat(opts: {
  system: string;
  messages: Array<{ role: "user" | "model"; text: string }>;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<string> {
  return withModelFallback(async (modelName) => {
    const model = getClient().getGenerativeModel({
      model: modelName,
      systemInstruction: opts.system,
    });
    const msgs = opts.messages.filter((m) => m.text.trim().length > 0);
    if (msgs.length === 0) return "Йо, напиши что-нибудь.";

    const history = msgs.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));
    const last = msgs[msgs.length - 1]!;

    // Gemini requires history to start with user; drop leading model turns
    while (history.length && history[0]!.role !== "user") history.shift();

    const chat = model.startChat({
      history,
      generationConfig: {
        maxOutputTokens: opts.maxOutputTokens ?? 900,
        temperature: opts.temperature ?? 0.85,
      },
    });
    const result = await chat.sendMessage(
      last.role === "user" ? last.text : `Продолжи ответ: ${last.text}`
    );
    return result.response.text().trim();
  });
}

function extractJsonText(raw: string): string {
  let text = raw.trim();
  // Strip markdown fences anywhere
  text = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  // Prefer first JSON object or array
  const obj = text.match(/\{[\s\S]*\}/);
  const arr = text.match(/\[[\s\S]*\]/);
  if (obj && arr) {
    return obj.index! <= arr.index! ? obj[0] : arr[0];
  }
  if (obj) return obj[0];
  if (arr) return arr[0];
  return text;
}

function parseJsonLoose(raw: string): unknown {
  const cleaned = extractJsonText(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    // Trailing commas / smart quotes
    const fixed = cleaned
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixed);
  }
}

export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}): Promise<T> {
  const runOnce = async (extraHint = "") =>
    withModelFallback(async (modelName) => {
      const model = getClient().getGenerativeModel({
        model: modelName,
        systemInstruction: `${opts.system}\n\nReturn ONLY valid JSON. No markdown, no commentary.${extraHint}`,
      });
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        generationConfig: {
          maxOutputTokens: opts.maxOutputTokens ?? 1024,
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      });
      return result.response.text().trim();
    });

  let lastRaw = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      lastRaw = await runOnce(
        attempt === 0
          ? ""
          : "\nPrevious output was invalid. Output a single JSON value only."
      );
      const parsed = parseJsonLoose(lastRaw);
      return opts.schema.parse(parsed);
    } catch {
      if (attempt === 1) break;
    }
  }

  throw new Error(
    "AI вернул ответ не в JSON. Попробуй ещё раз или переформулируй запрос."
  );
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
      generationConfig: {
        maxOutputTokens: 900,
        temperature: 0.7,
      },
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
