import { builtinModels, getActiveModel } from "@/lib/models/registry";
import { json, route } from "@/lib/http/handler";

export const GET = route(async ({ repo }) =>
  json({
    models: builtinModels(),
    active: { IPL: await getActiveModel(repo, "IPL"), WPL: await getActiveModel(repo, "WPL") },
    activations: await repo.listActivations(),
  }),
);
