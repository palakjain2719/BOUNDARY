import Link from "next/link";
import { StadiumScene } from "@/components/StadiumScene";
import { IconArrow, IconPlay } from "@/components/icons";
import { LoopRibbon } from "@/components/LoopRibbon";
import { loadManifest } from "@/lib/data/historical";
import { loadBenchmark } from "@/lib/models/registry";

const nf = new Intl.NumberFormat("en-IN");
const yr = (d?: string) => d?.slice(0, 4) ?? "—";

export default function Home() {
  const m = loadManifest();
  const bench = loadBenchmark();
  const ridge = bench?.results["Ridge regression"]?.test;
  const mean = bench?.results["Train mean baseline"]?.test;
  const stats = m
    ? [
        { label: "Men's IPL", value: nf.format(m.competitions.IPL.matches), sub: `matches, ${yr(m.competitions.IPL.dateRange?.from)}–${yr(m.competitions.IPL.dateRange?.to)} · Cricsheet` },
        { label: "Dream11 labels", value: nf.format(m.kaggleIplLabels.labelledMatches), sub: `men's IPL matches, ${m.kaggleIplLabels.seasons?.from}–${m.kaggleIplLabels.seasons?.to} · Kaggle` },
        { label: "Women's WPL", value: nf.format(m.competitions.WPL.matches), sub: `matches, ${yr(m.competitions.WPL.dateRange?.from)}–${yr(m.competitions.WPL.dateRange?.to)} · Cricsheet` },
        { label: "Players", value: nf.format(m.competitions.IPL.players + m.competitions.WPL.players), sub: "performance profiles (IPL + WPL)" },
      ]
    : [];

  return (
    <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
      <section className="relative overflow-hidden rounded-[2rem] border border-line" aria-labelledby="hero-title">
        <StadiumScene
          uid="hero"
          sky={["#8fd3f4", "#d6f0f7"]}
          field="#79b552"
          stand="#355e3b"
          sun="#fff6cf"
          ball
          ballPosition={[880, 150, 118]}
          className="absolute inset-0 hidden h-full w-full md:block"
          title="Illustration of an open cricket ground with a cricket ball high in the sky"
        />
        {/* Phone variant: the sliced viewBox crops the sides, so the ball sits nearer the centre. */}
        <StadiumScene
          uid="hero-sm"
          sky={["#8fd3f4", "#d6f0f7"]}
          field="#79b552"
          stand="#355e3b"
          sun="#fff6cf"
          ball
          ballPosition={[720, 66, 46]}
          className="absolute inset-0 h-full w-full md:hidden"
          title="Illustration of an open cricket ground with a cricket ball high in the sky"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-cream/95 via-cream/70 to-transparent md:via-cream/40" aria-hidden />
        <div className="relative grid min-h-[620px] content-between gap-10 p-6 sm:p-10 md:min-h-[640px]">
          <div className="max-w-xl pt-24 md:pt-6">
            <h1 id="hero-title" className="font-display text-[3.2rem] leading-[0.92] sm:text-7xl md:text-[5.6rem]">
              Find your{" "}
              <span className="relative inline-block whitespace-nowrap">
                winning XI<span className="text-ball">.</span>
                <svg className="absolute -bottom-2 left-0 h-3 w-full" viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden>
                  <path d="M2 8 Q150 1 298 7" stroke="var(--color-ball)" strokeWidth="5" fill="none" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="mt-6 max-w-md text-lg leading-snug">
              Every match has a story. Know the players, the conditions, the call — then see how your pick compares with an independent optimizer after the match.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/matches" className="btn btn-primary px-6 py-3 text-base">
                Explore matches <IconArrow />
              </Link>
              <Link href="/how-it-works" className="btn btn-ghost bg-paper/70 px-6 py-3 text-base">
                <IconPlay /> See how it works
              </Link>
            </div>
          </div>
          <p className="pointer-events-none absolute right-8 top-1/2 hidden -rotate-12 font-[family-name:var(--font-hand)] text-4xl leading-tight text-ink/85 lg:block" aria-hidden>
            Same game.
            <br />
            new insights.
          </p>
          {m ? (
            <dl className="grid max-w-3xl grid-cols-2 gap-x-6 gap-y-4 rounded-2xl bg-paper/85 p-4 backdrop-blur sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="border-l border-line pl-3 first:border-0 first:pl-0">
                  <dt className="text-xs text-muted">{s.label}</dt>
                  <dd className="font-display text-2xl">{s.value}</dd>
                  <dd className="text-[11px] leading-tight text-muted">{s.sub}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="rounded-2xl bg-paper/85 p-4 text-sm">Historical data has not been processed yet. Run <code>npm run data:build</code>.</p>
          )}
        </div>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-3" aria-label="What you can do">
        {[
          { t: "Choose your match", d: "Browse live, upcoming and completed matches. An advisory score shows which are best covered by data.", c: "bg-pastel-green" },
          { t: "Build two XIs", d: "Pick your own team with live rule checks, then compare it with an independent optimizer team and its reasoning.", c: "bg-pastel-yellow" },
          { t: "Learn from the result", d: "Enter actual points, see predicted vs actual for both teams, and review tested model changes before they go live.", c: "bg-pastel-pink" },
        ].map((x) => (
          <div key={x.t} className={`rounded-3xl ${x.c} p-6`}>
            <h2 className="font-display text-2xl">{x.t}</h2>
            <p className="mt-2 text-sm leading-relaxed">{x.d}</p>
          </div>
        ))}
      </section>

      <section className="mt-10 card p-6" aria-labelledby="honesty">
        <h2 id="honesty" className="font-display text-2xl">
          How good are the projections?
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed">
          Honestly: modest. On held-out 2022–23 men&apos;s IPL matches the active Ridge model&apos;s mean absolute error is{" "}
          <strong>{ridge?.mae ?? "—"} points</strong> versus <strong>{mean?.mae ?? "—"}</strong> for always predicting the training average (R² {ridge?.r2 ?? "—"}). Projections come with ranges, the
          optimizer explains its trade-offs, and WPL points are labelled <em>reconstructed_unverified</em> until real WPL fantasy scores are available.
        </p>
        <Link href="/learning" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold underline">
          See the full benchmark <IconArrow size={16} />
        </Link>
      </section>

      <LoopRibbon className="mt-10" />
    </div>
  );
}
