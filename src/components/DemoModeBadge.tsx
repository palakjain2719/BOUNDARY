"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/** "Demo mode" chip that opens a short explanation of what is simulated and what is missing. */
export function DemoModeBadge({ items }: { items: { name: string; state: string; detail: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="demo-mode-panel"
        className="chip whitespace-nowrap bg-pastel-yellow px-3 py-1.5 text-ink hover:brightness-95"
      >
        <span className="h-2 w-2 rounded-full bg-warn" aria-hidden /> Demo mode
      </button>
      {open && (
        <div id="demo-mode-panel" role="dialog" aria-label="About demo mode" className="absolute right-0 top-11 z-50 w-[min(92vw,360px)] rounded-2xl border border-line bg-paper p-4 text-sm shadow-xl">
          <p className="font-semibold">You&apos;re in demo mode</p>
          <p className="mt-1 text-muted">Everything works, but some integrations aren&apos;t connected, so data is replayed or stored locally.</p>
          <ul className="mt-3 space-y-2">
            {items.map((i) => (
              <li key={i.name} className="flex items-start gap-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.state === "connected" ? "bg-good" : i.state === "configured_unverified" ? "bg-warn" : "bg-bad"}`} aria-hidden />
                <span>
                  <span className="font-medium">{i.name}</span>
                  <span className="block text-xs text-muted">{i.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/settings#integrations" onClick={() => setOpen(false)} className="btn btn-primary px-3 py-1.5 text-xs">
              Connect integrations
            </Link>
            <Link href="/settings#pipeline" onClick={() => setOpen(false)} className="btn btn-soft px-3 py-1.5 text-xs">
              Pipeline &amp; clock
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
