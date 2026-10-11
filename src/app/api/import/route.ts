import { parseFixturesCsv, parsePoolCsv } from "@/lib/providers/csv-import";
import { body, HttpError, json, route } from "@/lib/http/handler";

export const POST = route(
  async ({ req, user, repo }) => {
    const b = await body<{ kind: "fixtures" | "pool"; csv: string }>(req);
    if (!b.csv?.trim()) throw new HttpError(400, "CSV text is empty");
    if (b.kind === "fixtures") {
      const r = parseFixturesCsv(b.csv, user.id);
      if (r.errors.length) throw new HttpError(400, "Fixture CSV has errors", r.errors);
      await repo.upsertFixtures(r.rows, []);
      await repo.audit({ actor: user.id, action: "import.fixtures", entity: "matches", entityId: r.rows.map((x) => x.id).join(","), details: { rows: r.rows.length } });
      return json({ imported: r.rows.length });
    }
    const fixtures = new Set((await repo.listFixtures()).map((f) => f.id));
    const r = parsePoolCsv(b.csv, fixtures);
    if (r.errors.length) throw new HttpError(400, "Pool CSV has errors", r.errors);
    await repo.upsertFixtures([], r.rows);
    await repo.audit({ actor: user.id, action: "import.pool", entity: "match_player_pool", entityId: [...new Set(r.rows.map((x) => x.fixtureId))].join(","), details: { rows: r.rows.length } });
    return json({ imported: r.rows.length });
  },
  { admin: true },
);
