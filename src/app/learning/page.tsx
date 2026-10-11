import Link from "next/link";
import type { Metadata } from "next";
import { ClockBanner } from "@/components/ClockBanner";
import { LoopRibbon } from "@/components/LoopRibbon";
import { ActionButton } from "@/components/match/ActionButton";
import { getViewer } from "@/lib/auth";
import type { Competition } from "@/lib/data/types";
import { formatClock } from "@/lib/format";
import { ACCEPTANCE, MIN_SUPPORT, WINDOWS } from "@/lib/learning/loop";
import { builtinModels, getActiveModel, loadBenchmark } from "@/lib/models/registry";
import { getRepository } from "@/lib/store";
import { SYSTEM_USER_ID, type TeamEvaluation } from "@/lib/store/types";

export const metadata: Metadata = { title: "Performance & learning" };
export const dynamic = "force-dynamic";

function aggregate(evals: TeamEvaluation[]) {
  const rows = evals.flatMap((e) => e.poolPlayers ?? []);
  if (!rows.length) return null;
  const err = rows.map((r) => r.predicted - r.actual);
  const sp = evals.map((e) => e.poolMetrics?.spearman).filter((x): x is number => x != null);
  const teamErr = evals.map((e) => e.optimizer?.error).filter((x): x is number => x != null);
  const cap = evals.map((e) => e.captainError).filter((x): x is number => x != null);
  return {
    matches: evals.length,
    rows: rows.length,
    mae: err.reduce((s, e) => s + Math.abs(e), 0) / rows.length,
    rmse: Math.sqrt(err.reduce((s, e) => s + e * e, 0) / rows.length),
    bias: err.reduce((s, e) => s + e, 0) / rows.length,
    coverage: evals.reduce((s, e) => s + (e.poolMetrics?.coverage80 ?? 0) * (e.poolMetrics?.n ?? 0), 0) / Math.max(1, evals.reduce((s, e) => s + (e.poolMetrics?.n ?? 0), 0)),
    spearman: sp.length ? sp.reduce((a, b) => a + b, 0) / sp.length : null,
    teamMae: teamErr.length ? teamErr.reduce((s, e) => s + Math.abs(e), 0) / teamErr.length : null,
    captainMae: cap.length ? cap.reduce((s, e) => s + Math.abs(e), 0) / cap.length : null,
    invalid: evals.reduce((s, e) => s + (e.invalidCandidates ?? 0), 0),
  };
}

const f = (n: number | null | undefined, d = 1) => (n == null ? "—" : n.toFixed(d));

