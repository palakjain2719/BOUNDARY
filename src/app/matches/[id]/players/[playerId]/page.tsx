import Link from "next/link";
import { notFound } from "next/navigation";
import { IconBack } from "@/components/icons";
import { initials } from "@/components/match/FieldView";
import { getViewer } from "@/lib/auth";
import { teamAbbr } from "@/lib/data/normalize";
import { ROLE_LABEL } from "@/lib/data/types";
import { loadMatchView } from "@/lib/match/view";
import { getRepository } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function PlayerPage({ params }: { params: Promise<{ id: string; playerId: string }> }) {
  const { id, playerId: raw } = await params;
  const playerId = decodeURIComponent(raw);
  const user = await getViewer();
  const view = await loadMatchView(getRepository(user.accessToken), user, id);
  const p = view?.predictions.find((x) => x.playerId === playerId);
  if (!view || !p) notFound();
  const pool = view.pool.find((x) => x.playerId === playerId);
  const rec = view.recommendation;
  const picked = rec?.playerIds.includes(playerId);
  const avoid = rec?.avoid.find((a) => a.playerId === playerId);
  const pick = rec?.picks.find((a) => a.playerId === playerId);
  const alts = view.predictions.filter((x) => x.role === p.role && x.playerId !== playerId).sort((a, b) => b.mean - a.mean).slice(0, 5);
  const max = Math.max(10, ...p.recentPoints);

  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-6">
      <Link href={`/matches/${id}?view=players`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <IconBack size={16} /> {teamAbbr(view.match.team1)} vs {teamAbbr(view.match.team2)}
      </Link>
      <header className="mt-3 flex flex-wrap items-center gap-4">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-ink font-display text-xl text-white" aria-hidden>
          {initials(p.name)}
        </span>
        <div>
          <h1 className="font-display text-4xl">{p.name}</h1>
          <p className="text-muted">
            {p.team} · {ROLE_LABEL[p.role]} ({pool?.roleSource === "inferred_history" ? "inferred" : pool?.roleSource}) · {p.credits != null ? `${p.credits} credits${pool?.creditSource === "estimated_demo" ? " (demo estimate)" : ""}` : "credits unavailable"}
          </p>
        </div>
        {rec && <span className={`chip ml-auto ${picked ? "bg-pastel-green" : "bg-pastel-pink"}`}>{picked ? (rec.captainId === playerId ? "Optimizer captain" : rec.viceCaptainId === playerId ? "Optimizer vice-captain" : "In optimizer XI") : "Not in optimizer XI"}</span>}
      </header>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <section className="card p-5 md:col-span-1">
          <h2 className="label-xs">Forecast (base points)</h2>
          <p className="mt-1 font-display text-5xl">{p.mean.toFixed(1)}</p>
          <p className="text-sm text-muted">80% range {p.p10.toFixed(0)} to {p.p90.toFixed(0)} · σ {p.sigma}</p>
          <p className="mt-2 text-sm">Sample: {p.sampleSize} earlier {view.match.competition} matches{p.sampleSize < 5 ? " — thin, treat with caution" : ""}.</p>
          <p className="mt-2 text-xs text-muted">Model {view.modelId}. Multipliers are applied later: as captain {(p.mean * view.multipliers.captain).toFixed(1)}, as vice-captain {(p.mean * view.multipliers.viceCaptain).toFixed(1)}.</p>
        </section>
        <section className="card p-5 md:col-span-2">
          <h2 className="font-semibold">Recent form (earlier matches only)</h2>
          {p.recentPoints.length ? (
            <div className="mt-3 flex h-36 items-end gap-2" role="img" aria-label={`Last ${p.recentPoints.length} matches: ${p.recentPoints.map((x) => Math.round(x)).join(", ")} points`}>
              {p.recentPoints.map((x, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-muted">{Math.round(x)}</span>
                  <div className="w-full rounded-t bg-[#3b6fd8]" style={{ height: `${Math.max(2, (Math.max(0, x) / max) * 100)}px` }} />
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">No earlier matches in this competition.</p>
          )}
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {p.explanation.map((e) => (
              <li key={e}>{e}</li>
            ))}
            <li>Role: {p.roleReason}.</li>
            <li>At this venue: {p.venueMatches >= 3 && p.venueMean != null ? `${p.venueMean} avg in ${p.venueMatches} matches` : `${p.venueMatches} earlier matches (too few to use)`}.</li>
            <li>Against this opponent: {p.oppMatches >= 3 && p.oppMean != null ? `${p.oppMean} avg in ${p.oppMatches} matches` : `${p.oppMatches} earlier meetings (too few to use)`}.</li>
          </ul>
        </section>
      </div>

      {(pick || avoid) && (
        <section className="card mt-4 p-5 text-sm">
          <h2 className="font-semibold">{pick ? "Why the optimizer picked this player" : "Why the optimizer left this player out"}</h2>
          <p className="mt-1">{pick ? pick.reasons.join(" ") : avoid!.reason}</p>
        </section>
      )}

      <section className="card mt-4 p-5">
        <h2 className="font-semibold">Alternatives in the same role</h2>
        <ul className="mt-2 divide-y divide-line text-sm">
          {alts.map((a) => (
            <li key={a.playerId} className="flex items-center justify-between py-2">
              <Link href={`/matches/${id}/players/${encodeURIComponent(a.playerId)}`} className="hover:underline">
                {a.name} <span className="text-muted">({teamAbbr(a.team)})</span>
              </Link>
              <span>
                {a.mean.toFixed(1)} <span className="text-muted">({a.p10.toFixed(0)}–{a.p90.toFixed(0)}){a.credits != null ? ` · ${a.credits} cr` : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
