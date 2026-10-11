import fs from "node:fs";
import path from "node:path";
import { env, isSupabaseConfigured } from "../env";
import { LocalRepository } from "./local";
import { SupabaseRepository } from "./supabase";
import type { Repository } from "./types";

let local: LocalRepository | null = null;

/** Path for the demo store. On Vercel the filesystem is read-only except /tmp, which is ephemeral. */
export function localStorePath() {
  if (env.localStorePath) return env.localStorePath;
  if (process.env.VERCEL) return "/tmp/boundary-demo-store.json";
  return path.join(process.cwd(), ".data", "demo-store.json");
}

export function getRepository(accessToken: string | null = null): Repository {
  if (isSupabaseConfigured()) return new SupabaseRepository(accessToken);
  if (!local) {
    const file = localStorePath();
    seedDemoStore(file);
    local = new LocalRepository(file);
  }
  return local;
}

/**
 * Demo deployments (no Supabase) start each serverless instance from the bundled, pre-simulated demo state
 * (data/demo/seed-store.json) instead of an empty store. Writes stay local to the instance and are ephemeral.
 */
function seedDemoStore(file: string) {
  if (fs.existsSync(file)) return;
  const seed = path.join(process.cwd(), "data", "demo", "seed-store.json");
  if (!process.env.VERCEL || !fs.existsSync(seed)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(seed, file);
}

export function resetLocalRepositoryForTests(repo: LocalRepository | null) {
  local = repo;
}
