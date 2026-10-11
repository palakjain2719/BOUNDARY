import { afterEach, describe, expect, it, vi } from "vitest";

const reply = (body: unknown, ok = true) => (async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;

describe("Gemini explanation adapter", () => {
  afterEach(() => vi.unstubAllEnvs());
  async function load() {
    vi.resetModules();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-test");
    return import("@/lib/ai/gemini");
  }
  it("uses Gemini text when the model finishes normally, flattening markdown and skipping thought parts", async () => {
    const { explainWithGemini } = await load();
    const r = await explainWithGemini({}, "fallback", reply({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "secret reasoning", thought: true }, { text: "## Why\n* **Gill** is in form.\n* Venue suits pace." }] } }] }));
    expect(r.source).toBe("gemini");
    expect(r.text).toBe("Why Gill is in form. Venue suits pace.");
  });
  it("falls back to the template when Gemini is truncated (MAX_TOKENS)", async () => {
    const { explainWithGemini } = await load();
    const r = await explainWithGemini({}, "fallback", reply({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "due to credit/role limits and" }] } }] }));
    expect(r).toMatchObject({ source: "template", text: "fallback" });
  });
  it("falls back on HTTP errors", async () => {
    const { explainWithGemini } = await load();
    expect((await explainWithGemini({}, "fallback", reply({}, false))).source).toBe("template");
  });
});
