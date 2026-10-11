/**
 * Session resolution. Demo mode: a single local demo user. Supabase mode: the user's access token is read
 * from the Authorization header or the `sb-access-token` cookie and verified with Supabase Auth.
 */
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env, isSupabaseConfigured } from "./env";

export const DEMO_USER_ID = "demo-aryan";

export interface SessionUser {
  id: string;
  displayName: string;
  demo: boolean;
  accessToken: string | null;
  isAdmin: boolean;
}

export async function getSessionUser(req?: Request): Promise<SessionUser | null> {
  if (!isSupabaseConfigured()) return { id: DEMO_USER_ID, displayName: "Aryan (demo)", demo: true, accessToken: null, isAdmin: true };
  let token: string | null = null;
  const h = req?.headers.get("authorization");
  if (h?.startsWith("Bearer ")) token = h.slice(7);
  if (!token) {
    try {
      token = (await cookies()).get("sb-access-token")?.value ?? null;
    } catch {
      token = null;
    }
  }
  if (!token) return null;
  const sb = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  const admins = (process.env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { id: data.user.id, displayName: data.user.email ?? "Signed in", demo: false, accessToken: token, isAdmin: admins.includes(data.user.id) };
}
