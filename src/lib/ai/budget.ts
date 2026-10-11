/**
 * Zero-cost guard for Google AI calls. Each kind of call has a hard daily cap (UTC day), persisted in
 * system_state so every serverless instance shares it (in-memory fallback when no repository is given).
 * When the cap is reached the caller must skip the call — the app degrades to deterministic behaviour.
 */
import type { Repository } from "../store/types";

export type BudgetKind = "google_search" | "gemini_explanation";

export const DAILY_LIMITS: Record<BudgetKind, () => number> = {
  google_search: () => Number(process.env.GOOGLE_SEARCH_MAX_PER_DAY ?? 20),
  gemini_explanation: () => Number(process.env.GEMINI_MAX_EXPLANATIONS_PER_DAY ?? 100),
};

const memory = new Map<string, number>();
const blockedUntil = new Map<BudgetKind, number>();

const key = (kind: BudgetKind, now: Date) => `budget:${kind}:${now.toISOString().slice(0, 10)}`;

/** Reserve one call. Returns false (and reserves nothing) when today's cap is used up or quota was exhausted. */
export async function tryConsume(kind: BudgetKind, repo?: Repository | null, now = new Date()): Promise<boolean> {
  if ((blockedUntil.get(kind) ?? 0) > now.getTime()) return false;
  const k = key(kind, now);
  const used = repo ? ((await repo.getState<number>(k).catch(() => null)) ?? 0) : (memory.get(k) ?? 0);
  if (used >= DAILY_LIMITS[kind]()) return false;
  if (repo) await repo.setState(k, used + 1).catch(() => memory.set(k, used + 1));
  else memory.set(k, used + 1);
  return true;
}

export async function usedToday(kind: BudgetKind, repo?: Repository | null, now = new Date()) {
  const k = key(kind, now);
  return repo ? ((await repo.getState<number>(k).catch(() => null)) ?? 0) : (memory.get(k) ?? 0);
}

/** Google reported quota exhaustion (HTTP 429): stop calling until the next UTC day. */
export function blockForToday(kind: BudgetKind, now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  blockedUntil.set(kind, next.getTime());
}

export function resetBudgetsForTests() {
  memory.clear();
  blockedUntil.clear();
}
