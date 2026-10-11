/**
 * Illustrated open cricket ground: sky, floodlights, stands with crowd, striped outfield, pitch, fielders,
 * foreground fans with flags, and (optionally) a cricket ball floating in the sky. Pure SVG, themeable.
 */
interface Props {
  uid: string;
  sky: [string, string];
  field: string;
  stand: string;
  sun: string;
  scene?: "day" | "golden" | "dusk" | "night";
  ball?: boolean;
  ballPosition?: [number, number, number];
  crowd?: boolean;
  className?: string;
  title?: string;
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  const r = c((n >> 16) & 255);
  const g = c((n >> 8) & 255);
  const b = c(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const CROWD = ["#f2c14e", "#e86a5b", "#4b8fd1", "#f6f1e3", "#7c5cbf", "#3aa17e", "#ef8fb4"];

export function StadiumScene({ uid, sky, field, stand, sun, scene = "day", ball = false, ballPosition = [850, 150, 110], crowd = true, className, title }: Props) {
  const id = (s: string) => `${uid}-${s}`;
  const night = scene === "night";
  const [bx, by, br] = ballPosition;
  // Deterministic crowd dots
  const dots: { x: number; y: number; c: string }[] = [];
  for (let row = 0; row < 7; row++) {
    for (let i = 0; i < 70; i++) {
      const x = i * 17.5 + (row % 2) * 8;
      const y = 352 + row * 10 + Math.sin(i * 1.7 + row) * 2;
      dots.push({ x, y, c: CROWD[(i * 7 + row * 3) % CROWD.length] });
    }
  }
  const towers = [110, 330, 870, 1090];
  const fielders: [number, number][] = [
    [300, 560], [470, 505], [700, 495], [905, 560], [1010, 640], [180, 650], [560, 620], [800, 610],
  ];
  return (
    <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={id("sky")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky[0]} />
          <stop offset="1" stopColor={sky[1]} />
        </linearGradient>
        <linearGradient id={id("field")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(field, -0.05)} />
          <stop offset="1" stopColor={shade(field, 0.06)} />
        </linearGradient>
        <radialGradient id={id("ball")} cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#f58a5c" />
          <stop offset="0.55" stopColor="#d9532b" />
          <stop offset="1" stopColor="#9a2d14" />
        </radialGradient>
        <radialGradient id={id("glow")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={sun} stopOpacity="0.9" />
          <stop offset="1" stopColor={sun} stopOpacity="0" />
        </radialGradient>
        <clipPath id={id("fieldclip")}>
          <path d="M-20 430 Q600 360 1220 430 L1220 720 L-20 720 Z" />
        </clipPath>
        <filter id={id("grain")}>
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
      </defs>

      <rect width="1200" height="700" fill={`url(#${id("sky")})`} />
      {/* sun / moon glow */}
      <circle cx={night ? 1000 : 260} cy={night ? 90 : 120} r={night ? 120 : 190} fill={`url(#${id("glow")})`} />
      {night ? (
        <g fill="#fff" opacity="0.8">
          {[[80, 60], [210, 110], [420, 50], [560, 130], [690, 70], [1130, 160], [960, 40]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={1.6} />
          ))}
        </g>
      ) : (
        <g fill="#fff" opacity="0.65">
          <ellipse cx="180" cy="190" rx="90" ry="22" />
          <ellipse cx="250" cy="175" rx="60" ry="20" />
          <ellipse cx="620" cy="110" rx="70" ry="16" />
          <ellipse cx="1060" cy="240" rx="80" ry="18" />
        </g>
      )}

      {/* floodlight towers */}
      {towers.map((x, i) => (
        <g key={i}>
          <rect x={x - 3} y={160} width={6} height={210} fill={shade(stand, -0.05)} />
          <rect x={x - 26} y={130} width={52} height={36} rx={3} fill={shade(stand, -0.08)} />
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3].map((c) => <rect key={`${r}${c}`} x={x - 22 + c * 11} y={134 + r * 10} width={8} height={7} rx={1.5} fill={night ? "#fffbe6" : "#f3f0dc"} opacity={night ? 1 : 0.85} />),
          )}
          {night && <path d={`M${x - 26} 166 L${x - 140} 430 L${x + 140} 430 L${x + 26} 166 Z`} fill="#fffbe6" opacity="0.07" />}
        </g>
      ))}

