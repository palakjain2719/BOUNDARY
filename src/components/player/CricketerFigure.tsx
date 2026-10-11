import type { PlayerRole } from "@/lib/data/types";

/** Generic illustrated cricketer (no real likeness) in team colours: batting stance, or bowling action for bowlers. */
export function CricketerFigure({ role, primary, secondary, className }: { role: PlayerRole; primary: string; secondary: string; className?: string }) {
  const bowler = role === "BOWL";
  return (
    <svg viewBox="0 0 200 320" className={className} aria-hidden>
      <defs>
        <linearGradient id="kit" x1="0" x2="1">
          <stop offset="0" stopColor={primary} />
          <stop offset="1" stopColor={primary} stopOpacity="0.75" />
        </linearGradient>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#glow)" stroke="#0b1530" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round">
        {bowler ? (
          <>
            {/* legs mid-stride */}
            <path d="M92 190 L70 262 L62 300 L84 302 L90 266 L104 205 Z" fill="#f4f6fb" />
            <path d="M108 190 L132 250 L150 292 L170 290 L148 246 L124 190 Z" fill="#f4f6fb" />
            <path d="M60 300 h28 v10 h-30 z M148 290 h26 v10 h-28 z" fill="#ffffff" />
            {/* torso */}
            <path d="M82 104 Q100 92 122 104 L130 196 L82 196 Z" fill="url(#kit)" />
            <path d="M86 150 L128 150" stroke={secondary} strokeWidth="5" />
            {/* bowling arm up with ball */}
            <path d="M118 110 L146 66 L154 30" fill="none" stroke="url(#kit)" strokeWidth="16" />
            <circle cx="156" cy="24" r="9" fill="#d9532b" />
            {/* other arm */}
            <path d="M86 112 L58 150 L52 176" fill="none" stroke="url(#kit)" strokeWidth="15" />
          </>
        ) : (
          <>
            {/* pads and legs */}
            <rect x="74" y="196" width="24" height="96" rx="9" fill="#f4f6fb" />
            <rect x="104" y="196" width="24" height="96" rx="9" fill="#f4f6fb" />
            <path d="M74 220 h24 M74 244 h24 M74 268 h24 M104 220 h24 M104 244 h24 M104 268 h24" stroke="#c9d3e6" strokeWidth="2" />
            <path d="M68 292 h34 v12 h-36 z M102 292 h34 v12 h-36 z" fill="#ffffff" />
            {/* torso */}
            <path d="M76 104 Q100 92 126 104 L132 200 L72 200 Z" fill="url(#kit)" />
            <path d="M76 150 L130 150" stroke={secondary} strokeWidth="5" />
            {/* arms to the bat */}
            <path d="M80 112 L68 158 L96 176" fill="none" stroke="url(#kit)" strokeWidth="15" />
            <path d="M122 112 L118 160 L100 178" fill="none" stroke="url(#kit)" strokeWidth="15" />
            <circle cx="98" cy="178" r="9" fill="#ffffff" />
            {/* bat */}
            <path d="M96 182 L40 236 L32 230 L86 174 Z" fill="#e2c08d" />
            <path d="M100 176 L92 184" stroke="#3b2a1a" strokeWidth="6" />
          </>
        )}
        {/* head and helmet / cap */}
        <circle cx="101" cy="78" r="20" fill="#f0c9a2" />
        {bowler ? (
          <path d="M80 72 Q100 48 122 70 L132 74 L80 76 Z" fill={secondary} />
        ) : (
          <>
            <path d="M78 80 Q78 52 102 52 Q126 52 124 82 L78 82 Z" fill={primary} />
            <path d="M84 84 h36 M84 90 h36 M84 96 h32" stroke="#c9d3e6" strokeWidth="2.5" />
          </>
        )}
      </g>
    </svg>
  );
}
