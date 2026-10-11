"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Row {
  playerId: string;
  name: string;
  current: number | null;
}

/** Manual entry of actual Dream11 points for the union of both lineups (each player once). */
export function ActualsForm({ matchId, rows, canLoad }: { matchId: string; rows: Row[]; canLoad: { reconstructed: boolean; kaggle: boolean } }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.playerId, r.current == null ? "" : String(r.current)])));
  const [incl, setIncl] = useState<"no" | "yes" | "">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const post = async (body: unknown) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/matches/${matchId}/actuals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Saved. History is append-only; the latest entry per player is used." });
      router.refresh();
    } else setMsg({ ok: false, text: j.error ?? `HTTP ${res.status}` });
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!incl) return setMsg({ ok: false, text: "Say whether the values include captain / vice-captain multipliers." });
    const entries = rows.filter((r) => values[r.playerId] !== "").map((r) => ({ playerId: r.playerId, points: Number(values[r.playerId]) }));
    if (entries.some((x) => !Number.isFinite(x.points))) return setMsg({ ok: false, text: "Every value must be a number." });
    post({ mode: "manual", includesMultiplier: incl === "yes", entries });
  };
  return (
    <form onSubmit={submit} className="card p-4">
      <h2 className="font-semibold">Enter actual Dream11 points</h2>
      <p className="mt-1 text-xs text-muted">One row per player across both lineups. Base points are preferred; multipliers are applied once by the scorer.</p>
      <fieldset className="mt-3 text-sm">
        <legend className="font-medium">Do these values already include the C (2×) / VC (1.5×) multiplier?</legend>
        <label className="mr-4 inline-flex items-center gap-1">
          <input type="radio" name="incl" checked={incl === "no"} onChange={() => setIncl("no")} /> No — base player points
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="radio" name="incl" checked={incl === "yes"} onChange={() => setIncl("yes")} /> Yes — as shown for my C/VC
        </label>
      </fieldset>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <label key={r.playerId} className="flex items-center justify-between gap-2 rounded-xl bg-cream px-3 py-1.5 text-sm">
            <span className="truncate">{r.name}</span>
            <input
              inputMode="decimal"
              className="w-20 rounded-lg border border-line bg-white px-2 py-1 text-right"
              value={values[r.playerId]}
              onChange={(e) => setValues({ ...values, [r.playerId]: e.target.value })}
              aria-label={`Actual points for ${r.name}`}
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy}>
          Save my entries
        </button>
        {canLoad.reconstructed && (
          <button type="button" className="btn btn-soft" disabled={busy} onClick={() => post({ mode: "reconstructed" })}>
            Use reconstructed points
          </button>
        )}
        {canLoad.kaggle && (
          <button type="button" className="btn btn-soft" disabled={busy} onClick={() => post({ mode: "kaggle_label" })}>
            Use Kaggle Dream11 labels
          </button>
        )}
      </div>
      {msg && (
        <p role="status" className={`mt-2 text-sm ${msg.ok ? "text-good" : "text-bad"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
