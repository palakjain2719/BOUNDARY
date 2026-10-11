import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import type { Metadata } from "next";
import { ClockBanner } from "@/components/ClockBanner";
import { getViewer } from "@/lib/auth";
import { SignInCallout } from "@/components/SignInCallout";

import { findMatch, loadManifest, PROCESSED_DIR } from "@/lib/data/historical";
import { teamAbbr } from "@/lib/data/normalize";
import { formatClock } from "@/lib/format";
import { getRepository } from "@/lib/store";
import { SYSTEM_USER_ID } from "@/lib/store/types";

export const metadata: Metadata = { title: "Past: history & teams" };
export const dynamic = "force-dynamic";

function reconciliation() {
  const f = path.join(PROCESSED_DIR, "reconciliation_kaggle-ipl-legacy-inferred.json");
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as { overall: { rows: number; exactTotalPct: number; mae: number; bias: number }; rulesVersion: string }) : null;
}

const label = (id: string) => {
  const m = findMatch(id)?.match;
  return m ? `${teamAbbr(m.team1)} v ${teamAbbr(m.team2)} · ${m.date}` : id;
};

export default async function HistoryPage() {
  const user = await getViewer();
  const repo = getRepository(user.accessToken);
  const manifest = loadManifest();
  const rec = reconciliation();
  const teams = [...(await repo.listUserTeams(user.id))].reverse();
  const evals = (await repo.listEvaluations(SYSTEM_USER_ID)).filter((e) => e.scope === "system").sort((a, b) => b.computedAt.localeCompare(a.computedAt));

  return (
    <>
      <ClockBanner />
      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        <h1 className="font-display text-4xl">Past</h1>
        <p className="mt-1 text-muted">Data coverage, your saved teams and every evaluated prediction.</p>

        {manifest && (
          <section className="mt-6 grid gap-4 md:grid-cols-3" aria-label="Data coverage">
            {(["IPL", "WPL"] as const).map((c) => (
              <div key={c} className={`rounded-3xl p-5 ${c === "IPL" ? "bg-pastel-blue" : "bg-pastel-pink"}`}>
                <p className="label-xs">{c === "IPL" ? "Men's IPL" : "Women's WPL"} · Cricsheet</p>
                <p className="mt-1 font-display text-3xl">{manifest.competitions[c].matches.toLocaleString()} matches</p>
                <p className="text-sm">
                  {manifest.competitions[c].dateRange?.from} → {manifest.competitions[c].dateRange?.to} · {manifest.competitions[c].playerMatchRows.toLocaleString()} player-match rows · {manifest.competitions[c].players} players · {manifest.competitions[c].superOverMatches} with Super Overs (excluded from fantasy stats)
                </p>
                <p className="mt-2 text-xs">{c === "IPL" ? "Fantasy labels: Kaggle Dream11 dataset, 2008–2023 only." : "No WPL fantasy labels exist in the data; reconstructed points are labelled unverified."}</p>
              </div>
            ))}
            <div className="rounded-3xl bg-pastel-yellow p-5">
              <p className="label-xs">Scoring reconciliation</p>
              {rec ? (
                <>
                  <p className="mt-1 font-display text-3xl">{rec.overall.exactTotalPct}% exact</p>
                  <p className="text-sm">
                    Calculator (legacy rules v{rec.rulesVersion}) vs {rec.overall.rows.toLocaleString()} Kaggle Dream11 totals with high-confidence player mapping. MAE {rec.overall.mae}, bias {rec.overall.bias}.
                  </p>
                </>
              ) : (
                <p className="text-sm">Run npm run data:reconcile.</p>
              )}
              <p className="mt-2 text-xs">
                Labels mapped: {manifest.kaggleIplLabels.high.toLocaleString()} high-confidence, {manifest.kaggleIplLabels.notHigh.toLocaleString()} not used, {manifest.kaggleIplLabels.placeholderRows} substitute placeholders excluded.
              </p>
            </div>
          </section>
        )}

        <section className="card mt-6 overflow-x-auto p-5" aria-labelledby="mine">
          <h2 id="mine" className="font-semibold">
            Your saved teams
          </h2>
          {user.guest ? (
            <div className="mt-2">
              <SignInCallout what="see the teams you've saved" />
            </div>
          ) : teams.length === 0 ? (
            <p className="mt-1 text-sm text-muted">
              None yet. Open a match and use <em>Build my XI</em>. Your team is optional — the pipeline&apos;s analysis does not depend on it.
            </p>
          ) : (
            <table className="mt-2 w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2">Match</th>
                  <th>Saved</th>
                  <th className="text-right">Projected</th>
                  <th>Validation</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="py-2">{label(t.matchId)}</td>
                    <td className="text-xs">{formatClock(t.createdAt)}</td>
                    <td className="text-right">{t.predictedTotal.toFixed(1)}</td>
                    <td className="text-xs">{t.validation.label}</td>
                    <td className="text-right">
                      <Link className="underline" href={`/matches/${t.matchId}/review`}>
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card mt-6 overflow-x-auto p-5" aria-labelledby="evals">
          <h2 id="evals" className="font-semibold">
            Evaluated predictions (background pipeline)
          </h2>
          {evals.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No completed matches evaluated yet.</p>
          ) : (
            <table className="mt-2 w-full min-w-[900px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2">Match</th>
                  <th>Model</th>
                  <th>Phase</th>
                  <th className="text-right">XI predicted</th>
                  <th className="text-right">XI actual</th>
                  <th className="text-right">Pool MAE</th>
                  <th className="text-right">Rank ρ</th>
                  <th className="text-right">In range</th>
                  <th>Actuals</th>
                </tr>
              </thead>
              <tbody>
                {evals.map((e) => (
                  <tr key={e.matchId} className="border-t border-line">
                    <td className="py-2">
                      <Link className="underline" href={`/matches/${e.matchId}/review`}>
                        {label(e.matchId)}
                      </Link>
                    </td>
                    <td className="text-xs">{e.modelId}</td>
                    <td className="text-xs">{e.decisionPhase === "post_toss" ? "after toss" : "before toss"}</td>
                    <td className="text-right">{e.optimizer?.predicted.toFixed(1) ?? "—"}</td>
                    <td className="text-right">{e.optimizer?.actual?.toFixed(1) ?? "—"}</td>
                    <td className="text-right">{e.poolMetrics?.mae.toFixed(1) ?? "—"}</td>
                    <td className="text-right">{e.poolMetrics?.spearman?.toFixed(2) ?? "—"}</td>
                    <td className="text-right">{e.poolMetrics ? `${Math.round(e.poolMetrics.coverage80 * 100)}%` : "—"}</td>
                    <td className="text-xs">{e.actualsSource.replace(/_/g, " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
