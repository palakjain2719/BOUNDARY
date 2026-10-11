import { getReview } from "@/lib/match/actions";
import { json, route } from "@/lib/http/handler";

export const GET = route<{ id: string }>(async ({ user, repo, params }) => json(await getReview(repo, user, params.id)), { public: true });
