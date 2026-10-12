"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DecisionPhase, PlayerRole, PoolPlayer } from "@/lib/data/types";
import { teamAbbr } from "@/lib/data/normalize";
import type { TeamRules } from "@/lib/optimizer/rules";
import { validateTeam } from "@/lib/optimizer/validate";
import type { SnapshotPrediction } from "@/lib/store/types";
import { FieldView } from "./FieldView";
import { PlayerButton } from "../player/PlayerModal";

interface Props {
  matchId: string;
  phase: DecisionPhase;
  pool: PoolPlayer[];
  predictions: SnapshotPrediction[];
  teamRules: TeamRules;
  multipliers: { captain: number; viceCaptain: number };
  initial: { playerIds: string[]; captainId: string | null; viceCaptainId: string | null } | null;
  locked: boolean;
  team1: string;
}

const ROLES: PlayerRole[] = ["WK", "BAT", "AR", "BOWL"];

export function TeamBuilder(p: Props) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>(p.initial?.playerIds ?? []);
  const [cap, setCap] = useState<string | null>(p.initial?.captainId ?? null);
  const [vc, setVc] = useState<string | null>(p.initial?.viceCaptainId ?? null);
  const draftKey = `boundary-draft:${p.matchId}`;
  const lastSaved = useRef(p.initial ? JSON.stringify([[...p.initial.playerIds].sort(), p.initial.captainId, p.initial.viceCaptainId]) : "");
  const restored = useRef(false);
  // Restore an unsaved draft from this browser (only when no newer saved team exists).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) ?? "null") as { ids: string[]; cap: string | null; vc: string | null } | null;
      const valid = new Set(p.pool.map((x) => x.playerId));
      if (d && !p.initial && d.ids.every((id) => valid.has(id))) {
        setIds(d.ids);
        setCap(d.cap);
        setVc(d.vc);
      }
    } catch {
      /* storage unavailable: start empty */
    }
  }, [draftKey, p.initial, p.pool]);
  const [role, setRole] = useState<PlayerRole | "ALL">("ALL");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const byId = useMemo(() => new Map(p.predictions.map((x) => [x.playerId, x])), [p.predictions]);
  const full = ids.length === p.teamRules.squadSize;
  const v = validateTeam({ playerIds: ids, captainId: cap, viceCaptainId: vc }, p.pool, p.teamRules, { partial: !full });
  const projected = ids.reduce((s, id) => s + (byId.get(id)?.mean ?? 0) * (id === cap ? p.multipliers.captain : id === vc ? p.multipliers.viceCaptain : 1), 0);
  const credits = ids.reduce((s, id) => s + (p.pool.find((x) => x.playerId === id)?.credits ?? 0), 0);
  const list = p.predictions.filter((x) => role === "ALL" || x.role === role).sort((a, b) => b.mean - a.mean);

  const toggle = (id: string) => {
    setStatus(null);
    if (ids.includes(id)) {
      setIds(ids.filter((x) => x !== id));
      if (cap === id) setCap(null);
      if (vc === id) setVc(null);
    } else if (ids.length < p.teamRules.squadSize) setIds([...ids, id]);
    else setStatus({ kind: "err", msg: `Team already has ${p.teamRules.squadSize} players. Remove one first.` });
  };
  const setLeader = (id: string, which: "c" | "vc") => {
    setStatus(null);
    if (which === "c") {
      setCap(id);
      if (vc === id) setVc(null);
    } else {
      setVc(id);
      if (cap === id) setCap(null);
    }
  };
  const save = async (auto = false) => {
    setSaving(true);
    setStatus(null);
    const res = await fetch(`/api/matches/${p.matchId}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase: p.phase, teamRulesId: p.teamRules.id, playerIds: ids, captainId: cap, viceCaptainId: vc }),
    });
    const j = await res.json();
    setSaving(false);
    if (res.ok) {
      lastSaved.current = JSON.stringify([[...ids].sort(), cap, vc]);
      setStatus({ kind: "ok", msg: `${auto ? "Auto-saved" : "Saved"} at ${new Date(j.team.createdAt).toLocaleTimeString()}. Projected ${j.team.predictedTotal} pts.` });
      router.refresh();
    } else setStatus({ kind: "err", msg: j.details?.violations?.map((x: { message: string }) => x.message).join("; ") || j.error });
  };
  const hard = v.violations.filter((x) => !(x.code === "credits_unknown" && p.pool.every((pl) => pl.credits == null)));
  // Everything still blocking a valid team, in plain words.
  const issues: string[] = [];
  if (!full) {
    const need = p.teamRules.squadSize - ids.length;
    issues.push(`Pick ${need} more player${need === 1 ? "" : "s"}`);
    for (const r of ROLES) {
      const short = p.teamRules.roleLimits[r][0] - v.roleCounts[r];
      if (short > 0) issues.push(`Need at least ${short} more ${r === "WK" ? "wicket-keeper" : r === "BAT" ? "batter" : r === "AR" ? "all-rounder" : "bowler"}${short === 1 ? "" : "s"}`);
    }
    if (!cap) issues.push("Choose a captain (2×)");
    if (!vc) issues.push("Choose a vice-captain (1.5×)");
  }
  const over = Math.round((credits - p.teamRules.creditCap) * 10) / 10;
  for (const x of hard) {
    if (x.code === "credit_cap") issues.push(`Too expensive: your team costs ${credits.toFixed(1)} credits but the limit is ${p.teamRules.creditCap}. Remove ${over} credits by swapping a pricier player for a cheaper one.`);
    else if (x.code === "team_max") issues.push(`${x.message}. Swap one of them for a player from the other side.`);
    else if (x.code === "role_max") issues.push(`${x.message}. Swap one for another role.`);
    else issues.push(x.message);
  }
  // Credit fix: greedy same-role swaps (fewest projected points lost per credit saved) until under the cap.
  const swaps: { out: string; inn: string; loss: number; save: number }[] = [];
  if (over > 0) {
    const team = [...ids];
    let left = over;
    for (let k = 0; k < 8 && left > 1e-9; k++) {
      let best: (typeof swaps)[number] | null = null;
      for (const sid of team) {
        const sp = p.pool.find((x) => x.playerId === sid);
        if (!sp || sp.credits == null || swaps.some((w) => w.inn === sid)) continue;
        for (const c of p.pool) {
          if (team.includes(c.playerId) || c.role !== sp.role || c.credits == null || c.credits >= sp.credits) continue;
          if (c.team !== sp.team && team.filter((id) => p.pool.find((x) => x.playerId === id)?.team === c.team).length >= p.teamRules.maxPerRealTeam) continue;
          const save = sp.credits - c.credits;
          const loss = (byId.get(sid)?.mean ?? 0) - (byId.get(c.playerId)?.mean ?? 0);
          const score = Math.max(loss, 0) / Math.min(save, left);
          if (!best || score < Math.max(best.loss, 0) / Math.min(best.save, left)) best = { out: sid, inn: c.playerId, loss, save };
        }
      }
      if (!best) break;
      swaps.push(best);
      team[team.indexOf(best.out)] = best.inn;
      left -= best.save;
    }
    if (left > 1e-9) swaps.length = 0; // no complete fix found
  }
  const applySwaps = (list: typeof swaps) => {
    setStatus(null);
    let next = [...ids];
    let c = cap;
    let v2 = vc;
    for (const w of list) {
      next = next.map((x) => (x === w.out ? w.inn : x));
      if (c === w.out) c = w.inn;
      if (v2 === w.out) v2 = w.inn;
    }
    setIds(next);
    setCap(c);
    setVc(v2);
  };
  const ready = full && hard.length === 0 && !!cap && !!vc;

  // Auto-save: keep the draft in this browser, and save to the server once the team is valid.
  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ ids, cap, vc }));
    } catch {
      /* ignore */
    }
  }, [draftKey, ids, cap, vc]);
  useEffect(() => {
    if (!ready || p.locked) return;
    const sig = JSON.stringify([[...ids].sort(), cap, vc]);
    if (sig === lastSaved.current) return;
    const t = setTimeout(() => {
      lastSaved.current = sig;
      void save(true);
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ids, cap, vc, p.locked]);

  return (
    <div className="space-y-4">
      <div className="card grid gap-4 p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted">Players</p>
          <p className="font-display text-2xl">
            {ids.length}/{p.teamRules.squadSize}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Credits {p.pool.some((x) => x.creditSource === "estimated_demo") && "(demo estimates)"}</p>
          <p className="font-display text-2xl">
            {credits.toFixed(1)}/{p.teamRules.creditCap}
          </p>
          <div className="mt-1 h-2 rounded-full bg-line" aria-hidden>
            <div className={`h-2 rounded-full ${credits > p.teamRules.creditCap ? "bg-bad" : "bg-olive"}`} style={{ width: `${Math.min(100, (credits / p.teamRules.creditCap) * 100)}%` }} />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted">Projected (with C/VC)</p>
          <p className="font-display text-2xl">{projected.toFixed(1)}</p>
        </div>
        <div className="flex flex-col items-start gap-2">
          <a href="#team-issues" className={`chip ${ready ? "bg-pastel-green" : "bg-pastel-yellow"}`} aria-live="polite">
            {ready ? v.label : `${issues.length} to fix ↓`}
          </a>
          <button type="button" className="btn btn-primary" disabled={p.locked || !ready || saving} onClick={() => save()}>
            {saving ? "Saving…" : p.locked ? "Predictions frozen" : status?.kind === "ok" ? "Saved ✓" : "Save my team"}
          </button>
          {!p.locked && <span className="text-[11px] text-muted">Auto-saves when the team is complete</span>}
        </div>
      </div>
      {(issues.length > 0 || status) && (
        <div id="team-issues" className="card p-3 text-sm" role="status">
          {status && <p className={status.kind === "ok" ? "text-good" : "text-bad"}>{status.msg}</p>}
          {issues.length > 0 && (
            <>
              <p className="text-xs font-semibold">Still to do</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {issues.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              {swaps.length > 0 && (
                <div className="mt-2 rounded-xl bg-pastel-blue/60 p-3">
                  <p className="text-xs font-semibold">
                    Quick fix: {swaps.length} swap{swaps.length === 1 ? "" : "s"} gets you to {(credits - swaps.reduce((t, w) => t + w.save, 0)).toFixed(1)} credits, costing{" "}
                    {swaps.reduce((t, w) => t + w.loss, 0).toFixed(1)} projected pts
                  </p>
                  <ul className="mt-1 text-xs">
                    {swaps.map((w) => (
                      <li key={w.out}>
                        {byId.get(w.out)?.name} → {byId.get(w.inn)?.name} (saves {w.save.toFixed(1)} cr)
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn btn-primary mt-2" onClick={() => applySwaps(swaps)}>
                    Apply {swaps.length === 1 ? "swap" : `all ${swaps.length} swaps`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <FieldView players={ids.map((id) => byId.get(id)!).filter(Boolean)} captainId={cap} viceCaptainId={vc} limits={p.teamRules.roleLimits} matchId={p.matchId} team1={p.team1} onRemove={p.locked ? undefined : toggle} />
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter by role">
          {(["ALL", ...ROLES] as const).map((r) => (
            <button key={r} role="tab" aria-selected={role === r} type="button" onClick={() => setRole(r)} className={`chip ${role === r ? "bg-ink text-white" : "bg-cream"}`}>
              {r === "ALL" ? "All" : r} {r !== "ALL" && `(${v.roleCounts[r]})`}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted">{p.teamRules.name} · {p.teamRules.status}</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Player pool</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2">Player</th>
                <th>Team</th>
                <th>Role</th>
                <th className="text-right">Credits</th>
                <th className="text-right">Projected</th>
                <th className="text-right">80% range</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => {
                const on = ids.includes(x.playerId);
                return (
                  <tr key={x.playerId} className={`border-t border-line ${on ? "bg-pastel-green/40" : ""}`}>
                    <td className="py-2 font-medium">
                      <PlayerButton playerId={x.playerId} matchId={p.matchId} className="hover:underline">
                        {x.name}
                      </PlayerButton>{" "}
                      {x.sampleSize < 5 && <span className="chip bg-pastel-yellow">thin history</span>}
                    </td>
                    <td>{teamAbbr(x.team)}</td>
                    <td title={x.roleReason}>{x.role}</td>
                    <td className="text-right">{x.credits ?? "—"}</td>
                    <td className="text-right font-semibold">{x.mean.toFixed(1)}</td>
                    <td className="text-right text-muted">
                      {x.p10.toFixed(0)}–{x.p90.toFixed(0)}
                    </td>
                    <td className="whitespace-nowrap py-1 text-right">
                      <button type="button" disabled={p.locked} onClick={() => toggle(x.playerId)} className={`chip ${on ? "bg-pastel-pink" : "bg-ink text-white"}`} aria-label={`${on ? "Remove" : "Add"} ${x.name}`}>
                        {on ? "Remove" : "Add"}
                      </button>{" "}
                      {on && (
                        <>
                          <button type="button" disabled={p.locked} onClick={() => setLeader(x.playerId, "c")} aria-pressed={cap === x.playerId} className={`chip ${cap === x.playerId ? "bg-ink text-white" : "bg-cream"}`} aria-label={`Make ${x.name} captain`}>
                            C
                          </button>{" "}
                          <button type="button" disabled={p.locked} onClick={() => setLeader(x.playerId, "vc")} aria-pressed={vc === x.playerId} className={`chip ${vc === x.playerId ? "bg-pastel-yellow" : "bg-cream"}`} aria-label={`Make ${x.name} vice-captain`}>
                            VC
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
