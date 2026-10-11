export function formatMatchTime(item: { date: string; startTimeUtc: string | null; timezone?: string | null; startTimeAssumed?: boolean }) {
  const tz = item.timezone ?? "Asia/Kolkata";
  const label = tz === "Asia/Kolkata" ? "IST" : tz;
  if (item.startTimeUtc) {
    const d = new Date(item.startTimeUtc);
    const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: tz });
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    return `${day} · ${time} ${label}${item.startTimeAssumed ? " (assumed)" : ""}`;
  }
  return `${new Date(`${item.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · time not in source`;
}

export function formatClock(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`;
}

export function relativeTo(iso: string, now: Date) {
  const mins = Math.round((now.getTime() - Date.parse(iso)) / 60000);
  if (Math.abs(mins) < 1) return "just now";
  const fmt = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "s"}`;
  const abs = Math.abs(mins);
  const s = abs < 60 ? fmt(abs, "min") : abs < 48 * 60 ? fmt(Math.round(abs / 60), "hour") : fmt(Math.round(abs / 1440), "day");
  return mins >= 0 ? `${s} ago` : `in ${s}`;
}

export const pts = (n: number | null | undefined, d = 1) => (n == null || Number.isNaN(n) ? "—" : n.toFixed(d));
