import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { developmentDate, frozenClone, isoDate } from "./canonical";
import type { Dataset, History, Payout, PreRaceInput, RaceSpec, TicketKind, Truth } from "./types";

const FILES = ["lib/backfill/races.json", "lib/backfill-stage1/race-details-raw.json",
  "lib/backfill-stage1/horse-history-raw.json"];
export function assertInputPath(path: string): string {
  const root = resolve(process.cwd());
  const resolved = resolve(path);
  if (!FILES.some((p) => resolved === resolve(root, p))) throw new Error("Only allowlisted development inputs may be read");
  // Reject links BEFORE following them; no inspection of a sealed link target.
  let cursor = root;
  for (const part of ["", ...relative(root, resolved).split(/[\\/]/)]) {
    if (part) cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error("Linked input path rejected");
  }
  return resolved;
}
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Expected object");
  return v as Record<string, unknown>;
};
const array = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error("Expected array"); return v; };
const text = (v: unknown): string => { if (typeof v !== "string" || !v.length) throw new Error("Expected text"); return v; };
const maybeText = (v: unknown): string | null => v == null ? null : text(v);
const number = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Expected finite number"); return v;
};
const maybeNumber = (v: unknown): number | null => v == null ? null : number(v);
const id = (v: unknown, digits: number): string => {
  const value = text(v); if (!new RegExp(`^\\d{${digits}}$`).test(value)) throw new Error("Invalid stable ID"); return value;
};
export const TICKET_KINDS: TicketKind[] = ["tan", "fuku", "wide", "umaren", "umatan", "sanfuku", "santan"];
function history(value: unknown): History {
  const r = obj(value);
  const date = isoDate(text(r.date));
  if (date > "2026-06-21") throw new Error("Post-development history in ordinary input");
  return {
    netKeibaRaceId: r.netKeibaRaceId == null ? null : id(r.netKeibaRaceId, 12), date,
    venueRaw: maybeText(r.venueRaw), venue: maybeText(r.venue), raceName: maybeText(r.raceName),
    weatherRaw: maybeText(r.weatherRaw), surface: maybeText(r.surface), distance: maybeNumber(r.distance),
    trackConditionRaw: maybeText(r.trackConditionRaw), fieldSize: maybeNumber(r.fieldSize),
    frameNumber: maybeNumber(r.frameNumber), horseNumber: maybeNumber(r.horseNumber),
    positionRaw: maybeText(r.positionRaw), position: maybeNumber(r.position), marginRaw: maybeText(r.marginRaw),
    raceTimeRaw: maybeText(r.raceTimeRaw), cornerPositionsRaw: maybeText(r.cornerPositionsRaw),
    final3fRaw: maybeText(r.final3fRaw), jockey: maybeText(r.jockey), jockeyId: maybeText(r.jockeyId),
    carriedWeightRaw: maybeText(r.carriedWeightRaw), horseWeightRaw: maybeText(r.horseWeightRaw),
    oddsRaw: maybeText(r.oddsRaw), popularity: maybeNumber(r.popularity),
  };
}
function payout(value: unknown): Payout {
  const p = obj(value);
  if (!["ok", "missing", "refund", "not_offered", "unparsed"].includes(text(p.status))) throw new Error("Invalid payout status");
  const entries = array(p.entries).map((value) => {
    const e = obj(value);
    const base = { payout: number(e.payout) };
    return e.horse != null ? { ...base, horse: number(e.horse) } : { ...base, combo: array(e.combo).map(number) };
  });
  return { status: p.status as Payout["status"], rawCombination: maybeText(p.rawCombination),
    rawPayout: maybeText(p.rawPayout), entries,
    ...(p.rows == null ? {} : { rows: array(p.rows).map(payout) }) };
}

