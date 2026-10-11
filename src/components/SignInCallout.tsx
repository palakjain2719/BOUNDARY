import Link from "next/link";

/** Shown where an action or view is personal. Shared analysis stays visible without signing in. */
export function SignInCallout({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paper p-4 text-sm">
      <p>
        <Link href="/login" className="font-semibold underline">
          Sign in
        </Link>{" "}
        to {what}. Everything else on this page is visible without an account.
      </p>
    </div>
  );
}
