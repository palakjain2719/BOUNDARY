/** Shown instantly while a page's server data loads, so navigation never looks frozen. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink border-t-transparent" aria-hidden />
        <span className="text-sm text-muted">Loading…</span>
      </div>
      <div className="mt-6 space-y-4" aria-hidden>
        <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-paper" />
        <div className="h-40 animate-pulse rounded-3xl bg-paper" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-56 animate-pulse rounded-3xl bg-paper" />
          <div className="h-56 animate-pulse rounded-3xl bg-paper" />
        </div>
      </div>
    </div>
  );
}
