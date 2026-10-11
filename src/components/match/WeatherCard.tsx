"use client";
import { useEffect, useState } from "react";
import type { WeatherSummary } from "@/lib/providers/weather";

export function WeatherCard({ matchId }: { matchId: string }) {
  const [w, setW] = useState<WeatherSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/matches/${matchId}/weather`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => live && setW(j))
      .catch((e) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [matchId]);
  if (err) return <span>Unavailable ({err}).</span>;
  if (!w) return <span aria-busy="true">Loading…</span>;
  if (w.state !== "ok") return <span>{w.note}</span>;
  return (
    <span>
      {w.temperatureC}°C · humidity {w.humidityPct}% · dew point {w.dewPointC}°C · rain {w.precipitationMm} mm · wind {w.windKmh} km/h ({w.window}).
      <br />
      <span className="text-xs">{w.kind === "observed_archive" ? "Observed archive (context only, not a model input)." : "Forecast."} Source: Open-Meteo.</span>
    </span>
  );
}
