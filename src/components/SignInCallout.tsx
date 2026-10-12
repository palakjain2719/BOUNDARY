/** Shown for a personal action before this browser's private workspace is ready. */
export function SignInCallout({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paper p-4 text-sm">
      <p>
        Setting up this browser&apos;s private workspace so you can {what}. No sign-up needed. Refresh the page in a moment.
      </p>
    </div>
  );
}
