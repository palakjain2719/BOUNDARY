/**
 * Server-side environment and integration status. Never import from client components.
 * Every integration reports connected / disconnected so the UI can show an honest state.
 */
export const env = {
  brandName: process.env.NEXT_PUBLIC_BRAND_NAME || "BOUNDARY",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "",
  cricketProvider: process.env.CRICKET_PROVIDER || "none",
  cricApiKey: process.env.CRICAPI_KEY || "",
  weatherProvider: process.env.WEATHER_PROVIDER || "open-meteo",
  notificationsLive: process.env.NOTIFICATIONS_LIVE === "true",
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.NOTIFICATION_EMAIL_FROM || "",
  twilioSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioFrom: process.env.TWILIO_FROM_NUMBER || "",
  cronSecret: process.env.CRON_SECRET || "",
  adminToken: process.env.ADMIN_TOKEN || "",
  localStorePath: process.env.LOCAL_STORE_PATH || "",
};

export const isSupabaseConfigured = () => !!(env.supabaseUrl && env.supabaseAnonKey && env.supabaseServiceRoleKey);
export const isGeminiConfigured = () => !!(env.geminiApiKey && env.geminiModel);
export const isDemoMode = () => !isSupabaseConfigured();

export interface IntegrationStatus {
  name: string;
  state: "connected" | "configured_unverified" | "disconnected" | "demo";
  detail: string;
  envVars: string[];
}

export function integrationStatuses(): IntegrationStatus[] {
  return [
    {
      name: "Supabase (storage + auth)",
      state: isSupabaseConfigured() ? "configured_unverified" : "demo",
      detail: isSupabaseConfigured()
        ? "Credentials present. Health check runs on the Settings page."
        : "Not configured. Using local demo store (single demo user, data on this server only).",
      envVars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    },
    {
      name: "Gemini (explanations)",
      state: isGeminiConfigured() ? "configured_unverified" : "disconnected",
      detail: isGeminiConfigured()
        ? `Model ${env.geminiModel}. Used only to phrase evidence; never to decide validity or scores.`
        : "Not configured. Explanations use a deterministic evidence template.",
      envVars: ["GEMINI_API_KEY", "GEMINI_MODEL"],
    },
    {
      name: "Cricket data provider",
      state: env.cricketProvider === "cricapi" && env.cricApiKey ? "configured_unverified" : "disconnected",
      detail:
        env.cricketProvider === "cricapi" && env.cricApiKey
          ? "CricAPI adapter enabled. Coverage depends on your plan; verify on Settings."
          : "No live provider. Live/upcoming fixtures come only from CSV import; history is Cricsheet replay.",
      envVars: ["CRICKET_PROVIDER", "CRICAPI_KEY"],
    },
    {
      name: "Weather (Open-Meteo)",
      state: env.weatherProvider === "open-meteo" ? "connected" : "disconnected",
      detail: "Keyless public API (open-meteo.com). Archive for past dates, forecast for upcoming. Venue coordinates are a curated table.",
      envVars: ["WEATHER_PROVIDER"],
    },
    {
      name: "Email / SMS reminders",
      state: env.notificationsLive && (env.resendApiKey || env.twilioSid) ? "configured_unverified" : "demo",
      detail:
        env.notificationsLive && (env.resendApiKey || env.twilioSid)
          ? `Live sending enabled via ${[env.resendApiKey && "Resend", env.twilioSid && "Twilio"].filter(Boolean).join(" + ")}.`
          : "Demo outbox: reminders are logged, never sent.",
      envVars: ["NOTIFICATIONS_LIVE", "RESEND_API_KEY", "NOTIFICATION_EMAIL_FROM", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
    },
  ];
}
