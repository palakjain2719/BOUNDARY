import type { Metadata } from "next";
import { SuperOverGame } from "@/components/play/SuperOverGame";

export const metadata: Metadata = { title: "Play cricket", description: "Bat a super over: chase the target in six balls." };

/** Just-for-fun mini game. Public: no sign-in, no data setup, nothing stored except your best score on this device. */
export default function PlayPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
      <header className="mb-4">
        <h1 className="font-display text-4xl sm:text-5xl">Play cricket</h1>
        <p className="mt-1 max-w-2xl text-muted">Just for fun. Bat a super over: six balls, two wickets, one target. Read the ring, shuffle across, and time it.</p>
      </header>
      <SuperOverGame />
    </div>
  );
}
