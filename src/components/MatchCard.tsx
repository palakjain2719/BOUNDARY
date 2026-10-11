import Link from "next/link";
import { COMPETITION_LABEL } from "@/lib/data/types";
import { teamAbbr } from "@/lib/data/normalize";
import { formatMatchTime } from "@/lib/format";
import type { CatalogItem } from "@/lib/match/catalog";
import { FONT_VAR, type MatchTheme } from "@/lib/themes/match-themes";
import { StadiumScene } from "./StadiumScene";
import { TeamMark } from "./TeamMark";
import { IconArrow, IconCheck, IconClock, IconInfo } from "./icons";

const ORIGIN_LABEL = { cricsheet_replay: "Archive replay", provider: "Provider", csv_import: "Imported", sim_replay: "Simulated" } as const;
const STATUS_STYLE = { live: "bg-[#b4122a] text-white", upcoming: "bg-white text-ink", completed: "bg-ink text-white" } as const;

export function MatchCard({ item, theme, rankPosition }: { item: CatalogItem; theme: MatchTheme; rankPosition?: number }) {
  const night = theme.scene === "night";
  const headInk = night ? "#ffffff" : theme.ink;
  const a = item.analysis;
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-3xl border border-line bg-paper transition hover:-translate-y-0.5 hover:shadow-lg focus-within:ring-2 focus-within:ring-ink">
      <div className="relative h-60 overflow-hidden" style={{ color: headInk }}>
        <StadiumScene uid={`c${item.id}`} sky={theme.sky} field={theme.field} stand={theme.stand} sun={theme.sun} scene={theme.scene} crowd={false} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-x-0 top-0 h-44" style={{ background: `linear-gradient(${theme.sky[0]}, ${theme.sky[0]}d9 60%, transparent)` }} aria-hidden />
        <div className="relative p-5">
          <div className="flex items-start justify-between gap-2">
            <span className="label-xs">{COMPETITION_LABEL[item.competition]}</span>
            <span className="flex flex-wrap justify-end gap-1">
              {rankPosition != null && <span className="chip bg-ink text-white">#{rankPosition} to analyse</span>}
              <span className={`chip ${STATUS_STYLE[item.status]}`}>{item.status === "live" ? "● LIVE" : item.status.toUpperCase()}</span>
            </span>
          </div>
          <h3 className="mt-2 text-[2.9rem] leading-[0.95]" style={{ fontFamily: FONT_VAR[theme.font] }}>
            {teamAbbr(item.team1)} <span className="align-middle text-2xl opacity-80">vs</span> {teamAbbr(item.team2)}
          </h3>
          <p className="mt-2 text-sm font-semibold">{formatMatchTime(item)}</p>
          <p className="text-sm">{item.venue}</p>
        </div>
      </div>
      <div className="relative flex flex-1 flex-col gap-3 p-5">
        <div className="-mt-12 flex items-center justify-center gap-3">
          <TeamMark team={item.team1} size={56} />
          <span className="font-display text-sm text-muted">vs</span>
          <TeamMark team={item.team2} size={56} />
        </div>
        <p className="text-xs text-muted">
          {item.team1} v {item.team2}
          {item.stage ? ` · ${item.stage}` : ""} · <span className="font-semibold">{ORIGIN_LABEL[item.origin]}</span>
        </p>
        {a ? (
          <div className="rounded-2xl p-3" style={{ background: theme.panel, color: theme.ink }}>
            <p className="flex items-center justify-between gap-2 text-sm font-semibold">
              <span>{a.recommendationId ? "Analysis ready" : "Prepared — no valid XI"}</span>
              <span className="chip bg-white" title="Advisory match suitability, not a points forecast">
                Suitability {a.suitability.score}/100
              </span>
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {a.suitability.reasons.slice(0, 3).map((r) => (
                <li key={r} className="flex items-start gap-1.5">
                  <IconCheck size={14} className="mt-0.5 shrink-0" /> {r}
                </li>
              ))}
            </ul>
            <p className="mt-2 flex items-center gap-1 text-[11px] opacity-80">
              <IconClock size={12} /> v{a.version} · {a.decisionPhase === "post_toss" ? "after toss" : "pre-toss"}
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <IconInfo size={14} /> {item.origin === "cricsheet_replay" ? "Archived match: open to replay it at decision time." : "Not prepared yet — the pipeline prepares fixtures within 7 days of start."}
          </p>
        )}
        <Link
          href={`/matches/${item.id}`}
          className="mt-auto inline-flex items-center justify-between rounded-full px-4 py-2.5 text-sm font-semibold after:absolute after:inset-0"
          style={{ background: theme.accent, color: theme.accentInk }}
          aria-label={`Open ${item.team1} versus ${item.team2}, ${item.date}`}
        >
          {item.status === "completed" ? "Review match" : a ? "Open prepared analysis" : "Open match"} <IconArrow size={16} />
        </Link>
      </div>
    </article>
  );
}
