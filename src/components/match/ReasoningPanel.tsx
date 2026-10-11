import type { OptimizerRecommendation, SnapshotPrediction } from "@/lib/store/types";
import { IconAlert, IconCheck, IconShield, IconSpark, IconX } from "../icons";
import { PlayerButton } from "../player/PlayerModal";

const LEVEL = {
  well_supported: { label: "Well supported", cls: "bg-pastel-green" },
  preliminary: { label: "Preliminary", cls: "bg-pastel-yellow" },
  unavailable: { label: "Unavailable", cls: "bg-pastel-pink" },
} as const;

export function ValidationBadge({ rec }: { rec: Pick<OptimizerRecommendation, "validation"> }) {
  const v = rec.validation;
  return (
    <span className={`chip ${v.valid ? (v.fullyVerifiable ? "bg-pastel-green" : "bg-pastel-yellow") : "bg-pastel-pink"}`} title={[...v.violations.map((x) => x.message), ...v.warnings].join("\n")}>
      {v.valid ? <IconCheck size={14} /> : <IconX size={14} />} {v.label}
    </span>
  );
}

export function ReasoningPanel({ rec, predictions, matchId }: { rec: OptimizerRecommendation; predictions: SnapshotPrediction[]; matchId: string }) {
  const byId = new Map(predictions.map((p) => [p.playerId, p]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  const P = ({ id }: { id: string }) => (
    <PlayerButton playerId={id} matchId={matchId} className="font-semibold underline decoration-dotted underline-offset-2 hover:decoration-solid">
      {name(id)}
    </PlayerButton>
  );
  return (
    <div className="space-y-4">
      <section className="card p-4" aria-labelledby="why">
        <div className="flex items-center justify-between gap-2">
          <h2 id="why" className="flex items-center gap-2 font-semibold">
            <IconSpark /> Reasoning
          </h2>
          <span className="chip bg-cream" title={rec.explanationSource === "gemini" ? "Written by Gemini from the evidence below" : "Deterministic template from the evidence below"}>
            {rec.explanationSource === "gemini" ? "Gemini Flash" : "Evidence template"}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed">{rec.explanationText}</p>
        <p className="mt-2 text-[11px] text-muted">Explanations never decide validity or scores; those come from the deterministic validator and scorer.</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <div className="rounded-2xl bg-pastel-green p-4">
          <p className="flex items-center justify-between text-sm font-semibold">
            Captain <span className="chip bg-white">2×</span>
          </p>
          <p className="mt-1 font-display text-lg"><P id={rec.captainId} /></p>
          <p className="mt-1 text-xs leading-relaxed">{rec.captainReason}</p>
        </div>
        <div className="rounded-2xl bg-pastel-blue p-4">
          <p className="flex items-center justify-between text-sm font-semibold">
            Vice-captain <span className="chip bg-white">1.5×</span>
          </p>
          <p className="mt-1 font-display text-lg"><P id={rec.viceCaptainId} /></p>
          <p className="mt-1 text-xs leading-relaxed">{rec.viceCaptainReason}</p>
        </div>
      </section>

      <details className="card p-4" open>
        <summary className="cursor-pointer font-semibold">Why these picks</summary>
        <ul className="mt-2 space-y-2 text-xs">
          {rec.picks.map((p) => (
            <li key={p.playerId}>
              <P id={p.playerId} />
              <span className="text-muted"> — {p.reasons.join(" ")}</span>
            </li>
          ))}
        </ul>
      </details>

      <details className="card p-4">
        <summary className="cursor-pointer font-semibold">Left out and why</summary>
        <ul className="mt-2 space-y-2 text-xs">
          {rec.avoid.map((a) => (
            <li key={a.playerId}>
              <P id={a.playerId} /> <span className="text-muted">— {a.reason}</span>
            </li>
          ))}
        </ul>
      </details>

      <details className="card p-4">
        <summary className="cursor-pointer font-semibold">Alternatives (feasible swaps)</summary>
        <p className="mt-1 text-[11px] text-muted">Dream11 has no submitted bench for this contest type, so these are alternatives, not an official bench.</p>
        <ul className="mt-2 space-y-1 text-xs">
          {rec.alternatives.slice(0, 6).map((a) => (
            <li key={`${a.outId}-${a.inId}`}>
              {name(a.inId)} for {name(a.outId)}: <strong>{a.valueDelta > 0 ? "+" : ""}{a.valueDelta}</strong> risk-adjusted pts
            </li>
          ))}
        </ul>
      </details>

      <section className="card p-4">
        <h3 className="flex items-center gap-2 font-semibold">
          <IconAlert /> Risks
        </h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {rec.risks.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      {rec.evidenceQuality?.length > 0 && (
        <section className="card p-4">
          <h3 className="flex items-center gap-2 font-semibold">
            <IconShield /> Evidence quality
          </h3>
          <ul className="mt-2 space-y-2 text-xs">
            {rec.evidenceQuality.map((e) => (
              <li key={e.topic} className="flex items-start gap-2">
                <span className={`chip shrink-0 ${LEVEL[e.level].cls}`}>{LEVEL[e.level].label}</span>
                <span>
                  <strong>{e.topic}.</strong> {e.basis}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
