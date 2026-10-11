"use client";
import { useMemo, useState } from "react";
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
    if (which === "c") {
      setCap(id);
      if (vc === id) setVc(null);
    } else {
      setVc(id);
      if (cap === id) setCap(null);
    }
  };
  const save = async () => {
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
      setStatus({ kind: "ok", msg: `Saved as an immutable version at ${new Date(j.team.createdAt).toLocaleTimeString()}. Projected ${j.team.predictedTotal} pts.` });
      router.refresh();
    } else setStatus({ kind: "err", msg: j.details?.violations?.map((x: { message: string }) => x.message).join("; ") || j.error });
  };
  const hard = v.violations.filter((x) => !(x.code === "credits_unknown" && p.pool.every((pl) => pl.credits == null)));

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
          <span className={`chip ${full && hard.length === 0 ? "bg-pastel-green" : "bg-pastel-yellow"}`} aria-live="polite">
            {full && hard.length === 0 ? v.label : `${hard.length || (full ? 0 : 1)} issue(s)`}
          </span>
          <button type="button" className="btn btn-primary" disabled={p.locked || !full || hard.length > 0 || saving} onClick={save}>
            {saving ? "Saving…" : p.locked ? "Predictions frozen" : "Save my team"}
          </button>
        </div>
      </div>
      {(hard.length > 0 || status) && (
        <div className="card p-3 text-sm" role="alert">
          {status && <p className={status.kind === "ok" ? "text-good" : "text-bad"}>{status.msg}</p>}
          {hard.length > 0 && (
            <ul className="list-disc pl-5 text-xs">
              {hard.map((x) => (
                <li key={x.code + x.message}>{x.message}</li>
              ))}
            </ul>
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
