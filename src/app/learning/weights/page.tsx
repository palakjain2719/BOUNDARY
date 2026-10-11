import Link from "next/link";
import type { Metadata } from "next";
import { WeightsEditor } from "@/components/learning/WeightsEditor";
import { IconBack } from "@/components/icons";
import { getViewer } from "@/lib/auth";
import type { Competition } from "@/lib/data/types";
import { getWeightsOverview } from "@/lib/learning/weights";
import { getRepository } from "@/lib/store";

export const metadata: Metadata = { title: "Model weights" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function WeightsPage({ searchParams }: { searchParams: Promise<{ competition?: string }> }) {
  const sp = await searchParams;
  const competition = (sp.competition === "WPL" ? "WPL" : "IPL") as Competition;
  const user = await getViewer();
  const overview = await getWeightsOverview(getRepository(user.accessToken), competition, user.id);
  const r = overview.recommended;
  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
      <Link href="/learning" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <IconBack size={16} /> Performance
      </Link>
      <h1 className="mt-2 font-display text-4xl">Model weights</h1>
      <p className="mt-1 max-w-3xl text-muted">
        Review the criteria the weighted-criteria model blends, the system&apos;s fitted weights and the evidence behind them, and try your own. These are prediction-model weights — fantasy scoring rules are a separate, versioned configuration and are not editable here.
      </p>
      <nav className="mt-4 flex gap-2" aria-label="Competition">
        {(["IPL", "WPL"] as const).map((c) => (
          <Link key={c} href={`/learning/weights?competition=${c}`} aria-current={c === competition ? "page" : undefined} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${c === competition ? "bg-ink text-white" : "border border-line bg-paper"}`}>
            {c === "IPL" ? "Men's IPL" : "Women's WPL"}
          </Link>
        ))}
      </nav>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-pastel-green p-4">
          <p className="text-xs">System weights fitted on</p>
          <p className="font-semibold">{overview.windows.fit.name}</p>
        </div>
        <div className="rounded-2xl bg-pastel-blue p-4">
          <p className="text-xs">Compared on {overview.windows.calibrate.name}</p>
          <p className="font-semibold">
            Weighted MAE {r.evaluation?.mae} vs active {overview.activeModel.id} {r.evaluation?.baselineMae}
          </p>
        </div>
        <div className="rounded-2xl bg-pastel-yellow p-4">
          <p className="text-xs">Release gate window</p>
          <p className="font-semibold">{overview.windows.evaluate.name}</p>
        </div>
      </div>
      {competition === "WPL" && <p className="mt-3 text-sm text-warn">WPL labels are reconstructed_unverified — these comparisons are research-grade until real WPL fantasy scores are available.</p>}
      <div className="mt-6">
        <WeightsEditor overview={overview} canSave={!user.guest} />
      </div>
    </div>
  );
}
