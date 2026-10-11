"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImportForm({ kind, header, example }: { kind: "fixtures" | "pool"; header: string; example: string }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, csv }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg({ ok: true, text: `Imported ${j.imported} row(s). The pipeline will prepare upcoming fixtures on its next tick.` });
      setCsv("");
      router.refresh();
    } else setMsg({ ok: false, text: `${j.error}${Array.isArray(j.details) ? ": " + j.details.map((d: { line: number; message: string }) => `line ${d.line} ${d.message}`).join("; ") : ""}` });
  };
  const onFile = async (f: File | undefined) => f && setCsv(await f.text());
  return (
    <form onSubmit={submit} className="space-y-2">
      <p className="text-xs text-muted">
        Header: <code className="rounded bg-cream px-1">{header}</code>
      </p>
      <label className="block text-sm">
        <span className="sr-only">{kind} CSV</span>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={4} placeholder={example} className="w-full rounded-2xl border border-line bg-white p-3 font-mono text-xs" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn btn-soft cursor-pointer">
          Choose file
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <button className="btn btn-primary" disabled={!csv.trim()}>
          Import {kind}
        </button>
      </div>
      {msg && (
        <p role="status" className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