export default async function LearningPage() {
  const user = await getViewer();
  const repo = getRepository(user.accessToken);
  const bench = loadBenchmark();
  const models = builtinModels();
  const evals = (await repo.listEvaluations(SYSTEM_USER_ID)).filter((e) => e.scope === "system");
  const patterns = await repo.listPatterns();
  const proposals = [...(await repo.listProposals())].reverse();
  const activations = await repo.listActivations();
  const comps: Competition[] = ["IPL", "WPL"];
  const active = Object.fromEntries(await Promise.all(comps.map(async (c) => [c, await getActiveModel(repo, c)] as const)));

  return (
    <>
      <ClockBanner />
      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        <h1 className="font-display text-4xl">Performance &amp; learning</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Every number on this page is measured from stored data: the offline benchmark, and evaluations of frozen predictions after matches completed. Nothing here is illustrative.
        </p>

        <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label="Active models">
          {comps.map((c) => {
            const a = active[c];
            const agg = aggregate(evals.filter((e) => e.competition === c && e.origin !== "replay_backfill"));
            const replay = aggregate(evals.filter((e) => e.competition === c && e.origin === "replay_backfill"));
            const acts = activations.filter((x) => x.competition === c);
            return (
              <div key={c} className={`rounded-3xl p-5 ${c === "IPL" ? "bg-pastel-blue" : "bg-pastel-pink"}`}>
                <p className="label-xs">{c === "IPL" ? "Men's IPL" : "Women's WPL"} · active model</p>
                <h2 className="mt-1 font-display text-2xl">{a.model.name}</h2>
                <p className="text-xs">
                  {a.model.id} · target {a.model.targetLabelSource.replace(/_/g, " ")} {Object.keys(a.params).length ? `· params ${JSON.stringify(a.params)}` : ""}
                </p>
                <p className="mt-2 text-sm">{a.model.notes}</p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  {[
                    ["Live matches", agg ? String(agg.matches) : "0"],
                    ["Player MAE", f(agg?.mae)],
                    ["Bias", agg ? `${agg.bias > 0 ? "+" : ""}${f(agg.bias)}` : "—"],
                    ["Rank ρ (avg)", f(agg?.spearman, 2)],
                    ["In 80% range", agg ? `${Math.round(agg.coverage * 100)}%` : "—"],
                    ["Captain |error|", f(agg?.captainMae)],
                    ["Team total |error|", f(agg?.teamMae)],
                    ["Invalid XI retries", agg ? String(agg.invalid) : "0"],
                    ["Player rows", agg ? String(agg.rows) : "0"],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-white/80 p-2">
                      <dt className="text-muted">{k}</dt>
                      <dd className="font-display text-lg">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 rounded-2xl bg-white/60 p-3">
                  <p className="text-xs font-semibold">Replay backfill · {replay ? `${replay.matches} matches, ${replay.rows} player rows` : "not run"}</p>
                  <p className="text-[11px] text-muted">Past {c} matches rebuilt at decision time (post-toss, features from earlier matches only), then scored. Measured, but not live.</p>
                  {replay && (
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                      {[
                        ["Player MAE", f(replay.mae)],
                        ["Bias", `${replay.bias > 0 ? "+" : ""}${f(replay.bias)}`],
                        ["Rank ρ (avg)", f(replay.spearman, 2)],
                        ["In 80% range", `${Math.round(replay.coverage * 100)}%`],
                        ["Captain |error|", f(replay.captainMae)],
                        ["Team total |error|", f(replay.teamMae)],
                      ].map(([k, v]) => (
                        <div key={k} className="rounded-xl bg-white/80 p-2">
                          <dt className="text-muted">{k}</dt>
                          <dd className="font-display text-lg">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
                <p className="mt-2 text-[11px]">Live metrics use {c === "IPL" ? "reconstructed points after 2023 (no Dream11 labels exist for those seasons in the data)" : "reconstructed_unverified WPL points"}.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span>{acts.length} activation(s) in the audit trail.</span>
                  {acts.length > 0 && user.isAdmin && <ActionButton url="/api/learning" body={{ action: "rollback", competition: c }} label="Roll back last change" className="btn btn-soft" confirm="Roll back the last model activation?" />}
                </div>
              </div>
            );
          })}
        </section>

        <section className="card mt-6 overflow-x-auto p-5" aria-labelledby="bench">
          <h2 id="bench" className="font-semibold">
            Offline benchmark (men&apos;s IPL, Kaggle Dream11 labels, chronological split)
          </h2>
          {bench ? (
            <table className="mt-2 w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2">Model</th>
                  <th className="text-right">Val MAE (2020–21)</th>
                  <th className="text-right">Test MAE (2022–23)</th>
                  <th className="text-right">Test RMSE</th>
                  <th className="text-right">Test bias</th>
                  <th className="text-right">Test R²</th>
                  <th className="text-right">Test rank ρ</th>
                  <th className="text-right">80% PI coverage</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(bench.results)
                  .sort((a, b) => a[1].test.mae - b[1].test.mae)
                  .map(([k, v]) => (
                    <tr key={k} className={`border-t border-line ${k === bench.selectedOnValidation ? "font-semibold" : ""}`}>
                      <td className="py-2">
                        {k} {k === bench.selectedOnValidation && <span className="chip bg-pastel-green">selected on validation</span>}
                      </td>
                      <td className="text-right">{f(v.validation.mae, 2)}</td>
                      <td className="text-right">{f(v.test.mae, 2)}</td>
                      <td className="text-right">{f(v.test.rmse, 2)}</td>
                      <td className="text-right">{f(v.test.bias, 2)}</td>
                      <td className="text-right">{f(v.test.r2, 3)}</td>
                      <td className="text-right">{f(v.test.spearman, 3)}</td>
                      <td className="text-right">{v.test.intervalCoverage80 == null ? "—" : `${Math.round(v.test.intervalCoverage80 * 100)}%`}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted">Run the benchmark (npm run ml:benchmark).</p>
          )}
          <p className="mt-2 text-xs text-muted">The signal is weak: the selected model is only about 1.5% better than predicting the training average. {models.filter((m) => !m.servable).length} benchmark-only models are not served.</p>
        </section>

        <section className="mt-6" aria-labelledby="patterns">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="patterns" className="font-display text-2xl">
              Error patterns
            </h2>
            {user.isAdmin && (
              <span className="flex gap-2">
                <ActionButton url="/api/learning" body={{ action: "refresh", competition: "IPL" }} label="Re-detect IPL" className="btn btn-soft" />
                <ActionButton url="/api/learning" body={{ action: "refresh", competition: "WPL" }} label="Re-detect WPL" className="btn btn-soft" />
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">
            A segment is flagged only with n ≥ {MIN_SUPPORT}, |bias| ≥ 2 and |t| ≥ 2. Historical patterns come from {WINDOWS.IPL.calibrate.name} / {WINDOWS.WPL.calibrate.name}; live patterns from evaluated frozen predictions. Insufficient segments are shown but never acted on.
          </p>
          <div className="card mt-3 overflow-x-auto p-4">
            {patterns.length === 0 ? (
              <p className="text-sm text-muted">No patterns detected yet.</p>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-2">Competition</th>
                    <th>Source</th>
                    <th>Segment</th>
                    <th className="text-right">n</th>
                    <th className="text-right">Bias</th>
                    <th className="text-right">MAE</th>
                    <th className="text-right">t</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {patterns
                    .sort((a, b) => Math.abs(b.tStat) - Math.abs(a.tStat))
                    .slice(0, 30)
                    .map((p) => (
                      <tr key={p.id} className="border-t border-line">
                        <td className="py-2">{p.competition}</td>
                        <td className="text-xs">{p.source.replace("_", " ")}</td>
                        <td>
                          {p.segmentType}: <strong>{p.segment}</strong> ({p.direction})
                        </td>
                        <td className="text-right">{p.n}</td>
                        <td className="text-right">{p.bias > 0 ? "+" : ""}{p.bias}</td>
                        <td className="text-right">{p.mae}</td>
                        <td className="text-right">{p.tStat}</td>
                        <td>
                          <span className={`chip ${p.confidence === "high" ? "bg-pastel-green" : p.confidence === "moderate" ? "bg-pastel-yellow" : "bg-cream"}`}>{p.confidence}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="mt-6" aria-labelledby="proposals">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="proposals" className="font-display text-2xl">
              Candidate changes
            </h2>
            <span className="flex gap-2">
              <Link href="/learning/weights" className="btn btn-ghost">
                Review model weights
              </Link>
              {user.isAdmin && <ActionButton url="/api/learning" body={{ action: "propose", competition: "IPL" }} label="Propose from IPL patterns" className="btn btn-soft" />}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Release gates: ≥ {ACCEPTANCE.minRows.IPL} IPL / {ACCEPTANCE.minRows.WPL} WPL evaluation rows, MAE improvement ≥ {ACCEPTANCE.minImprovementPct}% on the later window, no role segment worse by more than {ACCEPTANCE.maxSegmentRegressionPct}%, and no regression on the recent window. The pipeline promotes at most one passing change per cycle; previous versions stay available for rollback.
          </p>
          <ul className="mt-3 space-y-3">
            {proposals.length === 0 && <li className="card p-4 text-sm text-muted">No proposals yet. The pipeline creates them once enough new observations accumulate.</li>}
            {proposals.slice(0, 20).map((p) => (
              <li key={p.id} id={`p-${p.id}`} className="card p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`chip ${p.status === "accepted" ? "bg-pastel-green" : p.status === "rejected" || p.status === "rolled_back" ? "bg-pastel-pink" : "bg-pastel-yellow"}`}>{p.status.replace("_", " ")}</span>
                  <span className="font-semibold">{p.competition}</span>
                  <span className="text-xs text-muted">
                    {p.baseModelId} → {p.candidateModelId} · {formatClock(p.createdAt)}
                    {p.decidedBy ? ` · decided by ${p.decidedBy}` : ""}
                  </span>
                </div>
                <p className="mt-1">{p.rationale}</p>
                {p.evaluation && (
                  <p className="mt-1 text-xs">
                    {p.evaluation.window} ({p.evaluation.labelSource.replace(/_/g, " ")}, n={p.evaluation.n}): MAE {p.evaluation.baseMae} → {p.evaluation.candidateMae} ({p.evaluation.improvementPct > 0 ? "+" : ""}
                    {p.evaluation.improvementPct}%). {p.evaluation.criteria.join(" · ")}
                  </p>
                )}
                {user.isAdmin && p.status === "proposed" && <ActionButton url="/api/learning" body={{ action: "backtest", proposalId: p.id }} label="Run backtest" className="btn btn-soft mt-2" />}
                {user.isAdmin && p.status === "backtested" && (
                  <span className="mt-2 flex gap-2">
                    {p.evaluation?.passes && <ActionButton url="/api/learning" body={{ action: "decide", proposalId: p.id, decision: "accept" }} label="Promote" className="btn btn-primary" />}
                    <ActionButton url="/api/learning" body={{ action: "decide", proposalId: p.id, decision: "reject" }} label="Reject" className="btn btn-soft" />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
        <LoopRibbon className="mt-8" />
      </div>
    </>
  );
}
