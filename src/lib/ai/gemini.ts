/**
 * Gemini Flash explanation adapter (server only). Gemini only rephrases the deterministic evidence it is
 * given; it never decides team validity, scores or picks. Without credentials a deterministic template is used.
 * Model id comes from GEMINI_MODEL (check https://ai.google.dev/gemini-api/docs/models for current ids).
 */
import { env, geminiViaOpenRouter, isGeminiConfigured, openRouterModel } from "../env";
import type { Repository } from "../store/types";
import { blockForToday, tryConsume } from "./budget";

export interface ExplanationResult {
  text: string;
  source: "gemini" | "template";
  error?: string;
}

const SYSTEM = [
  "You explain a fantasy cricket team recommendation to a user called Aryan.",
  "Use ONLY the facts in the JSON evidence. Do not invent statistics, injuries, pitch or weather facts.",
  "Be specific to this match and venue. Cover: why the key players were selected, why notable alternatives were not (use the avoid list), captain and vice-captain reasoning with multiplier impact, risks, and evidence quality (say which conclusions are well supported, preliminary or unavailable).",
  "Never invent pitch reports, injuries, lineup news or statistics; if something is unavailable, say so.",
  "Do not claim the team is valid or invalid beyond the validation label provided. Keep it under 220 words, plain prose, no markdown headings.",
].join(" ");

/** Flatten markdown the model may still emit (bullets, bold, headings) into plain prose for the panel. */
export function toPlainProse(md: string): string {
  return md
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

export async function explainWithGemini(evidence: unknown, fallback: string, fetchImpl: typeof fetch = fetch, repo?: Repository | null): Promise<ExplanationResult> {
  if (!isGeminiConfigured()) return { text: fallback, source: "template" };
  if (!(await tryConsume("gemini_explanation", repo))) return { text: fallback, source: "template", error: "Daily Gemini explanation cap reached (zero-cost guard)" };
  if (geminiViaOpenRouter()) return explainViaOpenRouter(evidence, fallback, fetchImpl);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiModel)}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiApiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: `Evidence JSON:\n${JSON.stringify(evidence)}` }] }],
        // Gemini 3.x spends output tokens on internal thinking; keep it low and leave room for the answer.
        generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "low" } },
      }),
      signal: controller.signal,
    });
    if (res.status === 429) blockForToday("gemini_explanation");
    if (!res.ok) return { text: fallback, source: "template", error: `Gemini HTTP ${res.status}` };
    const json = (await res.json()) as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    const cand = json.candidates?.[0];
    const text = toPlainProse(cand?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "");
    if (!text) return { text: fallback, source: "template", error: "Empty Gemini response" };
    // A truncated explanation is worse than the deterministic one.
    if (cand?.finishReason && cand.finishReason !== "STOP") return { text: fallback, source: "template", error: `Gemini stopped early (${cand.finishReason})` };
    return { text, source: "gemini" };
  } catch (e) {
    return { text: fallback, source: "template", error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Same prompt and safeguards, sent to Gemini Flash through OpenRouter's OpenAI-compatible API. */
async function explainViaOpenRouter(evidence: unknown, fallback: string, fetchImpl: typeof fetch): Promise<ExplanationResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.geminiApiKey}`, "X-Title": "BOUNDARY Match Optimizer" },
      body: JSON.stringify({
        model: openRouterModel(),
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Evidence JSON:\n${JSON.stringify(evidence)}` },
        ],
        max_tokens: 2048,
        reasoning: { effort: "low", exclude: true },
      }),
      signal: controller.signal,
    });
    if (res.status === 429 || res.status === 402) blockForToday("gemini_explanation");
    if (!res.ok) return { text: fallback, source: "template", error: `OpenRouter HTTP ${res.status}` };
    const json = (await res.json()) as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
    const choice = json.choices?.[0];
    const text = toPlainProse(choice?.message?.content ?? "");
    if (!text) return { text: fallback, source: "template", error: "Empty Gemini response" };
    if (choice?.finish_reason && choice.finish_reason !== "stop") return { text: fallback, source: "template", error: `Gemini stopped early (${choice.finish_reason})` };
    return { text, source: "gemini" };
  } catch (e) {
    return { text: fallback, source: "template", error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
