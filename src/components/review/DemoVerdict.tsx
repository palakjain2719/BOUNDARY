import type { PlayerEvaluation, TeamEvaluation, TeamEvaluationSide } from "@/lib/store/types";
import { pts } from "@/lib/format";

/**
 * Plain-language comparison of the user's XI and the optimizer's XI once actual points are in.
 * Deterministic (no LLM), so it is instant and identical every time it is shown.
 */
function captainCheck(label: string, side: TeamEvaluationSide, players: PlayerEvaluation[], inTeam: (p: PlayerEvaluation) => boolean) {
  const xi = players.filter(inTeam);
  const cap = xi.find((p) => p.playerId === side.captainId);
  const vc = xi.find((p) => p.playerId === side.viceCaptainId);
  const best = [...xi].sort((a, b) => b.actual - a.actual)[0];
  if (!cap || !best) return null;
  const lost = best.playerId === cap.playerId ? 0 : best.actual - cap.actual; // captain bonus = 1 × base
  return {
    label,
    cap,
    vc,
    best,
    text:
      best.playerId === cap.playerId
        ? `${label} captain ${cap.name} was the best possible choice (${pts(cap.actual)} base, ${pts(cap.actual * 2)} as captain).`
        : `${label} captain ${cap.name} scored ${pts(cap.actual)}; ${best.name} scored ${pts(best.actual)}. Captaining ${best.name} would have added ${pts(lost)} points.`,
  };
}

export function DemoVerdict({ ev }: { ev: TeamEvaluation }) {
  const u = ev.user;
  const o = ev.optimizer;
  if (!u || !o) return null;
  const complete = u.actual != null && o.actual != null && !u.missing.length && !o.missing.length;
  if (!complete) {
    return (
      <section className="card mt-6 border-2 border-dashed border-ink/30 p-5" aria-label="Demo verdict">
        <h2 className="font-display text-2xl">Verdict</h2>
        <p className="mt-1 text-sm">
          Enter the Dream11 points for every player below ({u.missing.length + o.missing.length} still missing) to see which team was better and why.
        </p>
      </section>
    );
  }
  const diff = (u.actual ?? 0) - (o.actual ?? 0);
  const winner = Math.abs(diff) < 0.5 ? "tie" : diff > 0 ? "you" : "optimizer";
  const onlyYou = ev.players.filter((p) => p.inUserTeam && !p.inOptimizerTeam).sort((a, b) => b.actual - a.actual);
  const onlyOpt = ev.players.filter((p) => p.inOptimizerTeam && !p.inUserTeam).sort((a, b) => b.actual - a.actual);
  const shared = ev.players.filter((p) => p.inUserTeam && p.inOptimizerTeam);
  const sum = (xs: PlayerEvaluation[]) => xs.reduce((s, p) => s + p.actual, 0);
  const capU = captainCheck("Your", u, ev.players, (p) => p.inUserTeam);
  const capO = captainCheck("The optimizer's", o, ev.players, (p) => p.inOptimizerTeam);
  const uErr = Math.abs(u.error ?? 0);
  const oErr = Math.abs(o.error ?? 0);
  const surprises = [...ev.players].sort((a, b) => Math.abs(b.error) - Math.abs(a.error)).slice(0, 3);

  const headline =
    winner === "tie"
      ? `It's a tie: both teams scored ${pts(u.actual)}.`
      : winner === "you"
        ? `Your team won by ${pts(diff)} points (${pts(u.actual)} vs ${pts(o.actual)}).`
        : `The optimizer's team won by ${pts(-diff)} points (${pts(o.actual)} vs ${pts(u.actual)}).`;

  const why: string[] = [];
  why.push(
    `${shared.length} player${shared.length === 1 ? " was" : "s were"} in both teams, so the result came down to the ${11 - shared.length} different pick${11 - shared.length === 1 ? "" : "s"}: yours scored ${pts(sum(onlyYou))}, the optimizer's scored ${pts(sum(onlyOpt))} (base points).`,
  );
  if (capU) why.push(capU.text);
  if (capO) why.push(capO.text);
  why.push(
    `Prediction accuracy: the model predicted ${pts(u.predicted)} for your team (off by ${pts(uErr)}) and ${pts(o.predicted)} for its own team (off by ${pts(oErr)}).`,
  );

  return (
    <section className="mt-6 overflow-hidden rounded-3xl bg-ink text-white" aria-label="Demo verdict">
      <div className="p-6">
        <p className="text-xs uppercase tracking-widest text-white/60">Verdict</p>
        <h2 className="mt-1 font-display text-3xl">{headline}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { t: "Your team", s: u, win: winner === "you" },
            { t: "Optimizer team", s: o, win: winner === "optimizer" },
          ].map(({ t, s, win }) => (
            <div key={t} className={`rounded-2xl p-4 ${win ? "bg-pastel-green text-ink" : "bg-white/10"}`}>
              <p className="text-sm font-semibold">
                {t} {win && "· better"}
              </p>
              <p className="mt-1 font-display text-4xl">{pts(s.actual)}</p>
              <p className="text-xs opacity-80">
                Predicted {pts(s.predicted)} · error {s.error != null && s.error > 0 ? "+" : ""}
                {pts(s.error)}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 bg-white p-6 text-ink md:grid-cols-2">
        <div>
          <h3 className="font-semibold">Why</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {why.map((w) => (
              <li key={w} className="rounded-xl bg-cream px-3 py-2">
                {w}
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold">Picks that made the difference</h3>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-xs text-muted">Only in your team</p>
                <ul>{onlyYou.length ? onlyYou.slice(0, 4).map((p) => <li key={p.playerId}>{p.name} <span className="text-muted">{pts(p.actual)}</span></li>) : <li className="text-muted">Same XI as the optimizer</li>}</ul>
              </div>
              <div>
                <p className="text-xs text-muted">Only in optimizer team</p>
                <ul>{onlyOpt.length ? onlyOpt.slice(0, 4).map((p) => <li key={p.playerId}>{p.name} <span className="text-muted">{pts(p.actual)}</span></li>) : <li className="text-muted">Same XI as yours</li>}</ul>
              </div>
            </div>
          </div>
          <div>
            <h3 className="font-semibold">Biggest prediction misses</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {surprises.map((p) => (
                <li key={p.playerId}>
                  {p.name}: predicted {pts(p.predicted)}, scored {pts(p.actual)}{" "}
                  <span className={p.error > 0 ? "text-bad" : "text-good"}>({p.error > 0 ? "over" : "under"}-predicted by {pts(Math.abs(p.error))})</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted">These errors are stored and feed the Performance page, where repeated patterns turn into tested model adjustments.</p>
        </div>
      </div>
    </section>
  );
}
