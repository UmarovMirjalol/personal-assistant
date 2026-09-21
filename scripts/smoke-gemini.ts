import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!process.env[k]) process.env[k] = v;
}

async function main() {
  const mod = await import("../src/lib/ai/gemini");
  console.log("configured", mod.isGeminiConfigured());
  console.log("model env", process.env.GEMINI_MODEL);
  console.log("key len", (process.env.GEMINI_API_KEY || "").length);
  try {
    const t = await mod.generateText({
      system: "Reply with one short Russian word only.",
      prompt: "скажи ок",
      maxOutputTokens: 20,
      temperature: 0.2,
    });
    console.log("OK:", t);
  } catch (e) {
    console.error("FAIL:", e instanceof Error ? e.message : e);
  }
}

main();
