import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { fontVariables } from "./fonts";
import { SiteHeader } from "@/components/SiteHeader";
import { AuthCookieSync } from "@/components/AuthCookieSync";
import { env, isSupabaseConfigured } from "@/lib/env";

// Session-dependent header on every page; never prerender a signed-out shell.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: `${env.brandName} · Fantasy Cricket Match Optimizer`, template: `%s · ${env.brandName}` },
  description: "Research a match, build your XI, compare with an independent optimizer, and learn from the result.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
          Skip to content
        </a>
        {isSupabaseConfigured() && <AuthCookieSync url={env.supabaseUrl} anonKey={env.supabaseAnonKey} />}
        <SiteHeader />
        <main id="main">{children}</main>
        <footer className="mx-auto mt-16 max-w-7xl px-4 pb-10 text-xs text-muted sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
            <p>
              Ball-by-ball data: <a className="underline" href="https://cricsheet.org" target="_blank" rel="noreferrer">Cricsheet</a>. Historical men&apos;s IPL fantasy labels: Kaggle Dream11 dataset (2008–2023). Weather:{" "}
              <a className="underline" href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo</a>. Not affiliated with Dream11; no data is scraped from the Dream11 app.
            </p>
            <Link href="/how-it-works" className="underline">How it works</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
