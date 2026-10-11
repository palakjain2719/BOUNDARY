import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <p className="font-display text-7xl">404</p>
      <h1 className="mt-2 font-display text-2xl">Out of the ground</h1>
      <p className="mt-2 text-muted">That match or page doesn&apos;t exist, or isn&apos;t visible at the current pipeline time.</p>
      <Link href="/matches" className="btn btn-primary mt-6">
        Back to matches
      </Link>
    </div>
  );
}
