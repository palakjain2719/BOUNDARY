import { teamAbbr } from "@/lib/data/normalize";

// Generic colour marks (not team logos): abbreviation on a two-tone disc.
const COLORS: Record<string, [string, string]> = {
  CSK: ["#f9cd05", "#1b3c87"], MI: ["#1f4fa3", "#d6b25e"], RCB: ["#c8102e", "#111111"], KKR: ["#3a225d", "#d4af37"],
  DC: ["#17479e", "#ef1b23"], PBKS: ["#d71920", "#dcdddf"], RR: ["#ea1a85", "#254aa5"], SRH: ["#f26522", "#111111"],
  GT: ["#1c2c5b", "#c9b37e"], LSG: ["#1ba4c9", "#f28b00"], GG: ["#f47c20", "#1b2a5b"], UPW: ["#5b2a86", "#f6d000"],
  DCG: ["#3c5a99", "#c0c0c0"], PWI: ["#2f9fd8", "#111111"], GL: ["#f15a24", "#1d2a57"], RPS: ["#6b2c91", "#f7f7f7"], KTK: ["#e36414", "#5a189a"],
};

/** Generic team colour pair [primary, secondary] for illustrations (not official branding). */
export function teamColors(team: string): [string, string] {
  return COLORS[teamAbbr(team)] ?? ["#2f5d9e", "#d6b25e"];
}

export function TeamMark({ team, size = 52 }: { team: string; size?: number }) {
  const abbr = teamAbbr(team);
  const [a, b] = COLORS[abbr] ?? ["#444444", "#dddddd"];
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full border-4 border-white font-display shadow-sm"
      style={{ width: size, height: size, background: `conic-gradient(${a} 0 75%, ${b} 75% 100%)`, fontSize: Math.max(10, size * 0.26) }}
      role="img"
      aria-label={team}
      title={team}
    >
      <span className="rounded px-1 text-white" style={{ background: "rgba(0,0,0,0.45)" }}>
        {abbr}
      </span>
    </span>
  );
}
