"use client";
import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

export function LoginForm({ url, anonKey }: { url: string; anonKey: string }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = createClient(url, anonKey);
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/matches` } });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Check your email for a sign-in link." });
  };
  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <label className="block text-sm">
        Email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-full border border-line bg-white px-4 py-2.5" />
      </label>
      <button className="btn btn-primary w-full justify-center">Send magic link</button>
      {msg && <p role="status" className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
    </form>
  );
}
