import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ClockBanner } from "@/components/ClockBanner";
import { StadiumScene } from "@/components/StadiumScene";
import { TeamMark } from "@/components/TeamMark";
import { ActionButton } from "@/components/match/ActionButton";
import { ContextRail } from "@/components/match/ContextRail";
import { FieldView } from "@/components/match/FieldView";
import { ReasoningPanel, ValidationBadge } from "@/components/match/ReasoningPanel";
import { TeamBuilder } from "@/components/match/TeamBuilder";
import { PlayerButton, PlayerModalProvider } from "@/components/player/PlayerModal";
import { IconBack } from "@/components/icons";
import { getViewer } from "@/lib/auth";
import { SignInCallout } from "@/components/SignInCallout";

import { COMPETITION_LABEL, type DecisionPhase } from "@/lib/data/types";
import { teamAbbr } from "@/lib/data/normalize";
import { formatClock, formatMatchTime } from "@/lib/format";
import { loadMatchView } from "@/lib/match/view";
import { getRepository } from "@/lib/store";
import { FONT_VAR, themeFor } from "@/lib/themes/match-themes";

export const dynamic = "force-dynamic";
type Params = Promise<{ id: string }>;
type SP = Promise<{ view?: string; phase?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return { title: `Match ${(await params).id}` };
}

const FRESH = {
  fresh: { label: "Fresh", cls: "bg-pastel-green" },
  stale: { label: "Update pending", cls: "bg-pastel-yellow" },
  frozen: { label: "Frozen at start", cls: "bg-pastel-blue" },
  missing: { label: "Not prepared", cls: "bg-pastel-pink" },
} as const;

