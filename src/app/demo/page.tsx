import Link from "next/link";
import type { Metadata } from "next";
import { TeamMark } from "@/components/TeamMark";
import { getViewer } from "@/lib/auth";
import { loadCompetition } from "@/lib/data/historical";
import type { Competition } from "@/lib/data/types";
import { teamAbbr } from "@/lib/data/normalize";
import { getRepository } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demo", description: "Pretend a 2026 match is live: pick your XI, enter the real Dream11 points, compare with the optimizer." };

/** Matches the model never saw: it was trained before the 2026 season. */
const DEMO_MATCHES: { id: string; competition: Competition; label: string }[] = [
  { id: "1535465", competition: "IPL", label: "IPL 2026 Final" },
  { id: "1535464", competition: "IPL", label: "IPL 2026 Qualifier 2" },
  { id: "1535463", competition: "IPL", label: "IPL 2026 Eliminator" },
  { id: "1513703", competition: "WPL", label: "WPL 2026 Final" },
];

const STEPS = [
  { n: 1, t: "Pick a match", d: "Treated as live: you see the playing XIs after the toss and the model's predictions, nothing from the match itself." },
  { n: 2, t: "Build your XI", d: "Choose 11 players, a captain (2×) and vice-captain (1.5×). The app checks the Dream11 rules and shows your predicted score." },
  { n: 3, t: "Compare with the optimizer", d: "The optimizer's own best XI and C/VC, with its predicted score and reasons." },
  { n: 4, t: "Type the Dream11 points", d: "Enter each player's real points from the Dream11 app, like Aryan would after the match. Saved to Supabase." },
  { n: 5, t: "See the verdict", d: "Which team scored more, whether the captain choices paid off, which picks made the difference and how far off the predictions were." },
];

export default async function DemoPage() {
  const user = await getViewer();
  const repo = getRepository(user.accessToken);
  const byComp = { IPL: loadCompetition("IPL"), WPL: loadCompetition("WPL") };
  const cards = await Promise.all(
    DEMO_MATCHES.map(async (d) => {
      const m = byComp[d.competition].matches.find((x) => x.id === d.id);
      if (!m) return null;
      const [teams, actuals] = user.guest ? [[], []] : await Promise.all([repo.listUserTeams(user.id, d.id), repo.listActuals(user.id, d.id)]);
      return { ...d, m, hasTeam: teams.length > 0, hasActuals: actuals.length > 0 };
    }),
  );

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 pb-12 sm:px-6">
      <header className="rounded-3xl bg-pastel-yellow p-6 sm:p-8">
        <p className="chip bg-white">Demo · match day walkthrough</p>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">Pretend it&apos;s match day</h1>
        <p className="mt-2 max-w-3xl">
          Pick a 2026 match the model has never seen (its training data ends before the 2026 season, and each prediction uses only earlier matches). Build your team, compare it with the optimizer, then type in the real Dream11 points and see which team was better and why.
        </p>
      </header>

      <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((s) => (
          <li key={s.n} className="card p-4">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-ink font-semibold text-white">{s.n}</span>
            <h2 className="mt-2 font-semibold">{s.t}</h2>
            <p className="mt-1 text-sm text-muted">{s.d}</p>
          </li>
        ))}
      </ol>

      <h2 className="mt-8 font-display text-2xl">Choose a match</h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {cards.map((c) =>
          c ? (
            <article key={c.id} className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">{c.label}</p>
              <div className="mt-3 flex items-center gap-3">
                <TeamMark team={c.m.team1} size={44} />
                <span className="font-display text-2xl">
                  {teamAbbr(c.m.team1)} <span className="text-muted">vs</span> {teamAbbr(c.m.team2)}
                </span>
                <TeamMark team={c.m.team2} size={44} />
              </div>
              <p className="mt-2 text-sm text-muted">
                {new Date(`${c.m.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · {c.m.venue}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link className="btn btn-primary" href={`/matches/${c.id}?view=mine&phase=post_toss&demo=1`}>
                  {c.hasTeam ? "✓ Edit your XI" : "1 · Build your XI"}
                </Link>
                <Link className="btn" href={`/matches/${c.id}?phase=post_toss&demo=1`}>
                  Optimizer XI
                </Link>
                <Link className={`btn ${c.hasTeam ? "btn-primary" : ""}`} href={`/matches/${c.id}/review?demo=1`}>
                  {c.hasActuals ? "✓ Verdict" : "2 · Enter Dream11 points"}
                </Link>
              </div>
            </article>
          ) : null,
        )}
      </div>
      <p className="mt-6 text-xs text-muted">
        Your team and points are saved privately for this browser; no sign-up. Entering points again replaces the earlier entry (the history is kept). The app also calculates points from ball-by-ball data with the official
        Dream11 T20 rules, so you can see if your typed totals differ.
      </p>
    </div>
  );
}
