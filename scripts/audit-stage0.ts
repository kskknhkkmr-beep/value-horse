/** Retrospective final-odds audit ONLY. Not a pre-race simulator adapter. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { calculateScore } from "../lib/engine";
import { calcFormScore, calcPedigreeScore, calcJockeyScore, type HorseScores, type RaceResult } from "../lib/scorer";
import { calcComboBets } from "../lib/combination-ev";
import type { CachedRace } from "./fetch-races";
import { loadDevelopment } from "./simulator/input";
import { developmentDate, isoDate, sha256 } from "./simulator/canonical";
import { settleTicket, type Event } from "./simulator/settlement";
import type { TicketKind } from "./simulator/types";
import { bootstrap, recommendations, summarize, traces } from "./stage0-audit-core";

if (process.argv.slice(2).join(" ") !== "--retrospective-final-odds") throw new Error("Explicit --retrospective-final-odds required; no configurable data paths");
const hashes: Record<string, string> = {};
const files = ["lib/backfill/races-cache.json", "lib/backfill/scores-cache.json", "lib/backfill/horses.json"];
function noLinks(path: string) {
  let p = resolve(process.cwd());
  for (const part of ["", ...relative(p, resolve(path)).split(/[\\/]/)]) {
    if (part) p = join(p, part);
    if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error("Linked audit path rejected");
  }
}
function read<T>(path: string): T {
  if (!files.includes(path)) throw new Error("Input not allowlisted");
  noLinks(path); const bytes = readFileSync(path); hashes[path] = createHash("sha256").update(bytes).digest("hex");
  return JSON.parse(bytes.toString("utf8")) as T;
}
const cache = read<{ races: CachedRace[] }>(files[0]);
const scores = read<{ scores: Record<number, HorseScores> }>(files[1]).scores;
const histories = read<{ horses: Record<string, { rows: RaceResult[] }> }>(files[2]).horses;
const dataset = loadDevelopment(); Object.assign(hashes, dataset.sourceHashes);
const codeFiles = ["lib/engine.ts", "lib/scorer.ts", "lib/combination-ev.ts", "lib/starRating.ts", "app/page.tsx", "app/api/score/route.ts",
  "scripts/backfill-derive.ts", "scripts/audit-stage0.ts", "scripts/stage0-audit-core.ts", "scripts/simulator/input.ts", "scripts/simulator/settlement.ts",
  "scripts/simulator/canonical.ts", "docs/STAGE0_AUDIT_PLAN.md"];
const codeHashes = Object.fromEntries(codeFiles.map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")]));
const identities = new Set<number>(), raceIds = new Set<string>();
let noPast = 0, nullJockey = 0, jockeyOver100 = 0, sourceCount = 0;
// Entire structure and derivation verified BEFORE computing predictions or returns.
for (const race of cache.races) {
  const date = developmentDate(race.date), rid = race.netKeibaRaceId;
  if (!rid || raceIds.has(rid)) throw new Error("Duplicate/missing race ID"); raceIds.add(rid);
  const source = dataset.races.find((r) => r.raceId === rid);
  if (!source || source.date !== date || source.surface !== race.surface || source.distance !== race.distance || race.grade != null || source.starters.length !== race.horses.length) throw new Error("Cache/source mismatch");
  for (const [index, h] of race.horses.entries()) {
    const starter = source.starters.find((s) => s.horseId === h.netKeibaHorseId);
    const truth = dataset.truthByRace[rid].horses.find((s) => s.horseId === h.netKeibaHorseId);
    const s = scores[h.id], history = histories[h.netKeibaHorseId ?? ""];
    if (identities.has(h.id) || h.id !== Number(rid.slice(4)) * 100 + index + 1 || !starter || starter.horseNumber !== h.horseNumber || !truth || !history || !s || s.modelVersion !== "v3") throw new Error("Horse/score identity mismatch");
    identities.add(h.id); sourceCount++;
    if (!h.odds || h.odds <= 0 || Number(truth.finalOddsRaw) !== h.odds || !truth.popularity) throw new Error("Missing/inconsistent final market input");
    for (let i = 0; i < history.rows.length; i++) {
      if (isoDate(history.rows[i].date) > "2026-06-21" || (i && history.rows[i - 1].date < history.rows[i].date)) throw new Error("History range/order invalid");
    }
    const past = history.rows.filter((r) => isoDate(r.date) < date).slice(0, 10);
    if (s.formScore !== calcFormScore(past) || s.pedigreeScore !== calcPedigreeScore(past, race.surface, race.distance) ||
        s.jockeyScore !== (s.jockeyStats ? calcJockeyScore(s.jockeyStats) : null)) throw new Error(`Cached score cannot be reproduced: ${rid}/${h.horseNumber}`);
    if (!past.length) noPast++; if (s.jockeyScore == null) nullJockey++; if ((s.jockeyScore ?? 0) > 100) jockeyOver100++;
  }
}
if (raceIds.size !== 1338 || identities.size !== 18870 || Object.keys(scores).length !== identities.size || Object.keys(histories).length !== 7851) throw new Error("Development count mismatch");
console.log(JSON.stringify({ structureVerified: true, races: raceIds.size, starters: sourceCount, noPast, nullJockey, jockeyOver100 }));

const strategies: Record<string, Event[]> = {};
type Observation = { raceId: string; date: string; horseNumber: number; probability: number; marketProb: number; odds: number;
  popularity: number; positionRaw: string | null; win: boolean; top3: boolean; paidPlace: boolean; recommended: boolean; star: number | null; profitYen: number };
const observations: Observation[] = [], logs: unknown[] = [], caseLogs: unknown[] = [];
const pickCount: Record<string, number> = {}, pickPopularity: Record<string, number> = {}, topPositions: Record<string, number> = {};
let topCount = 0, topWins = 0, top3 = 0, topPaidPlace = 0, evTies = 0, probabilityTies = 0;
const cases = { marketOutVhIn: 0, marketInVhOut: 0, bothIn: 0, bothOut: 0, noRecommendation: 0 };
const gradeCounts: Record<string, number> = {};
const kinds = { umaren: "umaren", umatan: "umatan", wide: "wide", sanrenpuku: "sanfuku", sanrentan: "santan" } as const;
for (const race of [...cache.races].sort((a, b) => a.date.localeCompare(b.date) || a.netKeibaRaceId!.localeCompare(b.netKeibaRaceId!))) {
  const rid = race.netKeibaRaceId!, truth = dataset.truthByRace[rid], spec = dataset.races.find((r) => r.raceId === rid)!;
  gradeCounts[spec.grade ?? "null"] = (gradeCounts[spec.grade ?? "null"] ?? 0) + 1;
  const inputs = race.horses.map((h) => ({ id: h.id, name: h.horse, formScore: scores[h.id].formScore / 100,
    pedigreeScore: scores[h.id].pedigreeScore / 100, jockeyScore: scores[h.id].jockeyScore == null ? null : scores[h.id].jockeyScore! / 100, odds: h.odds! }));
  const result = calculateScore(inputs), trace = traces(result.finalScores);
  const numberById = new Map(race.horses.map((h) => [h.id, h.horseNumber]));
  const actual = (n: number) => truth.horses.find((h) => h.horseNumber === n)!;
  const in3 = (n: number) => /^[123]$/.test(actual(n).positionRaw ?? "");
  const market = [...race.horses].sort((a, b) => actual(a.horseNumber).popularity! - actual(b.horseNumber).popularity! || a.horseNumber - b.horseNumber).map((h) => h.horseNumber);
  const picks = recommendations(result.finalScores, false).map((h) => numberById.get(h.id)!);
  const pOrder = [...result.finalScores].sort((a, b) => b.probability - a.probability);
  if (result.evRanking.some((h, i, a) => i > 0 && h.ev === a[i - 1].ev)) evTies++;
  if (pOrder.some((h, i, a) => i > 0 && h.probability === a[i - 1].probability)) probabilityTies++;
  const add = (key: string, selections: number[][], kind: TicketKind = "tan") => {
    const e = { raceId: rid, date: spec.date, archivedStartTime: truth.archivedStartTime,
      settlements: selections.map((horses) => settleTicket({ kind, horses, stakeYen: 1000 }, truth)) };
    if (e.settlements.some((s) => s.status === "unresolved")) throw new Error(`Unresolved settlement ${rid}/${key}`);
    (strategies[key] ??= []).push(e); return e;
  };
  add("vhAll", picks.map((n) => [n])); add("marketSameN", market.slice(0, picks.length).map((n) => [n]));
  add("vhTop", picks.slice(0, 1).map((n) => [n])); add("marketPaired", picks.length ? [[market[0]]] : []);
  add("vhMaxProbability", [[numberById.get(pOrder[0].id)!]]); add("marketAll", [[market[0]]]);
  add("vhSummaryTop3", picks.slice(0, 3).map((n) => [n]));
  pickCount[picks.length] = (pickCount[picks.length] ?? 0) + 1;
  for (const n of picks) { const p = actual(n).popularity!; pickPopularity[p] = (pickPopularity[p] ?? 0) + 1; }
  if (picks.length) {
    const n = picks[0], a = actual(n); topCount++; topWins += Number(a.positionRaw === "1"); top3 += Number(in3(n));
    topPaidPlace += Number(settleTicket({ kind: "fuku", horses: [n], stakeYen: 1000 }, truth).status === "win");
    topPositions[a.positionRaw ?? "missing"] = (topPositions[a.positionRaw ?? "missing"] ?? 0) + 1;
    const key = in3(market[0]) ? (picks.some(in3) ? "bothIn" : "marketInVhOut") : (picks.some(in3) ? "marketOutVhIn" : "bothOut");
    cases[key]++; caseLogs.push({ raceId: rid, date: spec.date, category: key, marketFavorite: actual(market[0]), recommended: picks.map(actual) });
  } else cases.noRecommendation++;
  const knownGrade = ["G1", "G2", "G3"].includes(spec.grade ?? "");
  const unknownGrade = spec.grade != null && !knownGrade;
  const gradePicks = unknownGrade ? null : recommendations(result.finalScores, knownGrade).map((h) => numberById.get(h.id)!);
  if (gradePicks) {
    add("gradeRestoredVhAll", gradePicks.map((n) => [n])); add("gradeRestoredMarketSameN", market.slice(0, gradePicks.length).map((n) => [n]));
    add("gradeRestoredVhTop", gradePicks.slice(0, 1).map((n) => [n])); add("gradeRestoredMarketPaired", gradePicks.length ? [[market[0]]] : []);
  }
  const horseLogs = result.finalScores.map((h, i) => {
    const number = numberById.get(h.id)!, raw = race.horses[i], a = actual(number);
    const settlement = settleTicket({ kind: "tan", horses: [number], stakeYen: 1000 }, truth);
    const place = settleTicket({ kind: "fuku", horses: [number], stakeYen: 1000 }, truth);
    if (place.status === "unresolved" || settlement.profitYen == null) throw new Error("Unresolved horse label");
    observations.push({ raceId: rid, date: spec.date, horseNumber: number, probability: h.probability, marketProb: h.marketProb,
      odds: h.odds, popularity: a.popularity!, positionRaw: a.positionRaw, win: a.positionRaw === "1", top3: in3(number),
      paidPlace: place.status === "win", recommended: picks.includes(number),
      star: knownGrade && gradePicks!.includes(number) ? trace[i].evDerivedStars : null, profitYen: settlement.profitYen });
    return { ...h, ...trace[i], horseId: raw.netKeibaHorseId, horseNumber: number, scoreCache: scores[h.id],
      pastUsed: histories[raw.netKeibaHorseId!].rows.filter((r) => isoDate(r.date) < spec.date).slice(0, 10),
      recommended: picks.includes(number), gradeRestoredRecommended: gradePicks?.includes(number) ?? null,
      actual: a, confirmedWinSettlement: settlement, confirmedPlaceSettlement: place };
  });
  const combos = calcComboBets(result.finalScores.map((h) => ({ name: h.name, horseNumber: numberById.get(h.id)!, probability: h.probability, marketProb: h.marketProb })));
  for (const [kind, ticketKind] of Object.entries(kinds)) {
    const bets = combos.filter((c) => c.type === kind);
    add(`combo_${kind}`, bets.map((b) => b.horseNumbers), ticketKind);
    add(`comboSummary_${kind}`, bets.slice(0, 3).map((b) => b.horseNumbers), ticketKind);
  }
  logs.push({ raceId: rid, date: spec.date, cachedGrade: null, rawGrade: spec.grade, mode: "retrospective-final-odds-v3",
    horses: horseLogs, predictions: result, picks, marketSameN: market.slice(0, picks.length), gradePicks, combos });
}
function group(xs: Observation[]) {
  const wins = xs.filter((x) => x.win).length, profitYen = xs.reduce((s, x) => s + x.profitYen, 0);
  const byRace = new Map<string, Observation[]>();
  for (const x of xs) { const list = byRace.get(x.raceId) ?? []; list.push(x); byRace.set(x.raceId, list); }
  const events: Event[] = strategies.vhAll.map((e) => ({ ...e, settlements: (byRace.get(e.raceId) ?? []).map((x) => ({
    kind: "tan", horses: [x.horseNumber], stakeYen: 1000, status: x.profitYen + 1000 > 0 ? "win" : "loss",
    returnYen: x.profitYen + 1000, profitYen: x.profitYen, note: null })) }));
  const audit = summarize(events);
  return { horses: xs.length, wins, winRate: xs.length ? wins / xs.length : null,
    meanProbability: xs.length ? xs.reduce((s, x) => s + x.probability, 0) / xs.length : null,
    top3: xs.filter((x) => x.top3).length, paidPlace: xs.filter((x) => x.paidPlace).length,
    profitYen, roiNet: xs.length ? profitYen / (1000 * xs.length) : null, below20Hits: wins < 20,
    roi95CI: audit.bootstrap.roi95CI, maxDrawdownYen: audit.maxDrawdownYen,
    roiWithoutLargest1Return: audit.roiWithoutLargest1Return, roiWithoutLargest2Returns: audit.roiWithoutLargest2Returns };
}
const calibration = (key: "probability" | "marketProb") => Array.from({ length: 10 }, (_, i) => {
  const xs = observations.filter((x) => Math.min(9, Math.floor(x[key] * 10)) === i);
  return { bin: `[${i / 10},${(i + 1) / 10}${i === 9 ? "]" : ")"}`, horses: xs.length,
    predicted: xs.length ? xs.reduce((s, x) => s + x[key], 0) / xs.length : null, actual: xs.length ? xs.filter((x) => x.win).length / xs.length : null };
});
const oddsEdges = [1, 2, 5, 10, 20, 50, 100, Infinity];
const oddsBands = oddsEdges.slice(0, -1).map((lo, i) => ({ band: `[${lo},${oddsEdges[i + 1]})`,
  all: group(observations.filter((x) => x.odds >= lo && x.odds < oddsEdges[i + 1])),
  recommended: group(observations.filter((x) => x.recommended && x.odds >= lo && x.odds < oddsEdges[i + 1])) }));
const stars = Array.from({ length: 11 }, (_, i) => ({ stars: i / 2, ...group(observations.filter((x) => x.star === i / 2)) }));
const strategySummary = Object.fromEntries(Object.entries(strategies).map(([key, events]) => [key, summarize(events)]));
const pairs = [["vhAll", "marketSameN"], ["vhTop", "marketPaired"], ["vhMaxProbability", "marketAll"],
  ["gradeRestoredVhAll", "gradeRestoredMarketSameN"], ["gradeRestoredVhTop", "gradeRestoredMarketPaired"]];
const hitSet = (key: string) => new Set(strategies[key].flatMap((e) => e.settlements.filter((s) => s.status === "win")
  .map((s) => `${e.raceId}/${s.horses.join("-")}`)));
const comparisons = pairs.map(([a, b]) => {
  const x = hitSet(a), y = hitSet(b), union = new Set([...x, ...y]);
  return { a, b, sameWinningTickets: [...x].filter((k) => y.has(k)).length,
    winningTicketJaccard: union.size ? [...x].filter((k) => y.has(k)).length / union.size : null,
    ...bootstrap(strategies[a], strategies[b]) };
});
const selectedObservations = (key: string) => {
  const selected = new Set(strategies[key].flatMap((e) => e.settlements.map((s) => `${e.raceId}/${s.horses[0]}`)));
  return observations.filter((x) => selected.has(`${x.raceId}/${x.horseNumber}`));
};
const horseOutcomeComparisons = Object.fromEntries(["vhTop", "marketPaired", "vhAll", "marketSameN"]
  .map((k) => [k, group(selectedObservations(k))]));
const metadata = { mode: "事後市場情報を使った参考分析", sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  inputHashes: hashes, codeHashes, seed: 20261009 };
const runId = sha256(metadata);
const summary = { runId, ...metadata, races: raceIds.size, starters: sourceCount, scoreReproductionMismatches: 0,
  noPast, nullJockey, jockeyOver100, gradeCounts, evTies, probabilityTies, pickCount, pickPopularity,
  top: { count: topCount, wins: topWins, top3, paidPlace: topPaidPlace, positions: topPositions }, cases,
  calibrationVH: calibration("probability"), calibrationMarket: calibration("marketProb"), oddsBands, stars,
  strategies: strategySummary, comparisons, horseOutcomeComparisons };
const out = `lib/simulation-runs/stage0-audit-${runId}`;
noLinks(out);
if (existsSync(out)) throw new Error("Audit output already exists; no overwrite");
mkdirSync(out, { recursive: true });
for (const [name, value] of Object.entries({ summary, logs, cases: caseLogs, settlements: strategies })) {
  writeFileSync(join(out, `${name}.json`), JSON.stringify(value), { flag: "wx" });
}
for (const [p, expected] of Object.entries(hashes)) if (createHash("sha256").update(readFileSync(p)).digest("hex") !== expected) throw new Error("Input changed during audit");
console.log(JSON.stringify({ output: out, races: raceIds.size, starters: sourceCount, inputHashesUnchanged: true }));
