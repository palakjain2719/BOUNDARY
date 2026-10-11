/**
 * Deterministic per-match themes: background scene, accent palette and display-font pairing keyed by match id.
 * Body text and controls stay global; only the card hero / match header use the theme. All ink colours are
 * chosen to keep ≥ 4.5:1 contrast on their backgrounds.
 */
export type SceneKind = "day" | "golden" | "dusk" | "night";
export type DisplayFont = "anton" | "bebas" | "archivo" | "oswald" | "dmserif" | "bricolage" | "fraunces" | "rubik";

export interface MatchTheme {
  id: string;
  name: string;
  scene: SceneKind;
  sky: [string, string];
  field: string;
  stand: string;
  sun: string;
  panel: string;
  ink: string;
  accent: string;
  accentInk: string;
  font: DisplayFont;
}

export const THEMES: MatchTheme[] = [
  { id: "lime", name: "Lime day", scene: "day", sky: ["#e9f27a", "#cfe36a"], field: "#7cb342", stand: "#3f6b2a", sun: "#fff6c9", panel: "#f4f8d8", ink: "#1b1d12", accent: "#3f7d20", accentInk: "#ffffff", font: "anton" },
  { id: "rose", name: "Rose dusk", scene: "dusk", sky: ["#f6a6c8", "#f9d1a8"], field: "#6aa84f", stand: "#7a2f55", sun: "#ffe08a", panel: "#fbe3ee", ink: "#2a1220", accent: "#c2185b", accentInk: "#ffffff", font: "bebas" },
  { id: "navy", name: "Floodlit navy", scene: "night", sky: ["#0f2a5c", "#264d8c"], field: "#2e7d32", stand: "#0b1836", sun: "#f5f7ff", panel: "#e3ecfb", ink: "#0d1b3a", accent: "#1d4ed8", accentInk: "#ffffff", font: "oswald" },
  { id: "sky", name: "Open sky", scene: "day", sky: ["#8fd3f4", "#c9ecfb"], field: "#78b75a", stand: "#2f5d73", sun: "#fff2b3", panel: "#e6f5fc", ink: "#0e2430", accent: "#0369a1", accentInk: "#ffffff", font: "archivo" },
  { id: "tangerine", name: "Tangerine golden hour", scene: "golden", sky: ["#ffb26b", "#ffe1a8"], field: "#86a845", stand: "#8a3b12", sun: "#fff3c4", panel: "#fff0dc", ink: "#2b1406", accent: "#c2410c", accentInk: "#ffffff", font: "dmserif" },
  { id: "lilac", name: "Lilac evening", scene: "dusk", sky: ["#b9a7f2", "#f3c6e8"], field: "#5f9e4f", stand: "#3d2a6b", sun: "#fff0b8", panel: "#efe9fd", ink: "#1e1438", accent: "#6d28d9", accentInk: "#ffffff", font: "bricolage" },
  { id: "mint", name: "Mint morning", scene: "day", sky: ["#bff0d8", "#effbd3"], field: "#5fae5a", stand: "#1f5e4a", sun: "#fffbe0", panel: "#e5f8ee", ink: "#0f2a20", accent: "#047857", accentInk: "#ffffff", font: "fraunces" },
  { id: "ember", name: "Ember night", scene: "night", sky: ["#3a1020", "#7a2340"], field: "#2f6b33", stand: "#1c0710", sun: "#ffd7a8", panel: "#fbe6e4", ink: "#2a0a12", accent: "#be123c", accentInk: "#ffffff", font: "rubik" },
  { id: "butter", name: "Butter afternoon", scene: "golden", sky: ["#ffe58f", "#fff6cf"], field: "#8bbd52", stand: "#6b5a12", sun: "#ffffff", panel: "#fff8d6", ink: "#231d04", accent: "#a16207", accentInk: "#ffffff", font: "bebas" },
  { id: "teal", name: "Teal twilight", scene: "dusk", sky: ["#2a9d8f", "#a8dadc"], field: "#4f9a4b", stand: "#12403b", sun: "#fdf2c4", panel: "#e1f4f2", ink: "#0a2522", accent: "#0f766e", accentInk: "#ffffff", font: "anton" },
];

export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function themeFor(matchId: string): MatchTheme {
  return THEMES[hashId(matchId) % THEMES.length];
}

/** Themes for a list of cards: deterministic per id, but avoids repeating the previous card's theme. */
export function themesForList(ids: string[]): MatchTheme[] {
  const out: MatchTheme[] = [];
  for (const id of ids) {
    let i = hashId(id) % THEMES.length;
    const prev = out[out.length - 1];
    let guard = 0;
    while (prev && THEMES[i].id === prev.id && guard++ < THEMES.length) i = (i + 1) % THEMES.length;
    out.push(THEMES[i]);
  }
  return out;
}

export const FONT_VAR: Record<DisplayFont, string> = {
  anton: "var(--font-anton)",
  bebas: "var(--font-bebas)",
  archivo: "var(--font-archivo-black)",
  oswald: "var(--font-oswald)",
  dmserif: "var(--font-dm-serif)",
  bricolage: "var(--font-bricolage)",
  fraunces: "var(--font-fraunces)",
  rubik: "var(--font-rubik-mono)",
};
