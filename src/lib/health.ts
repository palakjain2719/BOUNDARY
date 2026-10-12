/**
 * Live integration checks. Each check is cheap and free: a metadata lookup or a tiny read, never a billed
 * generation or a message send. Results are cached for 5 minutes per server instance.
 */
import { createClient } from "@supabase/supabase-js";
import { env, geminiViaOpenRouter, isGeminiConfigured, isSupabaseConfigured, openRouterModel } from "./env";
import { USER_AGENT } from "./providers/free-sources";

export type CheckState = "working" | "failing" | "needs_setup" | "demo";

export interface IntegrationCheck {
  name: string;
  state: CheckState;
  detail: string;
  action: string | null;
  envVars: string[];
}

let cache: { at: number; checks: IntegrationCheck[] } | null = null;

async function timed<T>(fn: (signal: AbortSignal) => Promise<T>, ms = 6000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

async function checkSupabase(): Promise<IntegrationCheck> {
  const base = { name: "Supabase (storage + auth)", envVars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] };
  if (!isSupabaseConfigured()) {
    const missing = [!env.supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL", !env.supabaseAnonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY", !env.supabaseServiceRoleKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
    return { ...base, state: "needs_setup", detail: `Missing ${missing.join(", ")}. Using the local demo store (temporary, single demo user).`, action: "Add the missing key(s) in Vercel, run the migration SQL and expose the 'boundary' schema (docs/DEPLOYMENT.md)." };
  }
  try {
    const sb = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false }, db: { schema: env.supabaseSchema } });
    const { error, count } = await sb.from("rules_configs").select("id", { count: "exact", head: true });
    if (error) {
      const schemaHint = /schema/i.test(error.message) ? ` Add "${env.supabaseSchema}" to Exposed schemas (Project Settings → Data API).` : /does not exist|relation/i.test(error.message) ? " Run the migration SQL." : "";
      return { ...base, state: "failing", detail: `${error.message}.${schemaHint}`, action: schemaHint.trim() || "Check the keys and project URL." };
    }
    return { ...base, state: "working", detail: `Schema "${env.supabaseSchema}" reachable · ${count ?? 0} rules configs seeded.`, action: count ? null : "Reference data seeds automatically on the next pipeline tick." };
  } catch (e) {
    return { ...base, state: "failing", detail: e instanceof Error ? e.message : String(e), action: "Check NEXT_PUBLIC_SUPABASE_URL." };
  }
}

async function checkGemini(): Promise<IntegrationCheck> {
  const base = { name: "Gemini (explanations)", envVars: ["GEMINI_API_KEY", "GEMINI_MODEL"] };
  if (!isGeminiConfigured()) return { ...base, state: "needs_setup", detail: "Not configured. Explanations use the deterministic evidence template (works fine, zero cost).", action: "Optional: add GEMINI_API_KEY and GEMINI_MODEL." };
  if (geminiViaOpenRouter()) {
    try {
      // Key lookup: no generation, no tokens.
      const res = await timed((signal) => fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${env.geminiApiKey}` }, signal }));
      if (res.ok) return { ...base, state: "working", detail: `OpenRouter key accepted · model ${openRouterModel()}. Capped at ${process.env.GEMINI_MAX_EXPLANATIONS_PER_DAY ?? 100} explanations/day.`, action: null };
      return { ...base, state: "failing", detail: `OpenRouter returned HTTP ${res.status}.`, action: "Check GEMINI_API_KEY (OpenRouter key)." };
    } catch (e) {
      return { ...base, state: "failing", detail: e instanceof Error ? e.message : String(e), action: null };
    }
  }
  try {
    // Model metadata lookup: no generation, no tokens.
    const res = await timed((signal) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiModel)}`, { headers: { "x-goog-api-key": env.geminiApiKey }, signal }));
    if (res.ok) return { ...base, state: "working", detail: `Key accepted · model ${env.geminiModel} available. Capped at ${process.env.GEMINI_MAX_EXPLANATIONS_PER_DAY ?? 100} explanations/day.`, action: null };
    return { ...base, state: "failing", detail: `Google returned HTTP ${res.status} for model ${env.geminiModel}.`, action: res.status === 404 ? "Set GEMINI_MODEL to an available model." : "Check GEMINI_API_KEY." };
  } catch (e) {
    return { ...base, state: "failing", detail: e instanceof Error ? e.message : String(e), action: null };
  }
}

