import type { MatchView } from "@/lib/match/view";
import { formatClock, relativeTo } from "@/lib/format";
import { teamAbbr } from "@/lib/data/normalize";
import { IconClock, IconCloud, IconCoin, IconDatabase, IconPin, IconPitch, IconUsers } from "../icons";
import { WeatherCard } from "./WeatherCard";

function Row({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-line py-3 last:border-0">
      <span className="mt-0.5 text-ink">{icon}</span>
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title}</p>
        <div className="text-muted">{children}</div>
      </div>
    </div>
  );
}

export function ContextRail({ view }: { view: MatchView }) {
  const c = view.context;
  const h = view.headToHead;
  return (
    <div className="card p-4">
      <h2 className="label-xs mb-1">Match context</h2>
      <Row icon={<IconPin />} title="Venue">
        {c.venue}
        <br />
        {c.venueHistory.matches} earlier matches here · avg {c.venueHistory.avgFirstInningsProxy ?? "—"} runs off the bat per innings · avg {c.venueHistory.avgPlayerPoints ?? "—"} pts/player
      </Row>
      <Row icon={<IconPitch />} title="Pitch report">
        {c.pitchReport ?? "Not available — no authorised pitch-report source is configured. Nothing is inferred."}
      </Row>
      <Row icon={<IconCoin />} title="Toss">
        {c.toss ? `${c.toss.winner} won and chose to ${c.toss.decision}.` : view.phase === "pre_match" ? "Not known at this decision time." : "Not available."}
      </Row>
      <Row icon={<IconUsers />} title="Playing XI">
        {c.lineupStatus === "confirmed_xi" ? "Confirmed XI (announced at the toss)." : c.lineupStatus === "imported_pool" ? "Imported player pool." : "Not announced — pool is a squad proxy from recent matches."}
      </Row>
      <Row icon={<IconCloud />} title="Weather">
        <WeatherCard matchId={view.match.id} />
      </Row>
      <Row icon={<IconClock />} title="Head to head (before this match)">
        {h.matches ? `${h.matches} meetings: ${teamAbbr(view.match.team1)} ${h.team1Wins}, ${teamAbbr(view.match.team2)} ${h.team2Wins}${h.noResult ? `, ${h.noResult} no result` : ""}.` : "No earlier meetings in this competition."}
      </Row>
      <Row icon={<IconDatabase />} title="Data freshness">
        {c.dataFreshness}
        {view.snapshotAt && (
          <>
            <br />
            Snapshot frozen {formatClock(view.snapshotAt)} ({relativeTo(view.snapshotAt, new Date())}).
          </>
        )}
        <ul className="mt-1 list-disc pl-4 text-xs">
          {c.sourceNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Row>
    </div>
  );
}
