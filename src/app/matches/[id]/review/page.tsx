import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ClockBanner } from "@/components/ClockBanner";
import { LoopRibbon } from "@/components/LoopRibbon";
import { IconBack } from "@/components/icons";
import { ActualsForm } from "@/components/review/ActualsForm";
import { PredVsActualChart, type RoleBar } from "@/components/review/PredVsActualChart";
import { PlayerButton, PlayerModalProvider } from "@/components/player/PlayerModal";
import { getViewer } from "@/lib/auth";
import { SignInCallout } from "@/components/SignInCallout";

import { teamAbbr } from "@/lib/data/normalize";
import { pts } from "@/lib/format";
import { getReview } from "@/lib/match/actions";
import { loadWorkspaceMatch } from "@/lib/match/workspace";
import { getClock } from "@/lib/pipeline/clock";
import { getRepository } from "@/lib/store";
import { SYSTEM_USER_ID, type TeamEvaluation, type TeamEvaluationSide } from "@/lib/store/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Post-match analysis" };

function SideCard({ title, side, tone }: { title: string; side: TeamEvaluationSide | null; tone: string }) {
  return (
    <section className={`rounded-3xl p-5 ${tone}`} aria-label={title}>
      <h2 className="font-display text-xl">{title}</h2>
      {side ? (
        <dl className="mt-3 grid grid-cols-3 gap-2">
          {[
            ["Predicted", pts(side.predicted)],
            ["Actual", side.actual == null ? "—" : pts(side.actual)],
            ["Error", side.error == null ? "—" : `${side.error > 0 ? "+" : ""}${pts(side.error)}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-white/80 p-3">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-display text-2xl">{v}</dd>
            </div>
          ))}
          {side.missing.length > 0 && <p className="col-span-3 text-xs">{side.missing.length} player(s) still missing actual points.</p>}
          <p className="col-span-3 text-[11px] text-muted">Error = predicted − actual (positive means over-predicted). Totals include C 2× / VC 1.5× applied once to base points.</p>
        </dl>
      ) : (
        <p className="mt-2 text-sm">No team saved for this match.</p>
      )}
    </section>
  );
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getViewer();
  const repo = getRepository(user.accessToken);
  const clock = await getClock(repo);
  const loaded = await loadWorkspaceMatch(repo, id, clock);
  if (!loaded) notFound();
  const m = loaded.match;
  if (m.status !== "completed") {
    return (
      <>
        <ClockBanner />
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h1 className="font-display text-3xl">Results not in yet</h1>
          <p className="mt-2 text-muted">The match is {m.status}. Predictions are frozen at the start; actual results are collected automatically after it completes.</p>
          <Link className="btn btn-primary mt-6" href={`/matches/${id}`}>
            Back to the match
          </Link>
        </div>
      </>
    );
  }
  const review = await getReview(repo, user, id);
  const system: TeamEvaluation | undefined = (await repo.listEvaluations(SYSTEM_USER_ID)).find((e) => e.matchId === id);
  const ev = review.evaluation;
  const pool = system?.poolPlayers ?? [];
  const roleData: RoleBar[] = ["WK", "BAT", "AR", "BOWL"].map((role) => {
    const src = pool.length ? pool.filter((p) => p.role === role) : (ev?.players ?? []).filter((p) => p.role === role);
    return { role, predicted: src.reduce((s, p) => s + p.predicted, 0), actual: src.reduce((s, p) => s + p.actual, 0), n: src.length };
  });
  const names = new Map((review.snapshot?.predictions ?? []).map((p) => [p.playerId, p.name]));
  const latest = new Map(review.actuals.map((a) => [a.playerId, a]));
  const sources = [...new Set(review.actuals.map((a) => `${a.source.replace("_", " ")} · ${a.verification.replace(/_/g, " ")}`))];
  const pm = system?.poolMetrics;

  return (
    <PlayerModalProvider matchId={id} predictions={review.snapshot?.predictions ?? []} captainId={review.recommendation?.captainId} viceCaptainId={review.recommendation?.viceCaptainId}>
      <ClockBanner />
      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        <Link href={`/matches/${id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <IconBack size={16} /> {teamAbbr(m.team1)} vs {teamAbbr(m.team2)}
        </Link>
        <h1 className="mt-2 font-display text-4xl">What did we learn?</h1>
        <p className="mt-1 text-muted">
          Frozen pre-match predictions compared with actual points. {m.result && <span>Result: {m.result}.</span>}
        </p>
        <p className="mt-2 flex flex-wrap gap-2 text-xs">
          {sources.length ? sources.map((s) => <span key={s} className="chip bg-pastel-yellow">Actuals: {s}</span>) : <span className="chip bg-pastel-pink">No actual points yet</span>}
          {sources.some((s) => s.includes("reconstructed")) && <span className="text-muted">Reconstructed = calculated from ball-by-ball events with the versioned rules; not official Dream11 totals.</span>}
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <SideCard title="Optimizer team" side={ev?.optimizer ?? system?.optimizer ?? null} tone="bg-pastel-blue" />
          <SideCard title="Your team" side={ev?.user ?? null} tone="bg-pastel-pink" />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <section className="card p-5">
            <PredVsActualChart data={roleData} title={pool.length ? "Predicted vs actual, whole eligible pool, by role" : "Predicted vs actual, selected players, by role"} />
          </section>
          <section className="card p-5" aria-labelledby="takeaways">
            <h2 id="takeaways" className="font-semibold">
              Key takeaways
            </h2>
            <ul className="mt-2 space-y-2 text-sm">
              {(ev?.takeaways ?? system?.takeaways ?? ["Enter or load actual points to see takeaways."]).map((t) => (
                <li key={t} className="rounded-xl bg-cream px-3 py-2">
                  {t}
                </li>
              ))}
            </ul>
            {pm && (
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                {[
                  ["Pool MAE", pm.mae.toFixed(1)],
                  ["Bias", `${pm.bias > 0 ? "+" : ""}${pm.bias.toFixed(1)}`],
                  ["Rank ρ", pm.spearman == null ? "—" : pm.spearman.toFixed(2)],
                  ["RMSE", pm.rmse.toFixed(1)],
                  ["In 80% range", `${Math.round(pm.coverage80 * 100)}%`],
                  ["C / VC error", `${pts(system?.captainError)} / ${pts(system?.viceCaptainError)}`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-paper p-2 ring-1 ring-line">
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-display text-lg">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {pm && <p className="mt-2 text-[11px] text-muted">Pool metrics cover {pm.n} players{pm.complete ? " (complete pool)" : ""}. One match is weak evidence; patterns are judged across many matches on the Performance page.</p>}
          </section>
        </div>

        {ev && ev.players.length > 0 && (
          <section className="card mt-4 overflow-x-auto p-5">
            <h2 className="font-semibold">Player-level comparison</h2>
            <table className="mt-2 w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2">Player</th>
                  <th>In</th>
                  <th className="text-right">Predicted</th>
                  <th className="text-right">Actual</th>
                  <th className="text-right">Error</th>
                  <th>What happened</th>
                </tr>
              </thead>
              <tbody>
                {[...ev.players]
                  .sort((a, b) => Math.abs(b.error) - Math.abs(a.error))
                  .map((p) => (
                    <tr key={p.playerId} className="border-t border-line align-top">
                      <td className="py-2 font-medium">
                        <PlayerButton playerId={p.playerId} matchId={id} className="hover:underline">
                          {p.name}
                        </PlayerButton>
                      </td>
                      <td className="text-xs">{[p.inUserTeam && "You", p.inOptimizerTeam && "Optimizer"].filter(Boolean).join(" + ")}</td>
                      <td className="text-right">{p.predicted.toFixed(1)}</td>
                      <td className="text-right">{p.actual.toFixed(1)}</td>
                      <td className={`text-right font-semibold ${p.error > 0 ? "text-bad" : "text-good"}`}>
                        {p.error > 0 ? "+" : ""}
                        {p.error.toFixed(1)}
                      </td>
                      <td className="text-xs text-muted">{p.attribution}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )}

        {user.guest && review.unionPlayerIds.length > 0 && (
          <div className="mt-4">
            <SignInCallout what="enter actual points or compare your own team" />
          </div>
        )}
        {!user.guest && review.unionPlayerIds.length > 0 && (
          <details className="mt-4" open={!review.actuals.length}>
            <summary className="cursor-pointer text-sm font-semibold">Enter or correct actual points</summary>
            <div className="mt-2">
              <ActualsForm
                matchId={id}
                rows={review.unionPlayerIds.map((pid) => ({ playerId: pid, name: names.get(pid) ?? pid, current: latest.get(pid)?.basePoints ?? null }))}
                canLoad={review.canLoad}
              />
            </div>
          </details>
        )}

        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-pastel-pink/60 p-5">
          <div>
            <h2 className="font-semibold">Model improvement</h2>
            <p className="text-sm">Errors from this match join the live evaluation set. Candidate changes are backtested chronologically and promoted only when release gates pass.</p>
          </div>
          <Link href="/learning" className="btn btn-primary">
            See patterns and proposals
          </Link>
        </section>
        <LoopRibbon className="mt-6" />
      </div>
    </PlayerModalProvider>
  );
}
