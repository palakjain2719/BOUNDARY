import Link from "next/link";
import type { Metadata } from "next";
import { env, isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="card p-8">
        <h1 className="font-display text-3xl">Sign in</h1>
        {isSupabaseConfigured() ? (
          <LoginForm url={env.supabaseUrl} anonKey={env.supabaseAnonKey} />
        ) : (
          <>
            <p className="mt-3 text-sm">
              This deployment runs in <strong>demo mode</strong>: Supabase credentials are not configured, so there are no accounts. You are using a single local demo user (“Aryan (demo)”) and data is stored on this server only.
            </p>
            <p className="mt-2 text-sm text-muted">Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to enable sign-in and persistent storage.</p>
            <Link href="/matches" className="btn btn-primary mt-6">
              Continue in demo mode
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
