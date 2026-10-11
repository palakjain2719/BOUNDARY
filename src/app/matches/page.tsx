import Link from "next/link";
import type { Metadata } from "next";
import { MatchCard } from "@/components/MatchCard";
import { ClockBanner } from "@/components/ClockBanner";
import { IconSearch } from "@/components/icons";
import { getSessionUser } from "@/lib/auth";
import type { Competition, MatchStatus } from "@/lib/data/types";
import { listCatalog } from "@/lib/match/catalog";
import { getClock } from "@/lib/pipeline/clock";
import { getRepository } from "@/lib/store";
import { themesForList } from "@/lib/themes/match-themes";

export const metadata: Metadata = { title: "Choose your match" };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | undefined>>;
const TABS: { key: MatchStatus; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
];

export default async function MatchesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await getSessionUser();
  const repo = getRepository(user?.accessToken ?? null);
  const clock = await getClock(repo);
  const competition = (sp.competition ?? "all") as Competition | "all";
  const probe = await listCatalog(repo, { tab: "upcoming", competition, q: sp.q }, clock);
  const tab = (sp.tab as MatchStatus) ?? (probe.counts.live ? "live" : probe.counts.upcoming ? "upcoming" : "completed");
  const page = Number(sp.page ?? 1);
  const res = await listCatalog(repo, { tab, q: sp.q, competition, season: sp.season, page, sort: sp.sort === "date" ? "date" : "suitability" }, clock);
  const themes = themesForList(res.items.map((i) => i.id));
  const qs = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, q: sp.q, competition: competition === "all" ? undefined : competition, season: sp.season, sort: sp.sort, ...o })) if (v != null && v !== "") p.set(k, String(v));
    return `/matches?${p.toString()}`;
  };
  const pages = Math.ceil(res.total / res.pageSize);
  const seasonOptions = competition === "all" ? [...new Set([...res.seasons.IPL, ...res.seasons.WPL])].sort().reverse() : res.seasons[competition];

  return (
    <>
      <ClockBanner />
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl sm:text-5xl">
              Choose your match <span className="text-ball" aria-hidden>⟋</span>
            </h1>
            <p className="mt-2 max-w-2xl text-muted">
              Upcoming matches are discovered and analysed in the background. Open one to see the prepared research, the optimizer&apos;s XI and its reasoning.
            </p>
          </div>
        </header>

        <form className="mt-6 flex flex-wrap items-center gap-3" action="/matches" role="search">
          <input type="hidden" name="tab" value={tab} />
          <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5">
            <IconSearch className="text-muted" />
            <span className="sr-only">Search teams, venue or season</span>
            <input name="q" defaultValue={sp.q} placeholder="Search teams, venue or season…" className="w-full bg-transparent text-sm outline-none" />
          </label>
          <label className="sr-only" htmlFor="competition">Competition</label>
          <select id="competition" name="competition" defaultValue={competition} className="rounded-full border border-line bg-paper px-4 py-2.5 text-sm">
            <option value="all">All competitions</option>
            <option value="IPL">Men&apos;s IPL</option>
            <option value="WPL">Women&apos;s WPL</option>
          </select>
          <label className="sr-only" htmlFor="season">Season</label>
          <select id="season" name="season" defaultValue={sp.season ?? ""} className="rounded-full border border-line bg-paper px-4 py-2.5 text-sm">
            <option value="">All seasons</option>
            {seasonOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit">Apply</button>
          <nav aria-label="Match status" className="ml-auto flex rounded-full border border-line bg-paper p-1">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={qs({ tab: t.key, page: undefined, season: t.key === "completed" ? sp.season : undefined })}
                aria-current={tab === t.key ? "page" : undefined}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === t.key ? "bg-ink text-white" : "text-ink hover:bg-white"}`}
              >
                {t.label} <span className="opacity-70">{t.key === "completed" ? "" : res.counts[t.key]}</span>
              </Link>
            ))}
          </nav>
        </form>

        {tab === "upcoming" && res.items.length > 0 && (
          <p className="mt-4 text-sm text-muted">
            Sorted by <strong>advisory suitability</strong> — how well the data supports analysing a match (coverage, lineup certainty, label support, prediction spread, valid lineup). It is not a prediction of which match scores most.{" "}
            <Link className="underline" href={qs({ sort: sp.sort === "date" ? undefined : "date" })}>
              {sp.sort === "date" ? "Sort by suitability" : "Sort by start time"}
            </Link>
          </p>
        )}

        {res.items.length === 0 ? (
          <div className="card mt-8 p-8 text-center">
            <h2 className="font-display text-2xl">No {tab} matches</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
              {tab === "completed"
                ? "Nothing matches these filters."
                : clock.simulated
                  ? "The simulated clock has no fixtures in this state right now. Advance the clock or run the pipeline from Settings."
                  : "No live provider fixtures in this state. Configure a provider or import fixtures as CSV in Settings."}
            </p>
            <Link href="/settings#pipeline" className="btn btn-ghost mt-4">Open pipeline settings</Link>
          </div>
        ) : (
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {res.items.map((item, i) => (
              <li key={item.id} className="flex">
                <div className="flex w-full flex-col [&>article]:flex-1">
                  <MatchCard item={item} theme={themes[i]} rankPosition={tab === "upcoming" && sp.sort !== "date" && page === 1 && i < 3 && item.analysis ? i + 1 : undefined} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-2 text-sm">
            {page > 1 && <Link className="btn btn-soft" href={qs({ page: page - 1 })}>Previous</Link>}
            <span className="px-3">Page {page} of {pages} · {res.total} matches</span>
            {page < pages && <Link className="btn btn-soft" href={qs({ page: page + 1 })}>Next</Link>}
          </nav>
        )}
      </div>
    </>
  );
}
