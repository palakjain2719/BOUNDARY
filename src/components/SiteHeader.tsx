import Link from "next/link";
import { env, integrationStatuses, isDemoMode } from "@/lib/env";
import { DemoModeBadge } from "./DemoModeBadge";
import { getSessionUser } from "@/lib/auth";
import { IconSearch } from "./icons";
import { NavLinks } from "./NavLinks";

export function BrandMark({ name = env.brandName }: { name?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-display text-2xl leading-none tracking-tight">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="var(--color-ball)" />
        <path d="M8 2.8c2.6 2.6 2.6 15.8 0 18.4M16 2.8c-2.6 2.6-2.6 15.8 0 18.4" stroke="#f7e2c4" strokeWidth="1.4" fill="none" />
      </svg>
      {name}
    </span>
  );
}

export async function SiteHeader() {
  const user = await getSessionUser();
  const demo = isDemoMode();
  const initials = (user?.displayName ?? "?").replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase() || "A";
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="shrink-0" aria-label={`${env.brandName} home`}>
          <BrandMark />
        </Link>
        <div className="order-last w-full lg:order-none lg:w-auto">
          <NavLinks />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {demo && <DemoModeBadge items={integrationStatuses().map(({ name, state, detail }) => ({ name, state, detail }))} />}
          <Link href="/matches" className="hidden h-10 w-10 shrink-0 place-items-center sm:grid rounded-full border border-line bg-paper hover:bg-white" aria-label="Search matches">
            <IconSearch />
          </Link>
          {user ? (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink font-semibold text-white" title={user.displayName} aria-label={`Signed in as ${user.displayName}`}>
              {initials}
            </span>
          ) : (
            <Link href="/login" className="btn btn-primary">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
