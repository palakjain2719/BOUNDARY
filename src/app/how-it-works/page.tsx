import Link from "next/link";
import type { Metadata } from "next";
import { LoopRibbon } from "@/components/LoopRibbon";

export const metadata: Metadata = { title: "How it works" };

const STEPS = [
  { t: "1 · Past: ingest & audit", d: "Cricsheet ball-by-ball (men's IPL 2008–2026, WPL 2023–2026) and the Kaggle Dream11 IPL labels (2008–2023) are validated, normalised and linked. Competitions stay separate. Super Overs are excluded from fantasy stats.", c: "bg-pastel-blue" },
  { t: "2 · Versioned scoring", d: "A deterministic calculator turns match events into fantasy points with a line-item audit. The legacy config reproduces 96.9% of Kaggle totals exactly; the modern config is an unverified draft. WPL points are labelled reconstructed_unverified.", c: "bg-pastel-yellow" },
  { t: "3 · Models, honestly benchmarked", d: "Pre-match features use only matches on earlier dates. Baseline, Ridge, Random Forest and gradient boosting are compared on a chronological split; the winner on validation is served. The signal is weak, and the app says so.", c: "bg-pastel-green" },
  { t: "4 · Background pipeline", d: "Without anyone logged in, the scheduler discovers fixtures, ranks them by data suitability, prepares predictions and an optimizer XI with captain/vice-captain, validates it deterministically, explains it, and freezes every version.", c: "bg-pastel-pink" },
  { t: "5 · Results & evaluation", d: "After a match the pipeline collects actual points (Dream11 labels where they exist, otherwise reconstructed and labelled), then measures error, ranking quality, interval coverage and captain accuracy against the frozen prediction.", c: "bg-pastel-lilac" },
  { t: "6 · Gated self-improvement", d: "Recurring errors with enough support produce candidate changes. Each is backtested on a later window and promoted only if release gates pass. Every activation can be rolled back.", c: "bg-pastel-orange" },
];

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
      <h1 className="font-display text-5xl">How it works</h1>
      <p className="mt-2 max-w-2xl text-muted">One connected, auditable loop: past data → present recommendation → actual result → tested improvement → future recommendation.</p>
      <ol className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.t} className={`rounded-3xl p-6 ${s.c}`}>
            <h2 className="font-display text-xl">{s.t}</h2>
            <p className="mt-2 text-sm leading-relaxed">{s.d}</p>
          </li>
        ))}
      </ol>
      <div className="card mt-8 p-6 text-sm">
        <h2 className="font-semibold">What this app will not do</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Scrape the Dream11 app, or claim coverage beyond the configured data sources.</li>
          <li>Invent pitch reports, injuries, lineups, credits or statistics. Missing data is shown as missing.</li>
          <li>Let an AI explanation decide whether a team is valid or how many points it scores.</li>
          <li>Rewrite a prediction after the result is known, or change the model because of a single match.</li>
        </ul>
      </div>
      <LoopRibbon className="mt-8" />
      <div className="mt-8 text-center">
        <Link href="/matches" className="btn btn-primary">
          Explore matches
        </Link>
      </div>
    </div>
  );
}
