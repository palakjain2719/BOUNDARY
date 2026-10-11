/**
 * Open-Meteo weather adapter (keyless public API, https://open-meteo.com). Uses the archive API for past
 * dates and the forecast API for upcoming dates. Venue coordinates come from a curated table; unknown
 * venues return an explicit "no coordinates" state rather than a guess.
 */
import { venueKey } from "../data/normalize";

const VENUES: Record<string, [number, number]> = {
  "wankhede stadium": [18.9389, 72.8258],
  "brabourne stadium": [18.9322, 72.8247],
  "dy patil stadium": [19.0414, 73.027],
  "m chinnaswamy stadium": [12.9788, 77.5996],
  "eden gardens": [22.5646, 88.3433],
  "ma chidambaram stadium": [13.0628, 80.2793],
  "arun jaitley stadium": [28.6379, 77.2432],
  "narendra modi stadium": [23.0919, 72.5975],
  "rajiv gandhi intl stadium": [17.4065, 78.5505],
  "sawai mansingh stadium": [26.894, 75.803],
  "punjab cricket association stadium": [30.6908, 76.7376],
  "ekana stadium": [26.811, 80.9474],
  "mca stadium pune": [18.6745, 73.7065],
  "himachal pradesh cricket association stadium": [32.1975, 76.3257],
  "dubai international cricket stadium": [25.0469, 55.2186],
  "sheikh zayed stadium": [24.3965, 54.6135],
  "zayed cricket stadium": [24.3965, 54.6135],
  "sharjah cricket stadium": [25.3317, 55.4206],
};

export function venueCoordinates(venue: string): [number, number] | null {
  return VENUES[venueKey(venue)] ?? null;
}

export interface WeatherSummary {
  state: "ok" | "no_coordinates" | "unavailable" | "out_of_range";
  kind: "observed_archive" | "forecast" | null;
  venueKey: string;
  date: string;
  window: string;
  temperatureC?: number;
  humidityPct?: number;
  dewPointC?: number;
  precipitationMm?: number;
  windKmh?: number;
  source: string;
  note: string;
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : undefined);

/**
 * `clock` is the pipeline clock. Under a simulated clock, a match the clock has not yet passed gets no
 * weather: the archive would reveal post-decision observations and no historical forecast is stored.
 */
export async function matchWeather(venue: string, date: string, now = new Date(), fetchImpl: typeof fetch = fetch, clock?: { now: Date; simulated: boolean }): Promise<WeatherSummary> {
  const key = venueKey(venue);
  const base = { venueKey: key, date, window: "18:00–22:00 local", source: "Open-Meteo" };
  if (clock?.simulated && date >= clock.now.toISOString().slice(0, 10)) {
    return { ...base, state: "unavailable", kind: null, note: "Not shown under the simulated clock: only observed (post-match) weather exists for this date, which would leak information the decision could not have had." };
  }
  const coords = venueCoordinates(venue);
  if (!coords) return { ...base, state: "no_coordinates", kind: null, note: "Venue has no coordinates in the curated table." };
  const today = now.toISOString().slice(0, 10);
  const daysAhead = (Date.parse(date) - Date.parse(today)) / 86400000;
  if (daysAhead > 15) return { ...base, state: "out_of_range", kind: null, note: "Forecast available within 16 days of the match." };
  const isPast = date < today;
  const host = isPast ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
  const u = new URL(host);
  u.searchParams.set("latitude", String(coords[0]));
  u.searchParams.set("longitude", String(coords[1]));
  u.searchParams.set("start_date", date);
  u.searchParams.set("end_date", date);
  u.searchParams.set("hourly", "temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,wind_speed_10m");
  u.searchParams.set("timezone", "auto");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetchImpl(u, { signal: ctrl.signal, next: { revalidate: isPast ? 86400 : 1800 } } as RequestInit);
    clearTimeout(t);
    if (!res.ok) return { ...base, state: "unavailable", kind: null, note: `Open-Meteo HTTP ${res.status}` };
    const j = (await res.json()) as { hourly?: Record<string, (number | null)[]> & { time: string[] } };
    const h = j.hourly;
    if (!h) return { ...base, state: "unavailable", kind: null, note: "No hourly data returned" };
    const idx = h.time.map((t, i) => [Number(t.slice(11, 13)), i] as const).filter(([hr]) => hr >= 18 && hr <= 22).map(([, i]) => i);
    const pick = (k: string) => idx.map((i) => h[k]?.[i]).filter((x): x is number => typeof x === "number");
    return {
      ...base,
      state: "ok",
      kind: isPast ? "observed_archive" : "forecast",
      temperatureC: avg(pick("temperature_2m")),
      humidityPct: avg(pick("relative_humidity_2m")),
      dewPointC: avg(pick("dew_point_2m")),
      precipitationMm: Math.round(pick("precipitation").reduce((a, b) => a + b, 0) * 10) / 10,
      windKmh: avg(pick("wind_speed_10m")),
      note: isPast
        ? "Observed (reanalysis archive) weather for the match evening — context only, never a model feature. A live match would show a forecast."
        : "Forecast for the match evening.",
    };
  } catch (e) {
    return { ...base, state: "unavailable", kind: null, note: e instanceof Error ? e.message : "Weather request failed" };
  }
}
