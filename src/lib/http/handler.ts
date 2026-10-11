import { NextResponse } from "next/server";
import { getSessionUser, GUEST, type SessionUser } from "../auth";
import { getRepository } from "../store";
import type { Repository } from "../store/types";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Wrap a route: resolves the session + repository and converts errors to JSON responses. */
export function route<C>(fn: (ctx: { req: Request; user: SessionUser; repo: Repository; params: C }) => Promise<Response>, opts: { admin?: boolean; public?: boolean } = {}) {
  return async (req: Request, context: { params: Promise<C> }) => {
    try {
      const user = (await getSessionUser(req)) ?? (opts.public ? GUEST : null);
      if (!user) throw new HttpError(401, "Sign in required");
      if (opts.admin && !user.isAdmin) throw new HttpError(403, "Admin permission required (ADMIN_USER_IDS)");
      const repo = getRepository(user.accessToken);
      return await fn({ req, user, repo, params: await context.params });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, details: e.details ?? null }, e.status);
      console.error(e);
      return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
    }
  };
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