async function checkProvider(): Promise<IntegrationCheck> {
  const base = { name: "Cricket data provider", envVars: ["CRICKET_PROVIDER"] };
  if (env.cricketProvider === "free") {
    try {
      const [wiki, rss] = await Promise.all([
        timed((signal) => fetch("https://en.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json", { headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT }, signal })),
        timed((signal) => fetch("https://static.cricinfo.com/rss/livescores.xml", { headers: { "User-Agent": USER_AGENT }, signal })),
      ]);
      const ok = wiki.ok && rss.ok;
      return {
        ...base,
        state: ok ? "working" : "failing",
        detail: `Wikipedia API ${wiki.ok ? "reachable" : `HTTP ${wiki.status}`} · ESPNcricinfo live RSS ${rss.ok ? "reachable" : `HTTP ${rss.status}`}. Free, no keys. Fixtures appear as Wikipedia lists them (WPL 2027 from mid-January).`,
        action: ok ? null : "Temporary outage is fine — discovery retries on the next tick.",
      };
    } catch (e) {
      return { ...base, state: "failing", detail: e instanceof Error ? e.message : String(e), action: "Discovery retries on the next tick." };
    }
  }
  if (env.cricketProvider === "cricapi") return { ...base, state: env.cricApiKey ? "working" : "needs_setup", detail: env.cricApiKey ? "CricAPI key present (response mapping unverified)." : "CRICAPI_KEY missing.", action: null };
  if (env.cricketProvider === "google-search") return { ...base, state: isGeminiConfigured() ? "working" : "needs_setup", detail: "Gemini Google Search grounding (may be billed on paid projects; capped daily).", action: null };
  return { ...base, state: "demo", detail: "No live provider: simulated replay clock over the Cricsheet archive.", action: "Set CRICKET_PROVIDER=free for zero-cost live detection." };
}

async function checkWeather(): Promise<IntegrationCheck> {
  const base = { name: "Weather (Open-Meteo)", envVars: [] as string[] };
  try {
    const res = await timed((signal) => fetch("https://api.open-meteo.com/v1/forecast?latitude=18.94&longitude=72.83&hourly=temperature_2m&forecast_days=1", { signal }));
    return { ...base, state: res.ok ? "working" : "failing", detail: res.ok ? "Keyless public API reachable." : `HTTP ${res.status}`, action: null };
  } catch (e) {
    return { ...base, state: "failing", detail: e instanceof Error ? e.message : String(e), action: null };
  }
}

function checkNotifications(): IntegrationCheck {
  const base = { name: "Email / SMS reminders", envVars: ["NOTIFICATIONS_LIVE", "RESEND_API_KEY", "NOTIFICATION_EMAIL_FROM", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"] };
  const email = !!(env.resendApiKey && env.emailFrom);
  const sms = !!(env.twilioSid && env.twilioToken && env.twilioFrom);
  if (!email && !sms) return { ...base, state: "needs_setup", detail: "No email/SMS provider keys. Reminders go to the demo outbox (logged, never sent).", action: "Optional: add RESEND_API_KEY + NOTIFICATION_EMAIL_FROM (and/or Twilio) and NOTIFICATIONS_LIVE=true." };
  if (!env.notificationsLive) return { ...base, state: "demo", detail: `${[email && "Resend", sms && "Twilio"].filter(Boolean).join(" + ")} keys present but NOTIFICATIONS_LIVE is not true, so nothing is sent.`, action: "Set NOTIFICATIONS_LIVE=true to send." };
  return { ...base, state: "working", detail: `Live sending via ${[email && "Resend", sms && "Twilio"].filter(Boolean).join(" + ")} (keys present; first real send confirms delivery).`, action: null };
}

export async function runIntegrationChecks(force = false): Promise<IntegrationCheck[]> {
  if (!force && cache && Date.now() - cache.at < 5 * 60_000) return cache.checks;
  const checks = await Promise.all([checkSupabase(), checkGemini(), checkProvider(), checkWeather(), Promise.resolve(checkNotifications())]);
  cache = { at: Date.now(), checks };
  return checks;
}
