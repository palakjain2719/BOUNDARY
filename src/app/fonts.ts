import { Anton, Archivo_Black, Bebas_Neue, Bricolage_Grotesque, Caveat, DM_Sans, DM_Serif_Display, Fraunces, Oswald, Rubik_Mono_One } from "next/font/google";

// Self-hosted at build time by next/font, with system fallbacks so text renders immediately.
export const archivoBlack = Archivo_Black({ weight: "400", subsets: ["latin"], variable: "--font-archivo-black", display: "swap", fallback: ["Arial Black", "system-ui"] });
export const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap", fallback: ["system-ui", "sans-serif"] });
export const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap", preload: false });
// Per-match display fonts (not preloaded; only downloaded when a themed card uses them).
export const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton", display: "swap", preload: false, fallback: ["Impact", "Arial Narrow", "sans-serif"] });
export const bebas = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-bebas", display: "swap", preload: false, fallback: ["Impact", "sans-serif"] });
export const oswald = Oswald({ subsets: ["latin"], variable: "--font-oswald", display: "swap", preload: false, fallback: ["Arial Narrow", "sans-serif"] });
export const dmSerif = DM_Serif_Display({ weight: "400", subsets: ["latin"], variable: "--font-dm-serif", display: "swap", preload: false, fallback: ["Georgia", "serif"] });
export const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap", preload: false, fallback: ["system-ui", "sans-serif"] });
export const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap", preload: false, fallback: ["Georgia", "serif"] });
export const rubikMono = Rubik_Mono_One({ weight: "400", subsets: ["latin"], variable: "--font-rubik-mono", display: "swap", preload: false, fallback: ["Courier New", "monospace"] });

export const fontVariables = [archivoBlack, dmSans, caveat, anton, bebas, oswald, dmSerif, bricolage, fraunces, rubikMono].map((f) => f.variable).join(" ");
