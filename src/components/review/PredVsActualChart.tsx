"use client";
import { useState } from "react";

const SERIES = [
  { key: "predicted", label: "Predicted", color: "#3b6fd8" },
  { key: "actual", label: "Actual", color: "#d6457a" },
] as const;

export interface RoleBar {
  role: string;
  predicted: number;
  actual: number;
  n: number;
}

/** Grouped bars of total predicted vs actual base points per role. Hover/focus shows exact values. */
export function PredVsActualChart({ data, title }: { data: RoleBar[]; title: string }) {
  const [hover, setHover] = useState<{ role: string; key: string; v: number; n: number } | null>(null);
  const W = 520;
  const H = 240;
  const pad = { l: 44, r: 12, t: 12, b: 32 };
  const max = Math.max(10, ...data.flatMap((d) => [d.predicted, d.actual]));
  const nice = Math.ceil(max / 50) * 50;
  const ticks = [0, nice / 2, nice];
  const groupW = (W - pad.l - pad.r) / Math.max(1, data.length);
  const barW = Math.min(34, groupW / 3);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  return (
    <figure className="relative">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
        {title}
        <span className="flex gap-3 text-xs font-normal text-muted" aria-label="Legend">
          {SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden /> {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`${title}. ${data.map((d) => `${d.role}: predicted ${d.predicted.toFixed(0)}, actual ${d.actual.toFixed(0)}`).join("; ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e3dcc8" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#5a574d">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + groupW * i + groupW / 2;
          return (
            <g key={d.role}>
              {SERIES.map((s, j) => {
                const v = d[s.key];
                const x = cx + (j === 0 ? -barW - 1 : 1);
                const h = Math.max(0, y(0) - y(Math.max(0, v)));
                const r = Math.min(4, h / 2);
                const top = y(0) - h;
                return (
                  <g key={s.key}>
                    <path
                      d={`M${x} ${y(0)} V${top + r} Q${x} ${top} ${x + r} ${top} H${x + barW - r} Q${x + barW} ${top} ${x + barW} ${top + r} V${y(0)} Z`}
                      fill={s.color}
                      opacity={hover && (hover.role !== d.role || hover.key !== s.key) ? 0.45 : 1}
                    />
                    <rect
                      x={x - 3}
                      y={pad.t}
                      width={barW + 6}
                      height={H - pad.t - pad.b}
                      fill="transparent"
                      tabIndex={0}
                      aria-label={`${d.role} ${s.label}: ${v.toFixed(1)} points`}
                      onMouseEnter={() => setHover({ role: d.role, key: s.label, v, n: d.n })}
                      onFocus={() => setHover({ role: d.role, key: s.label, v, n: d.n })}
                      onMouseLeave={() => setHover(null)}
                      onBlur={() => setHover(null)}
                    />
                  </g>
                );
              })}
              <text x={cx} y={H - 10} textAnchor="middle" fontSize="12" fill="#151512">
                {d.role}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute right-2 top-8 rounded-xl border border-line bg-white px-3 py-2 text-xs shadow" role="status">
          <strong>{hover.role}</strong> · {hover.key}: {hover.v.toFixed(1)} pts ({hover.n} players)
        </div>
      )}
    </figure>
  );
}
