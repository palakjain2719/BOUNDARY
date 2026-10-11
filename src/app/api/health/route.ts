import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { env, integrationStatuses, isSupabaseConfigured } from "@/lib/env";
import { loadManifest } from "@/lib/data/historical";

export async function GET() {
  let supabase: { ok: boolean; detail: string } | null = null;
  if (isSupabaseConfigured()) {
    const sb = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false } });
    const { error } = await sb.from("rules_configs").select("id", { count: "exact", head: true });
    supabase = error ? { ok: false, detail: error.message } : { ok: true, detail: "Query on rules_configs succeeded" };
  }
  const manifest = loadManifest();
  return NextResponse.json({
    ok: !!manifest,
    processedData: manifest ? { generatedAt: manifest.generatedAt, competitions: manifest.competitions } : null,
    supabase,
    integrations: integrationStatuses(),
  });
}