      {/* stands */}
      <path d="M-20 330 Q600 285 1220 330 L1220 440 L-20 440 Z" fill={stand} />
      <path d="M-20 330 Q600 285 1220 330" stroke={shade(stand, 0.15)} strokeWidth="6" fill="none" />
      <g opacity="0.9">
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={3.2} fill={d.c} />
        ))}
      </g>
      <path d="M-20 418 Q600 380 1220 418 L1220 440 L-20 440 Z" fill={shade(stand, -0.08)} />

      {/* outfield with mowing stripes */}
      <path d="M-20 430 Q600 360 1220 430 L1220 720 L-20 720 Z" fill={`url(#${id("field")})`} />
      <g clipPath={`url(#${id("fieldclip")})`} opacity="0.18">
        {Array.from({ length: 12 }).map((_, i) => (
          <path key={i} d={`M${-200 + i * 140} 720 L${420 + i * 40} 380 L${460 + i * 40} 380 L${-110 + i * 140} 720 Z`} fill={i % 2 ? "#ffffff" : "#000000"} opacity={i % 2 ? 0.55 : 0.12} />
        ))}
      </g>
      {/* 30-yard circle */}
      <ellipse cx="600" cy="560" rx="420" ry="120" fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="2" strokeDasharray="10 10" />
      {/* pitch */}
      <path d="M570 470 L630 470 L660 660 L540 660 Z" fill="#d9c08a" />
      <path d="M570 470 L630 470 L660 660 L540 660 Z" fill="#000" opacity="0.05" filter={`url(#${id("grain")})`} />
      <line x1="566" y1="488" x2="634" y2="488" stroke="#fff" strokeWidth="2" />
      <line x1="546" y1="636" x2="654" y2="636" stroke="#fff" strokeWidth="2.5" />
      {/* stumps */}
      <g fill="#f6f1e3">
        <rect x="594" y="474" width="2" height="12" />
        <rect x="599" y="474" width="2" height="12" />
        <rect x="604" y="474" width="2" height="12" />
        <rect x="591" y="640" width="3" height="18" />
        <rect x="598" y="640" width="3" height="18" />
        <rect x="605" y="640" width="3" height="18" />
      </g>
      {/* players */}
      {fielders.map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <ellipse cx="0" cy="16" rx="9" ry="3" fill="#000" opacity="0.18" />
          <rect x="-4" y="-6" width="8" height="18" rx="3" fill="#fbfaf3" />
          <circle cx="0" cy="-11" r="4.5" fill="#f0c9a2" />
        </g>
      ))}
      {/* batter at the crease */}
      <g transform="translate(588 610)">
        <rect x="-5" y="-8" width="10" height="24" rx="3" fill="#fbfaf3" />
        <circle cx="0" cy="-14" r="5.5" fill="#1d3557" />
        <rect x="6" y="-4" width="3" height="22" rx="1" fill="#c8a165" transform="rotate(20 6 -4)" />
      </g>

      {/* foreground fans with flags */}
      {crowd && (
        <g>
          <path d="M-20 700 L-20 640 Q40 600 90 640 Q140 590 200 640 Q260 610 310 650 Q360 620 420 660 L420 700 Z" fill="#1d1a14" />
          <path d="M780 700 L780 660 Q840 615 900 650 Q950 600 1010 645 Q1070 610 1130 640 Q1180 615 1220 635 L1220 700 Z" fill="#1d1a14" />
          <g>
            <line x1="120" y1="640" x2="150" y2="540" stroke="#1d1a14" strokeWidth="4" />
            <path d="M150 540 L215 552 L160 590 Z" fill="#f2c14e" />
            <line x1="1040" y1="640" x2="1010" y2="540" stroke="#1d1a14" strokeWidth="4" />
            <path d="M1010 540 L940 548 L1000 590 Z" fill="#4b8fd1" />
            <line x1="300" y1="650" x2="290" y2="575" stroke="#1d1a14" strokeWidth="4" />
            <path d="M290 575 L240 590 L292 612 Z" fill="#e86a5b" />
          </g>
        </g>
      )}

      {/* the ball in the sky */}
      {ball && (
        <g className="ball-float">
          <circle cx={bx} cy={by} r={br} fill={`url(#${id("ball")})`} />
          <path d={`M${bx - br * 0.55} ${by - br * 0.82} Q${bx + br * 0.15} ${by} ${bx - br * 0.55} ${by + br * 0.82}`} fill="none" stroke="#f7e2c4" strokeWidth={br * 0.035} opacity="0.9" />
          <path d={`M${bx - br * 0.42} ${by - br * 0.88} Q${bx + br * 0.3} ${by} ${bx - br * 0.42} ${by + br * 0.88}`} fill="none" stroke="#f7e2c4" strokeWidth={br * 0.035} opacity="0.9" />
          {Array.from({ length: 13 }).map((_, i) => {
            const t = (i + 1) / 14;
            const y = by - br * 0.85 + t * br * 1.7;
            const x = bx - br * 0.48 + Math.sin(t * Math.PI) * br * 0.38;
            return <line key={i} x1={x - br * 0.07} y1={y - br * 0.03} x2={x + br * 0.07} y2={y + br * 0.03} stroke="#f7e2c4" strokeWidth={br * 0.025} />;
          })}
          <circle cx={bx} cy={by} r={br} fill="#000" opacity="0.08" filter={`url(#${id("grain")})`} />
          <ellipse cx={bx - br * 0.35} cy={by - br * 0.4} rx={br * 0.22} ry={br * 0.12} fill="#fff" opacity="0.25" transform={`rotate(-35 ${bx - br * 0.35} ${by - br * 0.4})`} />
        </g>
      )}
      <rect width="1200" height="700" fill="#000" opacity="0.04" filter={`url(#${id("grain")})`} />
    </svg>
  );
}
