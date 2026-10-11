"use client";
import { useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

/**
 * Keeps the `sb-access-token` cookie (read by server routes) in sync with the browser Supabase session,
 * including automatic token refreshes. Uses only the public anon key.
 */
export function AuthCookieSync({ url, anonKey }: { url: string; anonKey: string }) {
  useEffect(() => {
    const sb = createClient(url, anonKey);
    const set = (token: string | null, expiresIn?: number) => {
      document.cookie = token
        ? `sb-access-token=${token}; Path=/; Max-Age=${expiresIn ?? 3600}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`
        : "sb-access-token=; Path=/; Max-Age=0; SameSite=Lax";
    };
    sb.auth.getSession().then(({ data }) => set(data.session?.access_token ?? null, data.session?.expires_in));
    const { data } = sb.auth.onAuthStateChange((_e, session) => set(session?.access_token ?? null, session?.expires_in));
    return () => data.subscription.unsubscribe();
  }, [url, anonKey]);
  return null;
}
