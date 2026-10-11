"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { WeightsOverview } from "@/lib/learning/weights";

export function WeightsEditor({ overview, canSave = true }: { overview: WeightsOverview; canSave?: boolean }) {
  const router = useRouter();
  const rec = overview.recommended.weights;
  const lastCandidate = overview.candidates[overview.candidates.length - 1];
  const [w, setW] = useState<Record<string, number>>(lastCandidate?.weights ?? rec);
  const [name, setName] = useState("My weights");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const pct = (v: number) => `${Math.round((v / sum) * 100)}%`;
  const ev = useMemo(() => new Map(overview.evidence.map((e) => [e.key, e])), [overview.evidence]);

  const call = async (body: unknown) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/weights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: j.error ?? `HTTP ${res.status}` });
    router.refresh();
    return j;
  };

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[860px] text-sm">
          <caption className="mb-2 text-left text-xs text-muted">
            Weights are normalised to 100%. Evidence is from {overview.windows.fit.name} ({overview.windows.fit.labelSource.replace(/_/g, " ")}). Missing criteria are dropped per player and the rest renormalised.
          </caption>
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2">Criterion</th>
              <th>Definition</th>
              <th className="text-right">Available</th>
              <th className="text-right">Corr. with points</th>
              <th className="text-right">Alone: MAE</th>
              <th className="text-right">System</th>
              <th className="w-56">Your candidate</th>
            </tr>
          </thead>
          <tbody>
            {overview.criteria.map((c) => {
              const e = ev.get(c.key)!;
              return (
                <tr key={c.key} className="border-t border-line align-top">
                  <td className="py-2 font-medium">{c.label}</td>
                  <td className="max-w-[260px] pr-3 text-xs text-muted">{c.definition}</td>
                  <td className="text-right text-xs">
                    {e.availableRows.toLocaleString()} / {e.totalRows.toLocaleString()}
                  </td>
                  <td className="text-right">{e.correlation ?? "—"}</td>
                  <td className="text-right">{e.soloMae ?? "—"}</td>
                  <td className="text-right font-semibold">{Math.round((rec[c.key] ?? 0) * 100)}%</td>
                  <td>
                    <label className="flex items-center gap-2">
                      <span className="sr-only">{c.label} weight</span>
                      <input type="range" min={0} max={1} step={0.01} value={w[c.key] ?? 0} onChange={(ev2) => setW({ ...w, [c.key]: Number(ev2.target.value) })} className="w-36 accent-[#151512]" />
                      <span className="w-10 text-right text-xs">{pct(w[c.key] ?? 0)}</span>
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Name <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-full border border-line bg-paper px-3 py-1.5" />
        </label>
        {!canSave && (
          <span className="text-sm">
            <a className="font-semibold underline" href="/login">
              Sign in
            </a>{" "}
            to save and backtest your own weights.
          </span>
        )}
        <button className="btn btn-primary" disabled={busy || !canSave} onClick={() => call({ action: "save", competition: overview.competition, weights: w, name }).then((j) => j && setMsg({ ok: true, text: `Saved candidate. Backtest MAE on ${j.evaluation.window}: ${j.evaluation.mae} (active model ${j.evaluation.baselineMae}).` }))}>
          Save & backtest candidate
        </button>
        <button className="btn btn-soft" disabled={busy} onClick={() => setW(rec)}>
          Reset to recommended
        </button>
      </div>
      {msg && (
        <p role="status" className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>
          {msg.text}
        </p>
      )}

      <div className="card p-4">
        <h2 className="font-semibold">Your candidate profiles</h2>
        {overview.candidates.length === 0 ? (
          <p className="mt-1 text-sm text-muted">None yet. Candidates never replace the active model; submitting one runs the release-gate backtest.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {[...overview.candidates].reverse().map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium">{c.name}</span>
                <span className="chip bg-cream">{c.status}</span>
                <span className="text-xs text-muted">
                  {c.evaluation ? `${c.evaluation.window}: MAE ${c.evaluation.mae} vs active ${c.evaluation.baselineMae} (n=${c.evaluation.n})` : ""}
                </span>
                {c.status === "candidate" && (
                  <button className="btn btn-soft ml-auto" disabled={busy} onClick={() => call({ action: "submit", profileId: c.id }).then((j) => j && setMsg({ ok: j.proposal.evaluation?.passes, text: `Release-gate backtest: ${j.proposal.evaluation?.criteria.join(" · ")}` }))}>
                    Submit for evaluation
                  </button>
                )}
                {c.proposalId && <a className="ml-auto text-xs underline" href={`/learning#p-${c.proposalId}`}>View proposal</a>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
