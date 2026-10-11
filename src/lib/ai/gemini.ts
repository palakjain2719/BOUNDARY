/**
 * Gemini Flash explanation adapter (server only). Gemini only rephrases the deterministic evidence it is
 * given; it never decides team validity, scores or picks. Without credentials a deterministic template is used.
 * Model id comes from GEMINI_MODEL (check https://ai.google.dev/gemini-api/docs/models for current ids).
 */
import { env, isGeminiConfigured } from "../env";

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

export async function explainWithGemini(evidence: unknown, fallback: string, fetchImpl: typeof fetch = fetch): Promise<ExplanationResult> {
  if (!isGeminiConfigured()) return { text: fallback, source: "template" };
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
        generationConfig: { maxOutputTokens: 600 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { text: fallback, source: "template", error: `Gemini HTTP ${res.status}` };
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (!text) return { text: fallback, source: "template", error: "Empty Gemini response" };
    return { text, source: "gemini" };
  } catch (e) {
    return { text: fallback, source: "template", error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
