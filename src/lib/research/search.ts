import { getEnv } from "@/lib/env";
import { generateText, isGeminiConfigured } from "@/lib/ai/gemini";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export async function webSearch(query: string, num = 5): Promise<SearchResult[]> {
  const serper = getEnv().SERPER_API_KEY;
  if (serper) {
    return serperSearch(query, num, serper);
  }
  return duckDuckGoSearch(query, num);
}

async function serperSearch(query: string, num: number, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num }),
  });
  if (!res.ok) {
    throw new Error(`Search API unavailable (${res.status})`);
  }
  const data = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  return (data.organic ?? []).slice(0, num).map((r) => ({
    title: r.title ?? "Untitled",
    url: r.link ?? "",
    snippet: r.snippet ?? "",
  }));
}

async function duckDuckGoSearch(query: string, num: number): Promise<SearchResult[]> {
  // Free fallback: DuckDuckGo HTML (no key). Best-effort parsing.
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; PersonalAssistant/1.0; +https://localhost)",
    },
  });
  if (!res.ok) {
    throw new Error(`Web search unavailable (${res.status}). Try setting SERPER_API_KEY.`);
  }
  const html = await res.text();
  const results: SearchResult[] = [];
  const re =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/td>)/gi;

  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && results.length < num) {
    const href = decodeDDGUrl(match[1]);
    const title = stripTags(match[2]);
    const snippet = stripTags(match[3] || match[4] || "");
    if (href && title) results.push({ title, url: href, snippet });
  }

  // Simpler alternate parse if regex failed
  if (results.length === 0) {
    const simple = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    for (const m of simple.slice(0, num)) {
      results.push({
        title: stripTags(m[2]),
        url: decodeDDGUrl(m[1]),
        snippet: "",
      });
    }
  }

  if (results.length === 0) {
    throw new Error(
      "Web search returned no results. Set SERPER_API_KEY for more reliable research."
    );
  }
  return results;
}

function decodeDDGUrl(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : href;
  } catch {
    return href;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();
}

export async function runResearch(question: string): Promise<string> {
  if (!isGeminiConfigured()) {
    throw new Error("Gemini API key не настроен.");
  }

  let results: SearchResult[];
  try {
    results = await webSearch(question, 6);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Search failed";
    return `Research недоступен: ${msg}\nЯ не буду выдумывать результаты.`;
  }

  const sourcesBlock = results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
    .join("\n\n");

  const report = await generateText({
    system: `You are a careful research assistant.
Rules:
- Use ONLY the provided sources. Do not invent facts, numbers, or citations.
- Separate FACTS vs CONCLUSIONS.
- Be compact, practical, Telegram-friendly.
- Include source numbers like [1], [2].
- If sources conflict, say so.
- If evidence is weak, say UNCERTAIN.
Language: match the user's question language.`,
    prompt: `Question: ${question}

Sources:
${sourcesBlock}

Write a compact research brief:
1) Answer (short)
2) Key facts
3) Conclusions (clearly labeled)
4) Sources list`,
    maxOutputTokens: 1200,
  });

  return report;
}
