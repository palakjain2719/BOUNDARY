import { describe, expect, it } from "vitest";
import { LocalRepository, ImmutableRecordError } from "@/lib/store/local";
import { processDueReminders, scheduleReminders, type Sender } from "@/lib/notifications";
import type { NotificationPreference, Snapshot } from "@/lib/store/types";
import { runTick } from "@/lib/pipeline/jobs";
import { latestActuals } from "@/lib/evaluation/evaluate";

const pref: NotificationPreference = { userId: "u1", email: "a@example.com", phone: "+911234567890", emailEnabled: true, smsEnabled: false, updatedAt: "2026-01-01T00:00:00Z" };
const counter = () => {
  const sent: string[] = [];
  const s: Sender = { id: "test", live: false, send: async (to, subject) => void sent.push(`${to}:${subject}`) };
  return { s, sent };
};

describe("reminders", () => {
  it("scheduling twice creates one reminder (idempotency key)", async () => {
    const repo = new LocalRepository(null);
    const now = new Date("2026-05-01T00:00:00Z");
    await scheduleReminders(repo, pref, { id: "m1", startTimeUtc: "2026-05-02T14:00:00Z" }, now);
    await scheduleReminders(repo, pref, { id: "m1", startTimeUtc: "2026-05-02T14:00:00Z" }, now);
    const all = await repo.listScheduledNotifications({ userId: "u1" });
    expect(all).toHaveLength(1);
    expect(all[0].scheduledFor).toBe("2026-05-02T13:00:00.000Z");
  });
  it("a rescheduled fixture cancels the old reminder and schedules a new one", async () => {
    const repo = new LocalRepository(null);
    const now = new Date("2026-05-01T00:00:00Z");
    await scheduleReminders(repo, pref, { id: "m1", startTimeUtc: "2026-05-02T14:00:00Z" }, now);
    await scheduleReminders(repo, pref, { id: "m1", startTimeUtc: "2026-05-02T10:00:00Z" }, now);
    const all = await repo.listScheduledNotifications({ userId: "u1" });
    expect(all.filter((n) => n.status === "scheduled").map((n) => n.scheduledFor)).toEqual(["2026-05-02T09:00:00.000Z"]);
    expect(all.filter((n) => n.status === "cancelled")).toHaveLength(1);
  });
  it("processing twice sends once; failures retry then dead-letter", async () => {
    const repo = new LocalRepository(null);
    await repo.saveNotificationPreference(pref);
    await scheduleReminders(repo, pref, { id: "m1", startTimeUtc: "2026-05-02T14:00:00Z" }, new Date("2026-05-01T00:00:00Z"));
    const { s, sent } = counter();
    const at = new Date("2026-05-02T13:05:00Z");
    await processDueReminders(repo, at, async () => "A v B", { email: s });
    await processDueReminders(repo, at, async () => "A v B", { email: s });
    expect(sent).toHaveLength(1);

    const repo2 = new LocalRepository(null);
    await repo2.saveNotificationPreference(pref);
    await scheduleReminders(repo2, pref, { id: "m2", startTimeUtc: "2026-05-02T14:00:00Z" }, new Date("2026-05-01T00:00:00Z"));
    const failing: Sender = { id: "fail", live: false, send: async () => { throw new Error("provider down"); } };
    for (let i = 0; i < 3; i++) await processDueReminders(repo2, at, async () => "x", { email: failing });
    const [n] = await repo2.listScheduledNotifications({ userId: "u1" });
    expect(n.status).toBe("dead_letter");
    expect(n.attempts).toBe(3);
  });
});

describe("immutability", () => {
  it("snapshots, user teams and actual points are append-only", async () => {
    const repo = new LocalRepository(null);
    const snap = { id: "s1", matchId: "m", predictions: [], pool: [] } as unknown as Snapshot;
    await repo.saveSnapshot(snap);
    await expect(repo.saveSnapshot({ ...snap, modelId: "other" } as Snapshot)).rejects.toBeInstanceOf(ImmutableRecordError);
    const a = { id: "a1", userId: "u", matchId: "m", playerId: "p", enteredValue: 10, includesMultiplier: false, basePoints: 10, source: "manual" as const, verification: "user_confirmed" as const, rulesId: null, createdAt: "2026-01-01T00:00:00Z" };
    await repo.addActuals([a]);
    await expect(repo.addActuals([a])).rejects.toBeInstanceOf(ImmutableRecordError);
    // Corrections are new rows; the latest per player wins and history is kept.
    await repo.addActuals([{ ...a, id: "a2", basePoints: 12, createdAt: "2026-01-02T00:00:00Z" }]);
    const rows = await repo.listActuals("u", "m");
    expect(rows).toHaveLength(2);
    expect(latestActuals(rows).get("p")!.basePoints).toBe(12);
  });
  it("users only see their own rows in the local store", async () => {
    const repo = new LocalRepository(null);
    const a = { id: "a1", userId: "alice", matchId: "m", playerId: "p", enteredValue: 1, includesMultiplier: false, basePoints: 1, source: "manual" as const, verification: "user_confirmed" as const, rulesId: null, createdAt: "2026-01-01T00:00:00Z" };
    await repo.addActuals([a]);
    expect(await repo.listActuals("bob", "m")).toHaveLength(0);
  });
});

describe("pipeline job idempotency", () => {
  it("re-running a tick at the same clock does not duplicate fixtures or prepared analyses", async () => {
    const repo = new LocalRepository(null);
    await runTick(repo);
    const f1 = (await repo.listFixtures()).length;
    const a1 = (await repo.listPreparedAnalyses()).length;
    const second = await runTick(repo);
    expect((await repo.listFixtures()).length).toBe(f1);
    expect((await repo.listPreparedAnalyses()).length).toBe(a1);
    expect(second.runs.find((r) => r.job === "discover_fixtures")!.status).toBe("skipped");
    expect(a1).toBeGreaterThan(0);
  });
  it("a concurrent tick is refused while the lock is held", async () => {
    const repo = new LocalRepository(null);
    await repo.setState("pipeline_lock", { until: Date.now() + 60_000, tickId: "other" });
    expect((await runTick(repo)).locked).toBe(true);
  });
});
