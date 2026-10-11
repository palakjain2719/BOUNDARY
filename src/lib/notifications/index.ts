/**
 * Match reminders, one hour before kick-off. Idempotency key = user|match|channel|startTime, so a fixture
 * time change cancels the old reminder and schedules a new one, and re-running the scheduler never
 * duplicates a send. Real sending only happens with NOTIFICATIONS_LIVE=true and provider credentials.
 */
import crypto from "node:crypto";
import { env } from "../env";
import type { NotificationPreference, Repository, ScheduledNotification } from "../store/types";

export interface Sender {
  id: string;
  live: boolean;
  send(to: string, subject: string, body: string): Promise<void>;
}

export const demoSender = (channel: "email" | "sms", repo: Repository): Sender => ({
  id: `demo-outbox-${channel}`,
  live: false,
  async send(to, subject, body) {
    await repo.audit({ actor: "scheduler", action: `notification.demo_${channel}`, entity: "demo_outbox", entityId: to, details: { subject, body, note: "Demo mode: not sent" } });
  },
});

export const resendSender = (fetchImpl: typeof fetch = fetch): Sender => ({
  id: "resend",
  live: true,
  async send(to, subject, body) {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.emailFrom, to, subject, text: body }),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
  },
});

export const twilioSender = (fetchImpl: typeof fetch = fetch): Sender => ({
  id: "twilio",
  live: true,
  async send(to, _subject, body) {
    const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${env.twilioSid}:${env.twilioToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: env.twilioFrom, Body: body }),
    });
    if (!res.ok) throw new Error(`Twilio HTTP ${res.status}`);
  },
});

export function senderFor(channel: "email" | "sms", repo: Repository): Sender {
  if (env.notificationsLive && channel === "email" && env.resendApiKey && env.emailFrom) return resendSender();
  if (env.notificationsLive && channel === "sms" && env.twilioSid && env.twilioToken && env.twilioFrom) return twilioSender();
  return demoSender(channel, repo);
}

export const reminderTime = (startTimeUtc: string) => new Date(Date.parse(startTimeUtc) - 3600_000).toISOString();
export const idempotencyKey = (userId: string, matchId: string, channel: string, startTimeUtc: string) => `${userId}|${matchId}|${channel}|${startTimeUtc}`;

/** Follow a match: schedule (or reschedule) reminders for each opted-in channel. */
export async function scheduleReminders(repo: Repository, pref: NotificationPreference, match: { id: string; startTimeUtc: string | null }, now = new Date()) {
  if (!match.startTimeUtc) throw new Error("This match has no start time, so a reminder cannot be scheduled");
  const existing = await repo.listScheduledNotifications({ userId: pref.userId });
  const out: ScheduledNotification[] = [];
  for (const channel of ["email", "sms"] as const) {
    const enabled = channel === "email" ? pref.emailEnabled && !!pref.email : pref.smsEnabled && !!pref.phone;
    const key = idempotencyKey(pref.userId, match.id, channel, match.startTimeUtc);
    // Cancel stale reminders for this match/channel (fixture time changed or channel disabled).
    for (const n of existing.filter((n) => n.matchId === match.id && n.channel === channel && n.status === "scheduled" && (n.idempotencyKey !== key || !enabled))) {
      await repo.upsertScheduledNotification({ ...n, status: "cancelled" });
    }
    if (!enabled) continue;
    const dup = existing.find((n) => n.idempotencyKey === key);
    if (dup && dup.status !== "cancelled") {
      out.push(dup);
      continue;
    }
    const scheduledFor = reminderTime(match.startTimeUtc);
    if (Date.parse(scheduledFor) < now.getTime()) continue;
    out.push(
      await repo.upsertScheduledNotification({
        id: dup?.id ?? crypto.randomUUID(), userId: pref.userId, matchId: match.id, channel, scheduledFor, status: "scheduled", idempotencyKey: key,
        attempts: 0, lastError: null, sentAt: null, provider: null, createdAt: now.toISOString(),
      }),
    );
  }
  return out;
}

export const MAX_ATTEMPTS = 3;

/** Process due reminders. Safe to run repeatedly (e.g. every 5 minutes from Vercel Cron). */
export async function processDueReminders(
  repo: Repository,
  now = new Date(),
  matchName: (matchId: string) => Promise<string> = async (id) => id,
  senders: { email?: Sender; sms?: Sender } = {},
) {
  const due = (await repo.listScheduledNotifications({ status: "scheduled" })).filter((n) => Date.parse(n.scheduledFor) <= now.getTime());
  const results: { id: string; status: string }[] = [];
  for (const n of due) {
    const pref = await repo.getNotificationPreference(n.userId);
    const to = n.channel === "email" ? pref?.email : pref?.phone;
    if (!to) {
      await repo.upsertScheduledNotification({ ...n, status: "cancelled", lastError: "Channel no longer configured" });
      results.push({ id: n.id, status: "cancelled" });
      continue;
    }
    // Too late to be useful (more than 55 minutes past the reminder time = after kick-off).
    if (now.getTime() - Date.parse(n.scheduledFor) > 55 * 60_000) {
      await repo.upsertScheduledNotification({ ...n, status: "failed", lastError: "Missed send window" });
      results.push({ id: n.id, status: "failed" });
      continue;
    }
    const sender = senders[n.channel] ?? senderFor(n.channel, repo);
    const name = await matchName(n.matchId);
    try {
      await sender.send(to, `${env.brandName}: ${name} starts in 1 hour`, `${name} starts in about an hour. Your saved team and the optimizer pick are ready to review.`);
      await repo.upsertScheduledNotification({ ...n, status: "sent", sentAt: now.toISOString(), attempts: n.attempts + 1, provider: sender.id });
      results.push({ id: n.id, status: "sent" });
    } catch (e) {
      const attempts = n.attempts + 1;
      await repo.upsertScheduledNotification({ ...n, attempts, lastError: e instanceof Error ? e.message : String(e), status: attempts >= MAX_ATTEMPTS ? "dead_letter" : "scheduled", provider: sender.id });
      results.push({ id: n.id, status: attempts >= MAX_ATTEMPTS ? "dead_letter" : "retry" });
    }
  }
  return results;
}
