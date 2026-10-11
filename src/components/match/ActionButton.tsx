"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** POSTs JSON to an API route, shows the outcome, and refreshes server data on success. */
export function ActionButton({ url, body, label, busyLabel, className = "btn btn-primary", confirm }: { url: string; body?: unknown; label: string; busyLabel?: string; className?: string; confirm?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = Array.isArray(j.details) ? `: ${j.details.map((d: { line?: number; message?: string }) => (d.line ? `line ${d.line} ${d.message}` : d.message)).join("; ")}` : j.infeasible ? `: ${j.infeasible.reasons.join(" ")}` : "";
        setMsg(`${j.error ?? `Failed (HTTP ${res.status})`}${details}`);
      } else {
        setMsg("Done.");
        router.refresh();
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={className} onClick={run} disabled={busy}>
        {busy ? busyLabel ?? "Working…" : label}
      </button>
      {msg && (
        <span role="status" className={`text-xs ${msg === "Done." ? "text-good" : "text-bad"}`}>
          {msg}
        </span>
      )}
    </span>
  );
}
