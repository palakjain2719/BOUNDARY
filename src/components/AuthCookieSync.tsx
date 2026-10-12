"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

/**
 * No sign-up: every browser gets its own anonymous Supabase session on first visit, so saved teams and
 * entered points are private to that browser (row-level security) without an account.
 * Keeps the `sb-access-token` cookie (read by server routes) in sync, including token refreshes.
 */
export function AuthCookieSync({ url, anonKey }: { url: string; anonKey: string }) {
  const router = useRouter();
  useEffect(() => {
    const sb = createClient(url, anonKey);
    const hadCookie = document.cookie.includes("sb-access-token=");
    const set = (token: string | null, expiresIn?: number) => {
      document.cookie = token
        ? `sb-access-token=${token}; Path=/; Max-Age=${expiresIn ?? 3600}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`
        : "sb-access-token=; Path=/; Max-Age=0; SameSite=Lax";
    };
    sb.auth.getSession().then(async ({ data }) => {
      let session = data.session;
      if (!session) {
        const r = await sb.auth.signInAnonymously();
        session = r.data.session;
        if (r.error) console.warn("Anonymous session unavailable:", r.error.message);
      }
      set(session?.access_token ?? null, session?.expires_in);
      // The first server render ran before the session existed; re-render with it.
      if (session && !hadCookie) router.refresh();
    });
    const { data } = sb.auth.onAuthStateChange((_e, session) => set(session?.access_token ?? null, session?.expires_in));
    return () => data.subscription.unsubscribe();
  }, [url, anonKey, router]);
  return null;
}
