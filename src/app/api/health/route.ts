import { NextResponse } from "next/server";
import { loadManifest } from "@/lib/data/historical";
import { runIntegrationChecks } from "@/lib/health";
import { clockMode } from "@/lib/pipeline/clock";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.has("refresh");
  const checks = await runIntegrationChecks(force);
  const manifest = loadManifest();
  return NextResponse.json({
    ok: !!manifest && !checks.some((c) => c.state === "failing"),
    clock: clockMode(),
    processedData: manifest ? { generatedAt: manifest.generatedAt, competitions: manifest.competitions } : null,
    integrations: checks,
  });
}
