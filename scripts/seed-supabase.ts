/**
 * Seed Supabase reference tables (service role). Idempotent; existing rows are kept.
 * The pipeline also runs this automatically on its first tick against Supabase.
 * Usage: NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run db:seed
 */
import { createClient } from "@supabase/supabase-js";
import { seedReferenceData } from "../src/lib/store/seed";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side only) to seed.");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false }, db: { schema: process.env.SUPABASE_DB_SCHEMA || "boundary" } });
seedReferenceData(sb)
  .then((r) => console.log("Seed complete:", r))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
