/**
 * Ingest Cricsheet JSON (men's IPL + women's WPL) into compact processed files used by the app.
 *
 * Usage: npx tsx scripts/ingest-cricsheet.ts [--ipl data/raw/ipl_json] [--wpl data/raw/wpl_json]
 *        [--kaggle data/raw/kaggle_ipl] [--mapping <player_identity_mapping.csv>] [--out data/processed]
 *
 * Output keeps competitions separate (competition field on every row). Super Over deliveries are excluded
 * from player stats (Dream11 does not score Super Overs) but the match is flagged `hasSuperOver`.
 */
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import type { Competition, MatchRecord, PlayerMatchStats, KaggleLabel } from "../src/lib/data/types";
import { emptyStats, parseMatch } from "../src/lib/data/cricsheet";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const IPL_DIR = arg("ipl", "data/raw/ipl_json");
const WPL_DIR = arg("wpl", "data/raw/wpl_json");
const KAGGLE_DIR = arg("kaggle", "data/raw/kaggle_ipl");
const MAPPING = arg(
  "mapping",
  "data/raw/training_v3/match_optimizer_training_dataset/player_identity_mapping.csv",
);
const OUT = arg("out", "data/processed");

function ingestDir(dir: string, competition: Competition) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));
  const matches: MatchRecord[] = [];
  const rows: PlayerMatchStats[] = [];
  const names: Record<string, string> = {};
  for (const f of files) {
    const r = parseMatch(JSON.parse(fs.readFileSync(f, "utf8")), path.basename(f, ".json"), competition);
    if (r.match.gender !== (competition === "IPL" ? "male" : "female")) {
      throw new Error(`Gender mismatch in ${f}: competitions must stay separate`);
    }
    matches.push(r.match);
    rows.push(...r.rows);
    Object.assign(names, r.names);
  }
  matches.sort((a, b) => (a.date === b.date ? Number(a.id) - Number(b.id) : a.date.localeCompare(b.date)));
  return { matches, rows, names };
}

function readCsv<T>(file: string): T[] {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  return Papa.parse<T>(text, { header: true, skipEmptyLines: true }).data;
}

function ingestKaggle(): { labels: KaggleLabel[]; audit: Record<string, number> } {
  const fantasyFile = path.join(KAGGLE_DIR, "Final_Fantasy_data.csv");
  if (!fs.existsSync(fantasyFile) || !fs.existsSync(MAPPING)) {
    console.warn("Kaggle fantasy data or identity mapping not found; skipping labels.");
    return { labels: [], audit: {} };
  }
  type Row = Record<string, string>;
  const mapping = new Map<string, Row>();
  for (const m of readCsv<Row>(MAPPING)) mapping.set(`${m.match_id}|${m.player_name}`, m);
  const labels: KaggleLabel[] = [];
  const audit = { rows: 0, placeholderRows: 0, high: 0, notHigh: 0 };
  for (const r of readCsv<Row>(fantasyFile)) {
    audit.rows += 1;
    if (/^substitute_/i.test(r.fullName)) {
      audit.placeholderRows += 1;
      continue;
    }
    const m = mapping.get(`${r.match_id}|${r.fullName}`);
    const high = m?.name_match_confidence === "high" && m.cricsheet_player_id;
    if (high) audit.high += 1;
    else audit.notHigh += 1;
    labels.push({
      matchId: r.match_id,
      season: r.season,
      kaggleName: r.fullName,
      playerId: high ? m!.cricsheet_player_id : null,
      mappingConfidence: m?.name_match_confidence ?? "unmatched",
      startingPoints: Number(r.Starting_11),
      battingFP: Number(r.Batting_FP),
      bowlingFP: Number(r.Bowling_FP),
      fieldingFP: Number(r.Fielding_FP),
      totalFP: Number(r.Total_FP),
      retroDreamTeam: r["Dream Team"] === "1",
      retroCaptain: r.Captain === "1",
      retroViceCaptain: r["Vice Captain"] === "1",
    });
  }
  return { labels, audit };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const ipl = ingestDir(IPL_DIR, "IPL");
  const wpl = fs.existsSync(WPL_DIR) ? ingestDir(WPL_DIR, "WPL") : { matches: [], rows: [], names: {} };
  const kaggle = ingestKaggle();

  // Compact columnar encoding for player stats keeps the bundle small.
  const statCols = Object.keys(emptyStats()) as (keyof ReturnType<typeof emptyStats>)[];
  const encode = (rows: PlayerMatchStats[]) => ({
    columns: ["matchId", "playerId", "team", ...statCols],
    rows: rows.map((r) => [r.matchId, r.playerId, r.team, ...statCols.map((c) => r[c])]),
  });

  for (const [comp, d] of [
    ["ipl", ipl],
    ["wpl", wpl],
  ] as const) {
    fs.writeFileSync(path.join(OUT, `${comp}_matches.json`), JSON.stringify(d.matches));
    fs.writeFileSync(path.join(OUT, `${comp}_player_stats.json`), JSON.stringify(encode(d.rows)));
    fs.writeFileSync(path.join(OUT, `${comp}_players.json`), JSON.stringify(d.names));
  }
  const labelCols = kaggle.labels.length ? (Object.keys(kaggle.labels[0]) as (keyof KaggleLabel)[]) : [];
  fs.writeFileSync(
    path.join(OUT, "ipl_kaggle_labels.json"),
    JSON.stringify({ columns: labelCols, rows: kaggle.labels.map((l) => labelCols.map((c) => l[c])) }),
  );

  const range = (m: MatchRecord[]) => (m.length ? { from: m[0].date, to: m[m.length - 1].date } : null);
  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: "scripts/ingest-cricsheet.ts",
    competitions: {
      IPL: {
        gender: "male",
        matches: ipl.matches.length,
        playerMatchRows: ipl.rows.length,
        players: new Set(ipl.rows.map((r) => r.playerId)).size,
        dateRange: range(ipl.matches),
        superOverMatches: ipl.matches.filter((m) => m.hasSuperOver).length,
        source: "Cricsheet ipl_male_json (CC BY 4.0-style ODC-By; see Cricsheet LICENSE)",
      },
      WPL: {
        gender: "female",
        matches: wpl.matches.length,
        playerMatchRows: wpl.rows.length,
        players: new Set(wpl.rows.map((r) => r.playerId)).size,
        dateRange: range(wpl.matches),
        superOverMatches: wpl.matches.filter((m) => m.hasSuperOver).length,
        source: "Cricsheet wpl_json",
      },
    },
    kaggleIplLabels: {
      ...kaggle.audit,
      labelledMatches: new Set(kaggle.labels.map((l) => l.matchId)).size,
      seasons: kaggle.labels.length
        ? { from: kaggle.labels.reduce((a, l) => (l.season < a ? l.season : a), "9999"), to: kaggle.labels.reduce((a, l) => (l.season > a ? l.season : a), "0") }
        : null,
      source: "Kaggle Dream11 IPL fantasy dataset (Final_Fantasy_data.csv); identity mapping from supplied training package, high confidence only",
    },
  };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

main();
