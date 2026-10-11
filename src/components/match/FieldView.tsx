import { PlayerButton } from "../player/PlayerModal";
import type { PlayerRole } from "@/lib/data/types";
import { teamAbbr } from "@/lib/data/normalize";
import type { SnapshotPrediction } from "@/lib/store/types";

const ROWS: { role: PlayerRole; label: string }[] = [
  { role: "WK", label: "Wicket-keepers" },
  { role: "BAT", label: "Batters" },
  { role: "AR", label: "All-rounders" },
  { role: "BOWL", label: "Bowlers" },
];

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Team laid out on a cricket field by role. Presentational; used by the optimizer view and the builder. */
export function FieldView({
  players,
  captainId,
  viceCaptainId,
  limits,
  matchId,
  team1,
  onRemove,
}: {
  players: SnapshotPrediction[];
  captainId: string | null;
  viceCaptainId: string | null;
  limits: Record<PlayerRole, [number, number]>;
  matchId: string;
  team1: string;
  onRemove?: (id: string) => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl p-4 sm:p-6" style={{ background: "radial-gradient(ellipse at 50% 40%, #9ccc65 0%, #7cb342 55%, #5f9431 100%)" }}>
      <div className="pointer-events-none absolute inset-6 rounded-[50%] border-2 border-dashed border-white/40" aria-hidden />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-48 w-14 -translate-x-1/2 -translate-y-1/2 rounded bg-[#d9c08a]/80" aria-hidden />
      <div className="relative space-y-5">
        {ROWS.map((row) => {
          const ps = players.filter((p) => p.role === row.role);
          const [min, max] = limits[row.role];
          return (
            <section key={row.role} aria-label={`${row.label}, ${ps.length} selected (allowed ${min} to ${max})`}>
              <p className="label-xs mb-2 text-white drop-shadow">
                {row.role} <span className="font-normal opacity-90">({min}–{max}) · {ps.length}</span>
              </p>
              <ul className="flex flex-wrap justify-center gap-3">
                {ps.length === 0 && <li className="rounded-xl border border-dashed border-white/70 px-4 py-3 text-xs text-white">No {row.label.toLowerCase()} yet</li>}
                {ps.map((p) => (
                  <li key={p.playerId} className="relative w-[124px] rounded-2xl bg-white/95 p-2 text-ink shadow">
                    {(p.playerId === captainId || p.playerId === viceCaptainId) && (
                      <span className={`absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold ${p.playerId === captainId ? "bg-ink text-white" : "bg-pastel-yellow text-ink"}`} aria-label={p.playerId === captainId ? "Captain" : "Vice-captain"}>
                        {p.playerId === captainId ? "C" : "VC"}
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${p.team === team1 ? "bg-[#1d3557]" : "bg-[#9d2235]"}`} aria-hidden>
                        {initials(p.name)}
                      </span>
                      <span className="min-w-0">
                        <PlayerButton playerId={p.playerId} matchId={matchId} className="block w-full truncate text-xs font-semibold hover:underline">
                          {p.name}
                        </PlayerButton>
                        <span className="block text-[10px] text-muted">
                          {teamAbbr(p.team)} · {p.credits != null ? `${p.credits} cr` : "— cr"}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1 text-[11px]">
                      <strong>{p.mean.toFixed(1)}</strong> pts <span className="text-muted">({p.p10.toFixed(0)}–{p.p90.toFixed(0)})</span>
                    </p>
                    {onRemove && (
                      <button type="button" onClick={() => onRemove(p.playerId)} className="mt-1 w-full rounded-full bg-cream py-0.5 text-[10px] font-semibold hover:bg-pastel-pink" aria-label={`Remove ${p.name}`}>
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