/** Loads and validates structure only; does NOT predict, settle bets, or compute metrics. */
export function loadDevelopment(): Dataset {
  const sourceHashes: Record<string, string> = {};
  const documents = FILES.map((file) => {
    const bytes = readFileSync(assertInputPath(file));
    sourceHashes[file] = createHash("sha256").update(bytes).digest("hex");
    return obj(JSON.parse(bytes.toString("utf8")));
  });
  if (documents[1].schemaVersion !== 1 || documents[2].schemaVersion !== 1) throw new Error("Unsupported raw schema");
  const source = obj(documents[0].races), details = obj(documents[1].races), horses = obj(documents[2].horses);
  if (Object.keys(source).length !== 1338 || Object.keys(details).length !== 1338 || Object.keys(horses).length !== 7851) {
    throw new Error("Expected exactly development 1338 races / 7851 horses");
  }
  const historyByHorse: Record<string, History[]> = {};
  for (const [key, value] of Object.entries(horses)) {
    const h = obj(value);
    if (id(key, 10) !== id(h.horseId, 10)) throw new Error("Horse ID/key mismatch");
    historyByHorse[key] = array(h.rows).map(history);
  }
  const races: RaceSpec[] = [], truthByRace: Record<string, Truth> = {};
  const seen = new Set<string>(), starterIds = new Set<string>();
  for (const value of Object.values(source)) {
    const s = obj(value), raceId = id(s.netKeibaRaceId, 12), date = developmentDate(text(s.date));
    if (seen.has(raceId)) throw new Error("Duplicate race ID"); seen.add(raceId);
    const d = obj(details[raceId]);
    if (d.netKeibaRaceId !== raceId || d.date !== date) throw new Error("Race ID/date mismatch");
    const pre = obj(d.preRace), cls = obj(pre.class);
    const rawHorses = array(d.horses).map(obj);
    const mapped = new Map(rawHorses.map((h) => [id(h.horseId, 10), h]));
    if (mapped.size !== rawHorses.length) throw new Error("Duplicate race horse");
    const starters = array(s.horses).map((value) => {
      const h = obj(value), horseId = id(h.horseId, 10), detail = mapped.get(horseId);
      if (!detail || !historyByHorse[horseId]) throw new Error("Missing starter/history");
      const p = obj(detail.preRace);
      if (detail.horseNumber !== h.horseNumber || detail.frameNumber !== h.frameNumber) throw new Error("Starter number mismatch");
      starterIds.add(horseId);
      return { horseId, horse: text(h.horse), horseNumber: number(h.horseNumber), frameNumber: maybeNumber(h.frameNumber),
        sex: maybeText(p.sex), age: maybeNumber(p.age), carriedWeight: maybeNumber(p.carriedWeight),
        carriedWeightRaw: maybeText(p.carriedWeightRaw), jockey: maybeText(p.jockey), jockeyId: maybeText(p.jockeyId),
        trainer: maybeText(p.trainer), trainerId: maybeText(p.trainerId) };
    });
    if (!starters.length || new Set(starters.map((h) => h.horseId)).size !== starters.length ||
        new Set(starters.map((h) => h.horseNumber)).size !== starters.length) throw new Error("Invalid starter set");
    const sourceIds = new Set(starters.map((h) => h.horseId));
    for (const h of rawHorses) if (!sourceIds.has(text(h.horseId)) && !/^(取|除)/.test(text(obj(h.result).positionRaw))) {
      throw new Error("Unexplained extra result horse");
    }
    races.push({ raceId, date, venue: text(s.venue), raceNumber: number(s.raceNumber),
      raceName: text(s.raceName), surface: text(s.surface), distance: number(s.distance),
      classRaw: maybeText(cls.raw), structuredClass: maybeText(cls.structured), grade: maybeText(cls.grade), starters });
    const payouts = obj(obj(d.labels).payouts);
    const time = maybeText(pre.postTimeRaw);
    if (time && !/^\d{1,2}:\d{2}$/.test(time)) throw new Error("Invalid archival start time");
    truthByRace[raceId] = { raceId, date, archivedStartTime: time,
      horses: rawHorses.map((h) => {
        const r = obj(h.result);
        return { horseId: id(h.horseId, 10), horseNumber: number(h.horseNumber), positionRaw: maybeText(r.positionRaw),
          raceTimeRaw: maybeText(r.raceTimeRaw), marginRaw: maybeText(r.marginRaw), final3fRaw: maybeText(r.final3fRaw),
          cornerPositionsRaw: maybeText(r.cornerPositionsRaw), finalOddsRaw: maybeText(r.oddsRaw), popularity: maybeNumber(r.popularity) };
      }), payouts: Object.fromEntries(TICKET_KINDS.map((k) => [k, payout(payouts[k])])) as Record<TicketKind, Payout> };
  }
  if (Object.keys(details).some((k) => !seen.has(k)) || starterIds.size !== 7851 ||
      Object.keys(horses).some((k) => !starterIds.has(k))) throw new Error("Development set mismatch");
  const dates = races.map((r) => r.date).sort();
  if (dates[0] !== "2026-02-07" || dates.at(-1) !== "2026-06-21") throw new Error("Development range mismatch");
  // Verify dates of known development race IDs in historical rows without using results.
  for (const rows of Object.values(historyByHorse)) for (const row of rows) {
    if (row.netKeibaRaceId && truthByRace[row.netKeibaRaceId] && truthByRace[row.netKeibaRaceId].date !== row.date) {
      throw new Error("History race date disagreement");
    }
  }
  return frozenClone({ races, historyByHorse, truthByRace, sourceHashes, constraints: [
    "Final odds and popularity are retrospective references only; no pre-race odds snapshots exist.",
    "Current track condition, weather, horse weight and archival start time are not prediction inputs.",
    "Starter set is retrospective actual starters; cancelled/excluded announced entrants are not reconstructed.",
    "Static declarations are reconstructed from results pages, not timestamped pre-race captures.",
    "Archived header start times order settlement events but actual off times are unverified.",
    "No current jockey statistics, scores cache, pedigree snapshot or VH adapter is loaded.",
  ] });
}

/** White-list projection: no current result, odds, popularity, payouts or unknown fields. */
export function prepareInput(race: RaceSpec, historyByHorse: Dataset["historyByHorse"]): PreRaceInput {
  const date = developmentDate(race.date);
  return frozenClone({ raceId: race.raceId, date, venue: race.venue, raceNumber: race.raceNumber,
    raceName: race.raceName, surface: race.surface, distance: race.distance,
    classRaw: race.classRaw, structuredClass: race.structuredClass, grade: race.grade,
    horses: race.starters.map((h) => {
      if (!historyByHorse[h.horseId]) throw new Error("Missing history (never silently substitute empty)");
      return { horseId: h.horseId, horse: h.horse, horseNumber: h.horseNumber, frameNumber: h.frameNumber,
        sex: h.sex, age: h.age, carriedWeight: h.carriedWeight, carriedWeightRaw: h.carriedWeightRaw,
        jockey: h.jockey, jockeyId: h.jockeyId, trainer: h.trainer, trainerId: h.trainerId,
        history: historyByHorse[h.horseId].filter((r) => isoDate(r.date) < date && r.netKeibaRaceId !== race.raceId)
          .map(history).sort((a, b) => a.date.localeCompare(b.date) || (a.netKeibaRaceId ?? "").localeCompare(b.netKeibaRaceId ?? "")),
      };
    }).sort((a, b) => a.horseNumber - b.horseNumber) });
}
