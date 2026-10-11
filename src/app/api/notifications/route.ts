import { scheduleReminders } from "@/lib/notifications";
import { loadWorkspaceMatch } from "@/lib/match/workspace";
import { getClock } from "@/lib/pipeline/clock";
import { body, HttpError, json, route } from "@/lib/http/handler";

export const GET = route(async ({ user, repo }) =>
  json({ preference: await repo.getNotificationPreference(user.id), scheduled: await repo.listScheduledNotifications({ userId: user.id }) }),
);

type Body =
  | { action: "preferences"; email: string | null; phone: string | null; emailEnabled: boolean; smsEnabled: boolean }
  | { action: "follow"; matchId: string };

export const POST = route(async ({ req, user, repo }) => {
  const b = await body<Body>(req);
  if (b.action === "preferences") {
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) throw new HttpError(400, "Email looks invalid");
    if (b.phone && !/^\+[1-9]\d{7,14}$/.test(b.phone)) throw new HttpError(400, "Phone must be in E.164 format, e.g. +919812345678");
    return json(await repo.saveNotificationPreference({ userId: user.id, email: b.email || null, phone: b.phone || null, emailEnabled: !!b.emailEnabled, smsEnabled: !!b.smsEnabled, updatedAt: new Date().toISOString() }));
  }
  if (b.action === "follow") {
    const pref = await repo.getNotificationPreference(user.id);
    if (!pref || (!pref.emailEnabled && !pref.smsEnabled)) throw new HttpError(409, "Opt in to email or SMS reminders in Settings first");
    const clock = await getClock(repo);
    const m = await loadWorkspaceMatch(repo, b.matchId, clock);
    if (!m) throw new HttpError(404, "Match not found");
    try {
      return json(await scheduleReminders(repo, pref, { id: m.match.id, startTimeUtc: m.match.startTimeUtc }, clock.now));
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
  }
  throw new HttpError(400, "Unknown action");
});
