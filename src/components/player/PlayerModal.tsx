"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { teamAbbr } from "@/lib/data/normalize";
import { ROLE_LABEL } from "@/lib/data/types";
import type { PlayerProfile } from "@/lib/players/profile";
import type { SnapshotPrediction } from "@/lib/store/types";
import { teamColors } from "../TeamMark";
import { CricketerFigure } from "./CricketerFigure";

interface Ctx {
  open: (playerId: string, opener?: HTMLElement | null) => void;
}
const PlayerModalCtx = createContext<Ctx | null>(null);

/** Wrap a match view so any PlayerButton inside opens the status pop-up for that player. */
export function PlayerModalProvider({
  matchId,
  predictions,
  captainId,
  viceCaptainId,
  children,
}: {
  matchId: string;
  predictions: SnapshotPrediction[];
  captainId?: string | null;
  viceCaptainId?: string | null;
  children: React.ReactNode;
}) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const open = useCallback((id: string, opener?: HTMLElement | null) => {
    openerRef.current = opener ?? (document.activeElement as HTMLElement | null);
    setPlayerId(id);
  }, []);
  const close = useCallback(() => {
    setPlayerId(null);
    openerRef.current?.focus();
  }, []);
  const pred = predictions.find((p) => p.playerId === playerId) ?? null;
  return (
    <PlayerModalCtx.Provider value={{ open }}>
      {children}
      {playerId && pred && <PlayerStatusModal matchId={matchId} pred={pred} leader={playerId === captainId ? "C" : playerId === viceCaptainId ? "VC" : null} onClose={close} />}
    </PlayerModalCtx.Provider>
  );
}