export default async function MatchPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await getViewer();
  const repo = getRepository(user.accessToken);
  const view = await loadMatchView(repo, user, id, sp.phase as DecisionPhase | undefined);
  if (!view) notFound();
  const m = view.match;
  const theme = themeFor(m.id);
  const night = theme.scene === "night";
  const tab = sp.view === "mine" ? "mine" : sp.view === "players" ? "players" : "optimizer";
  const rec = view.recommendation;
  const byId = new Map(view.predictions.map((p) => [p.playerId, p]));
  const recPlayers = rec ? rec.playerIds.map((pid) => byId.get(pid)!).filter(Boolean) : [];
  const recCredits = rec ? rec.playerIds.reduce((s, pid) => s + (view.pool.find((p) => p.playerId === pid)?.credits ?? 0), 0) : 0;
  const lastTeam = view.userTeams[view.userTeams.length - 1] ?? null;
  const locked = m.status !== "upcoming" && m.origin !== "cricsheet_replay";
  const href = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ view: tab === "optimizer" ? undefined : tab, phase: sp.phase, ...o })) if (v) q.set(k, v);
    const s = q.toString();
    return `/matches/${id}${s ? `?${s}` : ""}`;
  };

  return (
    <PlayerModalProvider matchId={id} predictions={view.predictions} captainId={rec?.captainId} viceCaptainId={rec?.viceCaptainId}>
      <ClockBanner />
      <div className="mx-auto max-w-[1400px] px-4 pt-4 sm:px-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted">
          <Link href="/matches" className="inline-flex items-center gap-1 hover:text-ink">
            <IconBack size={16} /> Matches
          </Link>
          <span aria-hidden>›</span>
          <span>{COMPETITION_LABEL[m.competition]}</span>
          <span aria-hidden>›</span>
          <span className="font-semibold text-ink" aria-current="page">
            {teamAbbr(m.team1)} vs {teamAbbr(m.team2)}
          </span>
        </nav>

        <header className="relative mt-3 overflow-hidden rounded-3xl border border-line" style={{ color: night ? "#fff" : theme.ink }}>
          <StadiumScene uid={`h${m.id}`} sky={theme.sky} field={theme.field} stand={theme.stand} sun={theme.sun} scene={theme.scene} crowd={false} className="absolute inset-0 h-full w-full" />
          <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${theme.sky[0]} 0%, ${theme.sky[0]}e6 45%, transparent 100%)` }} aria-hidden />
          <div className="relative flex flex-wrap items-end justify-between gap-6 p-6">
            <div>
              <p className="label-xs">
                {COMPETITION_LABEL[m.competition]} · {m.season}
                {m.stage ? ` · ${m.stage}` : ""}
              </p>
              <h1 className="mt-1 text-6xl leading-none" style={{ fontFamily: FONT_VAR[theme.font] }}>
                {teamAbbr(m.team1)} <span className="text-3xl align-middle opacity-80">vs</span> {teamAbbr(m.team2)}
              </h1>
              <p className="mt-2 font-semibold">{formatMatchTime(m)}</p>
              <p className="text-sm">{m.venue}</p>
            </div>
            <div className="flex items-center gap-3">
              <TeamMark team={m.team1} size={64} />
              <TeamMark team={m.team2} size={64} />
            </div>
          </div>
        </header>

        <section aria-label="Analysis status" className="card mt-4 flex flex-wrap items-center gap-3 p-4 text-sm">
          {view.freshness ? (
            <>
              <span className={`chip ${FRESH[view.freshness.state].cls}`}>{FRESH[view.freshness.state].label}</span>
              {view.freshness.analysis && (
                <span>
                  Prepared by the background pipeline · version {view.freshness.analysis.version} of {view.freshness.versions} · {view.freshness.analysis.decisionPhase === "post_toss" ? "after toss" : "before toss"} · pipeline time {formatClock(view.freshness.analysis.clockAt)}
                </span>
              )}
              {view.freshness.reasons.map((r) => (
                <span key={r} className="text-muted">
                  {r}
                </span>
              ))}
              {view.freshness.state === "stale" && m.status === "upcoming" && <ActionButton url={`/api/matches/${id}/refresh`} label="Refresh this match now" className="btn btn-soft" />}
            </>
          ) : (
            <span>
              <span className="chip bg-pastel-blue">Archive replay</span> Built on demand at decision time: features use only matches before {m.date}.
            </span>
          )}
          {view.availablePhases.length > 1 && (
            <span className="ml-auto flex rounded-full border border-line bg-white p-1" role="group" aria-label="Decision phase">
              {view.availablePhases.map((ph) => (
                <Link key={ph} href={href({ phase: ph })} aria-current={view.phase === ph ? "true" : undefined} className={`rounded-full px-3 py-1 text-xs font-semibold ${view.phase === ph ? "bg-ink text-white" : ""}`}>
                  {ph === "post_toss" ? "After toss (XI known)" : "Before toss"}
                </Link>
              ))}
            </span>
          )}
          {m.status === "completed" && (
            <Link href={`/matches/${id}/review`} className="btn btn-primary ml-auto">
              Review result
            </Link>
          )}
          {m.status === "upcoming" && m.startTimeUtc && !user.guest && (
            <ActionButton url="/api/notifications" body={{ action: "follow", matchId: id }} label="Remind me 1h before" className="btn btn-ghost" />
          )}
        </section>

        {view.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-warn">
            {view.warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}

        <div className="mt-4 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_360px]">
          <aside aria-label="Match context" className="order-2 lg:order-1">
            <ContextRail view={view} />
          </aside>

          <section aria-label="Teams" className="order-1 min-w-0 space-y-4 lg:order-2">
            <nav className="flex flex-wrap gap-2" aria-label="Workspace views">
              {[
                { k: "optimizer", l: "Optimizer XI" },
                { k: "mine", l: "Build my XI" },
                { k: "players", l: "Player projections" },
              ].map((t) => (
                <Link key={t.k} href={href({ view: t.k === "optimizer" ? undefined : t.k })} aria-current={tab === t.k ? "page" : undefined} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === t.k ? "bg-ink text-white" : "border border-line bg-paper"}`}>
                  {t.l}
                </Link>
              ))}
            </nav>

            {tab === "optimizer" &&
              (rec ? (
                <>
                  <div className="card grid gap-4 p-4 sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted">Projected total (C 2× / VC 1.5×)</p>
                      <p className="font-display text-3xl">{rec.projectedTotal.toFixed(1)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Base points (no multipliers)</p>
                      <p className="font-display text-3xl">{rec.projectedBase.toFixed(1)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Credits {view.pool.some((p) => p.creditSource === "estimated_demo") ? "(demo estimates)" : ""}</p>
                      <p className="font-display text-3xl">
                        {recCredits.toFixed(1)}/{view.teamRules.creditCap}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-1">
                      <p className="text-xs text-muted">Deterministic validation</p>
                      <ValidationBadge rec={rec} />
                      <p className="text-[11px] text-muted">{rec.validation.teamRulesId}</p>
                    </div>
                  </div>
                  <FieldView players={recPlayers} captainId={rec.captainId} viceCaptainId={rec.viceCaptainId} limits={view.teamRules.roleLimits} matchId={id} team1={m.team1} />
                  <p className="text-xs text-muted">
                    Model {view.modelId} · scoring {view.rulesId} ({view.rulesStatus}) · team rules {view.teamRules.id} ({view.teamRules.status}) · recommendation {rec.id.slice(0, 8)} created {formatClock(rec.createdAt)}
                  </p>
                </>
              ) : view.infeasibility ? (
                <div className="card p-6">
                  <h2 className="font-display text-2xl">No valid lineup</h2>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {view.infeasibility.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="card p-6">
                  <h2 className="font-display text-2xl">Optimizer XI</h2>
                  <p className="mt-2 text-sm text-muted">This archived match was not prepared by the pipeline. Generate the optimizer team at this decision phase; it is saved as an immutable version.</p>
                  <div className="mt-4">
                    {user.guest ? <SignInCallout what="generate an optimizer XI for this archived match" /> : <ActionButton url={`/api/matches/${id}/optimize`} body={{ phase: view.phase }} label="Generate optimizer XI" busyLabel="Optimising…" />}
                  </div>
                </div>
              ))}

            {tab === "mine" && user.guest && <SignInCallout what="build and save your own XI" />}
            {tab === "mine" && !user.guest && (
              <TeamBuilder
                matchId={id}
                phase={view.phase}
                pool={view.pool}
                predictions={view.predictions}
                teamRules={view.teamRules}
                multipliers={view.multipliers}
                initial={lastTeam ? { playerIds: lastTeam.playerIds, captainId: lastTeam.captainId, viceCaptainId: lastTeam.viceCaptainId } : null}
                locked={locked}
                team1={m.team1}
              />
            )}

            {tab === "players" && (
              <div className="card overflow-x-auto p-4">
                <table className="w-full min-w-[720px] text-sm">
                  <caption className="mb-2 text-left text-xs text-muted">Expected base points (before multipliers) with 80% ranges. Missing statistics are excluded, never counted as zero.</caption>
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-2">Player</th>
                      <th>Team</th>
                      <th>Role</th>
                      <th className="text-right">Projected</th>
                      <th className="text-right">Range</th>
                      <th className="text-right">Prior matches</th>
                      <th className="text-right">Venue avg</th>
                      <th className="text-right">In optimizer XI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...view.predictions]
                      .sort((a, b) => b.mean - a.mean)
                      .map((p) => (
                        <tr key={p.playerId} className="border-t border-line">
                          <td className="py-2">
                            <PlayerButton playerId={p.playerId} matchId={id} className="font-medium hover:underline">
                              {p.name}
                            </PlayerButton>
                          </td>
                          <td>{teamAbbr(p.team)}</td>
                          <td title={p.roleReason}>{p.role}</td>
                          <td className="text-right font-semibold">{p.mean.toFixed(1)}</td>
                          <td className="text-right text-muted">
                            {p.p10.toFixed(0)}–{p.p90.toFixed(0)}
                          </td>
                          <td className="text-right">{p.sampleSize}</td>
                          <td className="text-right">{p.venueMatches >= 3 && p.venueMean != null ? `${p.venueMean} (${p.venueMatches})` : "—"}</td>
                          <td className="text-right">{rec?.playerIds.includes(p.playerId) ? (rec.captainId === p.playerId ? "C" : rec.viceCaptainId === p.playerId ? "VC" : "✓") : ""}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside aria-label="Reasoning" className="order-3 lg:col-span-2 xl:col-span-1">
            {rec ? (
              <ReasoningPanel rec={rec} predictions={view.predictions} matchId={id} />
            ) : (
              <div className="card p-4 text-sm text-muted">Reasoning appears once an optimizer team exists for this match.</div>
            )}
            {view.suitability && (
              <div className="card mt-4 p-4 text-sm">
                <h3 className="font-semibold">Match suitability (advisory): {view.suitability.score}/100</h3>
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {view.suitability.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {view.versions.length > 0 && (
              <details className="card mt-4 p-4 text-xs">
                <summary className="cursor-pointer text-sm font-semibold">Prediction versions ({view.versions.length})</summary>
                <ol className="mt-2 space-y-1">
                  {view.versions.map((v) => (
                    <li key={v.version}>
                      v{v.version} · {v.phase === "post_toss" ? "after toss" : "before toss"} · {v.trigger.replace(/_/g, " ")} · {formatClock(v.clockAt)}
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-muted">Earlier versions are kept unchanged; new information creates a new version.</p>
              </details>
            )}
          </aside>
        </div>
      </div>
    </PlayerModalProvider>
  );
}
