"use client";
import { useState } from "react";
import type { NotificationPreference } from "@/lib/store/types";

export function NotificationForm({ pref, live }: { pref: NotificationPreference | null; live: boolean }) {
  const [email, setEmail] = useState(pref?.email ?? "");
  const [phone, setPhone] = useState(pref?.phone ?? "");
  const [emailOn, setEmailOn] = useState(pref?.emailEnabled ?? false);
  const [smsOn, setSmsOn] = useState(pref?.smsEnabled ?? false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preferences", email, phone, emailEnabled: emailOn, smsEnabled: smsOn }) });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: j.error });
  };
  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-full border border-line bg-white px-3 py-2" />
      </label>
      <label className="text-sm">
        Mobile (E.164, e.g. +9198…)
        <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-full border border-line bg-white px-3 py-2" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} /> Email reminders
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={smsOn} onChange={(e) => setSmsOn(e.target.checked)} /> SMS reminders
      </label>
      <div className="sm:col-span-2">
        <button className="btn btn-primary">Save preferences</button>
        <p className="mt-1 text-xs text-muted">{live ? "Live sending is enabled." : "Demo outbox: reminders are logged in the audit trail, never sent."} Follow a match from its page to schedule a reminder 1 hour before start.</p>
        {msg && <p role="status" className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
      </div>
    </form>
  );
}