/** A player name that opens the pop-up (falls back to the player page outside a provider). */
export function PlayerButton({ playerId, matchId, className, children }: { playerId: string; matchId: string; className?: string; children: React.ReactNode }) {
  const ctx = useContext(PlayerModalCtx);
  if (!ctx) {
    return (
      <Link href={`/matches/${matchId}/players/${encodeURIComponent(playerId)}`} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={`text-left ${className ?? ""}`} onClick={(e) => ctx.open(playerId, e.currentTarget)} aria-haspopup="dialog">
      {children}
    </button>
  );
}

function Row({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] border-b border-[#2b5ccf]/40 last:border-0">
      <dt className="py-2.5 pl-4 pr-2 text-[13px] font-bold uppercase tracking-[0.08em] text-white sm:text-sm">{label}:</dt>
      <dd className={`border-l border-[#2b5ccf]/60 py-2.5 pl-4 font-display text-base tracking-wide sm:text-lg ${accent ? "text-[#ffd27a]" : "text-[#e8eeff]"}`}>{value}</dd>
    </div>
  );
}

function Ball({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="11" fill="#f4f6fb" />
      <path d="M7 2.5c3 3 3 16 0 19M17 2.5c-3 3-3 16 0 19" stroke="#c43a2a" strokeWidth="1.3" fill="none" />
    </svg>
  );
}

function PlayerStatusModal({ matchId, pred, leader, onClose }: { matchId: string; pred: SnapshotPrediction; leader: "C" | "VC" | null; onClose: () => void }) {
  const [profile, setProfile] = useState<PlayerProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [primary, secondary] = teamColors(pred.team);

  useEffect(() => {
    let live = true;
    setProfile(undefined);
    fetch(`/api/players/${encodeURIComponent(pred.playerId)}?matchId=${encodeURIComponent(matchId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => live && setProfile(j.profile))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [matchId, pred.playerId]);

  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && dialogRef.current) {
        const f = dialogRef.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const b = profile?.batting;
  const w = profile?.bowling;
  const showBowling = (w?.innings ?? 0) > 0 && (pred.role === "BOWL" || pred.role === "AR" || (w?.wickets ?? 0) > 5);
  const showBatting = pred.role !== "BOWL" || (b?.runs ?? 0) > 200;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-[#06121f]/80 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-status-title"
        className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] p-[3px] shadow-[0_0_40px_rgba(59,130,246,0.45)]"
        style={{ background: "linear-gradient(140deg, #5aa2ff, #1d3f9a 35%, #0b1b4a 65%, #3f7dff)" }}
      >
        <div className="relative overflow-hidden rounded-[25px]" style={{ background: "radial-gradient(120% 80% at 50% 0%, #1e6f86 0%, #0f3a5c 45%, #08152f 100%)" }}>
          {/* stadium lights + crowd texture */}
          <div className="pointer-events-none absolute inset-0 opacity-30" aria-hidden style={{ backgroundImage: "radial-gradient(circle at 15% 12%, #fff 0 2px, transparent 3px), radial-gradient(circle at 85% 10%, #fff 0 2px, transparent 3px), repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 9px)" }} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#1d5c2d]/60 to-transparent" aria-hidden />

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-2xl bg-white/85 text-ink hover:bg-white"
            aria-label="Close player status"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>

          {/* header bar */}
          <div className="relative mx-4 mt-14 sm:mx-8 sm:mt-10">
            <div className="relative flex items-center justify-center gap-3 rounded-2xl border border-[#3f7dff]/70 px-4 py-3" style={{ background: "linear-gradient(90deg, #0b1f5c, #c2410c 50%, #0b1f5c)" }}>
              <span className="h-0.5 flex-1 bg-gradient-to-r from-transparent to-white/80" aria-hidden />
              <Ball className="h-8 w-8 shrink-0 drop-shadow" />
              <h2 id="player-status-title" className="shrink-0 font-display text-2xl uppercase tracking-[0.12em] text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.5)] sm:text-3xl">
                Player Status
              </h2>
              <Ball className="h-8 w-8 shrink-0 drop-shadow" />
              <span className="h-0.5 flex-1 bg-gradient-to-l from-transparent to-white/80" aria-hidden />
            </div>
          </div>

          <div className="relative grid gap-2 px-4 pb-6 pt-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:px-8">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-white">
                <p className="font-display text-2xl leading-tight sm:text-3xl">{pred.name}</p>
                {leader && <span className="chip bg-[#ffd27a] text-ink">{leader === "C" ? "Captain (2×)" : "Vice-captain (1.5×)"}</span>}
                <p className="w-full text-sm text-[#b9cbff]">
                  {pred.team} · {ROLE_LABEL[pred.role]} · {pred.credits != null ? `${pred.credits} cr` : "credits n/a"}
                </p>
              </div>

              <dl className="overflow-hidden rounded-2xl border border-[#2b5ccf]/70 bg-[#0a1c4d]/80 shadow-inner">
                <Row label="Projected pts" value={`${pred.mean.toFixed(1)}  (${pred.p10.toFixed(0)}–${pred.p90.toFixed(0)})`} accent />
                {profile === undefined && !error && (
                  <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading career stats">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-6 animate-pulse rounded bg-white/10" />
                    ))}
                  </div>
                )}
                {error && <p className="p-4 text-sm text-[#ffb4a8]">Couldn&apos;t load stats ({error}).</p>}
                {profile === null && <p className="p-4 text-sm text-[#e8eeff]">No earlier matches in this competition — no career stats yet.</p>}
                {profile && (
                  <>
                    <Row label="Matches" value={profile.matches} />
                    {showBatting && b && (
                      <>
                        <Row label="Total runs" value={b.runs.toLocaleString()} />
                        <Row label="Total balls" value={b.balls.toLocaleString()} />
                        <Row label="Strike rate" value={b.strikeRate ?? "—"} />
                        <Row label="Six hit" value={b.sixes} />
                        <Row label="Four hit" value={b.fours} />
                        <Row label="High score" value={`${b.highScore} · ${b.fifties}× 50+`} />
                        <Row label="Total out" value={b.dismissals} />
                      </>
                    )}
                    {showBowling && w && (
                      <>
                        <Row label="Wickets" value={`${w.wickets}${w.best ? ` · best ${w.best}` : ""}`} />
                        <Row label="Dot ball" value={w.dotBalls.toLocaleString()} />
                        <Row label="Economy" value={w.economy ?? "—"} />
                      </>
                    )}
                    <Row label="Catches" value={profile.fielding.catches + (profile.fielding.stumpings ? ` · ${profile.fielding.stumpings} st` : "")} />
                    <Row label="Avg fantasy pts" value={profile.fantasy.average ?? "—"} accent />
                  </>
                )}
              </dl>

              {profile && profile.fantasy.last5.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#b9cbff]">Last {profile.fantasy.last5.length} matches (fantasy pts)</p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {profile.fantasy.last5.map((m) => (
                      <li key={m.date + m.opponent} className="rounded-xl bg-white/10 px-2.5 py-1 text-xs text-white" title={`${m.date} vs ${m.opponent}`}>
                        <span className="font-display">{Math.round(m.points)}</span> <span className="text-[#b9cbff]">v {teamAbbr(m.opponent)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-3 text-[11px] text-[#9fb4e6]">
                {profile ? `${profile.competition} career before ${profile.beforeDate}` : "Career stats"} · Cricsheet ball-by-ball (Super Overs excluded). Fantasy points use the versioned scoring rules.
              </p>
              <Link href={`/matches/${matchId}/players/${encodeURIComponent(pred.playerId)}`} className="mt-3 inline-flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-[#e8eeff]">
                Full profile &amp; reasoning →
              </Link>
            </div>
            <div className="pointer-events-none hidden sm:block">
              <div className="sticky top-6 flex justify-center pt-16">
                <CricketerFigure role={pred.role} primary={primary} secondary={secondary} className="h-[380px] w-auto drop-shadow-[0_0_18px_rgba(90,162,255,0.6)]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
