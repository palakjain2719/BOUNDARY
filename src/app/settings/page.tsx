import type { Metadata } from "next";
import { ClockBanner } from "@/components/ClockBanner";
import { ActionButton } from "@/components/match/ActionButton";
import { ImportForm } from "@/components/settings/ImportForm";
import { NotificationForm } from "@/components/settings/NotificationForm";
import { getViewer } from "@/lib/auth";
import { SignInCallout } from "@/components/SignInCallout";

import { env } from "@/lib/env";
import { runIntegrationChecks } from "@/lib/health";
import { formatClock, relativeTo } from "@/lib/format";
import { listTeamRules } from "@/lib/optimizer/rules";
import { clockMode, getClock } from "@/lib/pipeline/clock";
import { liveProvider, replayProvider } from "@/lib/providers";
import { FIXTURE_CSV_HEADER, POOL_CSV_HEADER } from "@/lib/providers/csv-import";
import { listRules } from "@/lib/scoring/registry";
import { getRepository } from "@/lib/store";
import { DAILY_LIMITS, usedToday } from "@/lib/ai/budget";

export const metadata: Metadata = { title: "Settings & admin" };
export const dynamic = "force-dynamic";

const STATE = {
  working: { cls: "bg-pastel-green", label: "working" },
  failing: { cls: "bg-pastel-pink", label: "failing" },
  needs_setup: { cls: "bg-pastel-yellow", label: "needs setup" },
  demo: { cls: "bg-pastel-lilac", label: "demo" },
} as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-28 p-5" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="font-display text-2xl">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const user = await getViewer();
  const repo = getRepository(user.accessToken);
  // Independent reads run in parallel (each is a database round trip).
  const [clock, runs, pref, scheduled, audit, fixtures, checks, search, explain] = await Promise.all([
    getClock(repo),
    repo.listJobRuns({ limit: 40 }),
    repo.getNotificationPreference(user.id),
    user.guest ? Promise.resolve([]) : repo.listScheduledNotifications({ userId: user.id }),
    user.isAdmin ? repo.listAudit(25) : Promise.resolve([]),
    repo.listFixtures(),
    runIntegrationChecks(),
    usedToday("google_search", repo),
    usedToday("gemini_explanation", repo),
  ]);
  const providers = [replayProvider(), liveProvider()].filter(Boolean);
  const usage = { search, explain };

  return (
    <>
      <ClockBanner />
      <div className="mx-auto max-w-7xl space-y-6 px-4 pt-6 sm:px-6">
        <h1 className="font-display text-4xl">Settings &amp; admin</h1>

        <Section id="integrations" title="Integrations">
          <p className="mb-3 text-sm text-muted">Live checks (cached 5 minutes): each one is a free lookup — no generation, no messages sent.</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {checks.map((s) => (
              <li key={s.name} className="rounded-2xl border border-line bg-white p-4">
                <p className="flex items-center justify-between gap-2 font-semibold">
                  {s.name} <span className={`chip ${STATE[s.state].cls}`}>{STATE[s.state].label}</span>
                </p>
                <p className="mt-1 text-sm text-muted">{s.detail}</p>
                {s.action && <p className="mt-1 text-sm"><strong>Next:</strong> {s.action}</p>}
                {s.envVars.length > 0 && <p className="mt-1 text-[11px] text-muted">Env: {s.envVars.join(", ")}</p>}
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-2xl bg-pastel-green/60 p-3 text-sm">
            <strong>Zero-cost guard (today, UTC):</strong> Google Search grounding {usage.search}/{DAILY_LIMITS.google_search()} · Gemini explanations {usage.explain}/{DAILY_LIMITS.gemini_explanation()}. Past a cap the app skips the call and uses deterministic fallbacks; a Google quota error (429) stops calls until the next day.
          </p>
          <p className="mt-3 text-xs text-muted">
            Brand name is configurable with NEXT_PUBLIC_BRAND_NAME (currently “{env.brandName}”). Health JSON: <a className="underline" href="/api/health">/api/health</a>.
          </p>
        </Section>

        <Section id="pipeline" title="Background pipeline">
          <p className="text-sm">
            Clock mode <strong>{clockMode()}</strong> · pipeline time {formatClock(clock.now.toISOString())} · {fixtures.length} fixtures tracked. Ticks run from Vercel Cron / an external scheduler (<code>/api/cron/pipeline</code>) or <code>npm run pipeline:daemon</code>; no login is needed.
          </p>
          {user.isAdmin && (
            <div className="mt-3 flex flex-wrap gap-3">
              <ActionButton url="/api/pipeline" body={{ action: "tick" }} label="Run one tick now" busyLabel="Running…" />
              {clock.simulated && (
                <>
                  <ActionButton url="/api/pipeline" body={{ action: "advance", hours: 6 }} label="Advance simulated clock 6h" busyLabel="Simulating…" className="btn btn-ghost" />
                  <ActionButton url="/api/pipeline" body={{ action: "advance", hours: 24 }} label="Advance 24h" busyLabel="Simulating…" className="btn btn-ghost" />
                </>
              )}
            </div>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="mb-1 text-left text-xs text-muted">Most recent job runs (idempotent keys; skipped repeats are not stored)</caption>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1">Job</th>
                  <th>Status</th>
                  <th>Attempt</th>
                  <th>Pipeline time</th>
                  <th>Ran</th>
                  <th>Summary / error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="py-1 font-medium">{r.job.replace(/_/g, " ")}</td>
                    <td>
                      <span className={`chip ${r.status === "succeeded" ? "bg-pastel-green" : r.status === "failed" ? "bg-pastel-pink" : "bg-cream"}`}>{r.status}</span>
                    </td>
                    <td>{r.attempt}</td>
                    <td className="text-xs">{formatClock(r.clockAt)}</td>
                    <td className="text-xs">{relativeTo(r.startedAt, new Date())}</td>
                    <td className="max-w-[420px] truncate text-xs text-muted" title={r.error ?? JSON.stringify(r.summary)}>
                      {r.error ?? JSON.stringify(r.summary).slice(0, 160)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="import" title="Data import (CSV)">
          <p className="text-sm text-muted">For fixtures, squads, roles and credits that no configured provider supplies. Rows are validated; nothing is guessed.</p>
          <div className="mt-3 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="font-semibold">Fixtures</h3>
              <ImportForm kind="fixtures" header={FIXTURE_CSV_HEADER} example={`${FIXTURE_CSV_HEADER}\nfx-2027-01,IPL,2027-03-26,2027-03-26T14:00:00Z,Asia/Kolkata,Wankhede Stadium,Mumbai,Mumbai Indians,Chennai Super Kings,upcoming`} />
            </div>
            <div>
              <h3 className="font-semibold">Player pool (roles, credits, announced XI)</h3>
              <ImportForm kind="pool" header={POOL_CSV_HEADER} example={`${POOL_CSV_HEADER}\nfx-2027-01,RG Sharma,Mumbai Indians,BAT,9.5,,740742ef`} />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">Actual points can be imported per match on its review page. Templates: <code>docs/templates/*.csv</code>.</p>
        </Section>

        <Section id="notifications" title="Reminders">
          {user.guest ? <SignInCallout what="set up match reminders" /> : <NotificationForm pref={pref} live={env.notificationsLive} />}
          {scheduled.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs">
              {scheduled.map((n) => (
                <li key={n.id}>
                  {n.channel} for match {n.matchId} at {formatClock(n.scheduledFor)} — <strong>{n.status}</strong>
                  {n.lastError ? ` (${n.lastError})` : ""}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="rules" title="Scoring rules (versioned)">
          <div className="grid gap-4 md:grid-cols-2">
            {listRules().map((r) => (
              <div key={r.id} className="rounded-2xl border border-line bg-white p-4 text-sm">
                <p className="flex items-center justify-between gap-2 font-semibold">
                  {r.name} <span className={`chip ${r.status === "verified" ? "bg-pastel-green" : "bg-pastel-yellow"}`}>{r.status}</span>
                </p>
                <p className="text-xs text-muted">
                  {r.id} v{r.version} · {r.competitions.join(", ")} · effective {r.effectiveFrom ?? "—"} to {r.effectiveTo ?? "—"} · verified {r.verifiedAt ?? "never"}
                </p>
                <p className="mt-2 text-xs">{r.provenance}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 text-xs">
                  <dt>Run / 4 / 6</dt>
                  <dd>
                    {r.batting.run} / +{r.batting.boundaryBonus} / +{r.batting.sixBonus}
                  </dd>
                  <dt>Milestones ({r.batting.milestoneMode.replace("_", " ")})</dt>
                  <dd>{r.batting.milestones.map((m) => `${m.at}:+${m.points}`).join(", ")}</dd>
                  <dt>Wicket / LBW-bowled</dt>
                  <dd>
                    {r.bowling.wicket} / +{r.bowling.lbwBowledBonus}
                  </dd>
                  <dt>Maiden / dot</dt>
                  <dd>
                    {r.bowling.maiden} / {r.bowling.dotBall}
                  </dd>
                  <dt>Catch / stumping / RO</dt>
                  <dd>
                    {r.fielding.catch} / {r.fielding.stumping} / {r.fielding.runOutDirect}·{r.fielding.runOutIndirect}
                  </dd>
                  <dt>Participation</dt>
                  <dd>{r.participation.announcedXI}</dd>
                  <dt>C / VC</dt>
                  <dd>
                    {r.multipliers.captain}× / {r.multipliers.viceCaptain}×
                  </dd>
                </dl>
                <ul className="mt-2 list-disc pl-4 text-[11px] text-muted">
                  {r.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <h3 className="mt-5 font-semibold">Team composition rules</h3>
          <ul className="mt-2 grid gap-3 md:grid-cols-2">
            {listTeamRules().map((t) => (
              <li key={t.id} className="rounded-2xl border border-line bg-white p-4 text-xs">
                <p className="flex items-center justify-between text-sm font-semibold">
                  {t.name} <span className="chip bg-pastel-yellow">{t.status}</span>
                </p>
                <p className="mt-1">
                  {t.squadSize} players · {t.creditCap} credits · max {t.maxPerRealTeam} per team · WK {t.roleLimits.WK.join("–")}, BAT {t.roleLimits.BAT.join("–")}, AR {t.roleLimits.AR.join("–")}, BOWL {t.roleLimits.BOWL.join("–")}
                </p>
                <p className="mt-1 text-muted">{t.provenance}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="coverage" title="Provider coverage">
          <div className="grid gap-4 md:grid-cols-2">
            {providers.map((p) => {
              const c = p!.coverage();
              return (
                <div key={c.provider} className="rounded-2xl border border-line bg-white p-4 text-sm">
                  <p className="font-semibold">{c.provider}</p>
                  <p className="text-xs text-muted">{c.competitions.join(" · ")}</p>
                  <ul className="mt-2 grid grid-cols-2 gap-1 text-xs">
                    {Object.entries(c.fields).map(([k, v]) => (
                      <li key={k}>
                        {k}: <span className={v === "supported" ? "text-good" : v === "unverified" ? "text-warn" : "text-bad"}>{v}</span>
                      </li>
                    ))}
                  </ul>
                  <ul className="mt-2 list-disc pl-4 text-[11px] text-muted">
                    {c.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          {!liveProvider() && <p className="mt-2 text-xs text-muted">No live provider configured (set CRICKET_PROVIDER=cricapi and CRICAPI_KEY). Coverage is never claimed beyond the configured sources.</p>}
        </Section>

        {user.isAdmin && (
        <Section id="audit" title="Audit log">
          <ul className="space-y-1 text-xs">
            {audit.map((a) => (
              <li key={a.id}>
                <span className="text-muted">{relativeTo(a.at, new Date())}</span> · <strong>{a.action}</strong> by {a.actor} · {a.entity} {a.entityId.slice(0, 36)}
              </li>
            ))}
          </ul>
        </Section>
        )}
      </div>
    </>
  );
}
