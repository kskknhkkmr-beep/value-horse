/** Read-only saved-prediction reaggregation and input quality. No fitting or prediction. */
import assert from "node:assert/strict";
import { readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { loadDevelopment } from "./simulator/input";
import { loadRun } from "./simulator/store";
import { sha256 } from "./simulator/canonical";
import type { History } from "./simulator/types";
import type { AuditRow } from "./stage1-first-audit-core";

if (process.argv.length > 2) throw new Error("No paths or selection parameters accepted");
const audit = "47ae88195890f642fcb17a741816e4768090c9c82895056c8a607c7c84e9b538";
const dir = `lib/simulation-runs/stage1-first-audit-${audit}`;
function read(name: "rows.json" | "summary.json") {
  let cursor = process.cwd();
  for (const part of [...dir.split("/"), name]) {
    cursor = join(cursor, part); assert(!lstatSync(cursor).isSymbolicLink());
  }
  return JSON.parse(readFileSync(cursor, "utf8"));
}
const rows = read("rows.json") as AuditRow[];
const { auditId, sourceCommit, codeHashes, reportSha256, ...report } = read("summary.json");
assert.equal(auditId, audit); assert.equal(sha256(report), reportSha256);
assert.equal(sha256({ sourceCommit, codeHashes, reportSha256 }), audit);
const dataset = loadDevelopment();
const specs = new Map(dataset.races.map(r => [r.raceId, r]));
assert.equal(rows.length, 766); assert.equal(new Set(rows.map(r => r.raceId)).size, 766);
rows.forEach(r => { assert(r.independent); assert.equal(specs.get(r.raceId)?.date, r.date); });
for (const row of rows) for (const outcome of [row.independent!, row.market]) {
  const truth = dataset.truthByRace[row.raceId].horses.find(h => h.horseId === outcome.horseId);
  assert(truth); assert.equal(truth.positionRaw, outcome.positionRaw);
  assert.equal(truth.popularity, outcome.popularity); assert.equal(truth.horseNumber, outcome.horseNumber);
  assert.equal(outcome.win, outcome.positionRaw === "1");
  const fuku = dataset.truthByRace[row.raceId].payouts.fuku;
  assert.equal(fuku.status, "ok");
  assert.equal(outcome.place, fuku.entries.some(e => e.horse === outcome.horseNumber));
}
const count = (values: (string | number | null)[]) => values.reduce<Record<string, number>>((a, v) => {
  const key = String(v); a[key] = (a[key] ?? 0) + 1; return a;
}, {});
function summarize(group: AuditRow[]) {
  return Object.fromEntries((["independent", "market"] as const).map(key => {
    const values = group.map(r => r[key]!);
    return [key, { n: values.length, wins: values.filter(x => x.win).length,
      place: values.filter(x => x.place).length, top3: values.filter(x => x.top3).length,
      popularity: count(values.map(x => x.popularity)) }];
  }));
}
const agreement = rows.filter(r => r.independent!.horseId === r.market.horseId);
const disagreement = rows.filter(r => r.independent!.horseId !== r.market.horseId);
assert.equal(agreement.length + disagreement.length, 766);
function pairedHitCI(group: AuditRow[]) {
  let state = 20261010;
  const differences = group.map(r => Number(r.independent!.win) - Number(r.market.win));
  const samples = Array.from({ length: 10000 }, () => {
    let sum = 0;
    for (let i = 0; i < differences.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      sum += differences[Math.floor(state / 4294967296 * differences.length)];
    }
    return sum / differences.length;
  }).sort((a, b) => a - b);
  return [samples[249], samples[9749]];
}
const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.raceId.localeCompare(b.raceId));
const groups = {
  success: ordered.filter(r => !r.market.place && r.independent!.win),
  failure: ordered.filter(r => r.market.win && !r.independent!.place),
  outsiderPlace: ordered.filter(r => r.independent!.popularity >= 6 && r.independent!.place),
};
const selected = new Set(Object.values(groups).flatMap(g => g.slice(0, 3)).map(r => r.raceId));
const ids = ["81fdb93ff751d74efcf55c2df2a16a812e280c8d4a94920c766143862d607e5d",
  "3b2c2dce774c8980b0bfe1eb6b6da47cdd7291275b7e1c24a159c4ed9004debd",
  "d4566b178327a0f0bbda7bcd20016ec0f577d2d2123c672d83c041383c21ab5c"];
const cases: unknown[] = [];
for (const id of ids) {
  const run = loadRun(id);
  assert.deepEqual(run.sourceHashes, dataset.sourceHashes);
  for (const record of run.records) {
    const row = rows.find(r => r.raceId === record.raceId); assert(row);
    assert.equal(record.predictions.find(p => p.rank === 1)?.horseId, row.independent!.horseId);
    if (!selected.has(record.raceId)) continue;
    cases.push({ raceId: record.raceId, date: record.date,
      horses: [row.independent!, row.market].map(o => {
        const p = record.predictions.find(p => p.horseId === o.horseId)!;
        return { horseNumber: o.horseNumber, popularity: o.popularity, position: o.positionRaw,
          rank: p.rank, reasons: p.reasons.map(r => ({ name: r.name, contribution: r.contribution,
            value: (r.rawValue as { value: number | null }).value })),
          priorRaw: dataset.historyByHorse[o.horseId].filter(h => h.date < row.date && h.netKeibaRaceId !== row.raceId)
            .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).map(h => ({ date: h.date,
              surface: h.surface, raceName: h.raceName, positionRaw: h.positionRaw,
              marginRaw: h.marginRaw, final3fRaw: h.final3fRaw, cornerPositionsRaw: h.cornerPositionsRaw,
              carriedWeightRaw: h.carriedWeightRaw })) };
      }) });
  }
}
const unique = new Map<string, History>(), latest: (History | null)[] = [];
for (const race of dataset.races) for (const horse of race.starters) {
  const past = dataset.historyByHorse[horse.horseId].map((h, i) => ({ h, i }))
    .filter(({ h }) => h.date < race.date && h.netKeibaRaceId !== race.raceId);
  for (const { h, i } of past) unique.set(`${horse.horseId}/${i}`, h);
  latest.push([...past].sort((a, b) => b.h.date.localeCompare(a.h.date) || a.i - b.i)[0]?.h ?? null);
}
const history = [...unique.values()];
const patterns = { marginRaw: /^[+-]?\d+(?:\.\d+)?$/, final3fRaw: /^\d+(?:\.\d+)?$/,
  cornerPositionsRaw: /^\d+(?:-\d+)*$/, carriedWeightRaw: /^\d+(?:\.\d+)?$/ };
const quality = Object.fromEntries(Object.entries(patterns).map(([key, pattern]) => {
  const field = key as keyof typeof patterns;
  const valid = history.map(h => h[field]).filter((v): v is string => v !== null && pattern.test(v));
  const numeric = field === "cornerPositionsRaw" ? [] : valid.map(Number);
  return [key, { missing: history.filter(h => h[field] === null).length,
    invalid: count(history.map(h => h[field]).filter(v => v !== null && !pattern.test(v))),
    latestUnavailable: latest.filter(h => !h || h[field] === null || !pattern.test(h[field]!)).length,
    negative: numeric.filter(n => n < 0).length, zero: numeric.filter(n => n === 0).length,
    min: numeric.length ? Math.min(...numeric) : null, max: numeric.length ? Math.max(...numeric) : null }];
}));
const knownClass = history.filter(h => h.netKeibaRaceId && specs.get(h.netKeibaRaceId)?.date === h.date);
const opponents = new Map<string, Set<string>>();
for (const [key, h] of unique) if (h.netKeibaRaceId) {
  const k = `${h.netKeibaRaceId}/${h.date}`, set = opponents.get(k) ?? new Set<string>();
  set.add(key.split("/")[0]); opponents.set(k, set);
}
const fullCount = history.filter(h => h.netKeibaRaceId && h.fieldSize !== null &&
  opponents.get(`${h.netKeibaRaceId}/${h.date}`)?.size === h.fieldSize).length;
const allStoredOpponents = new Map<string, Set<string>>();
for (const [horseId, histories] of Object.entries(dataset.historyByHorse)) for (const h of histories) {
  if (!h.netKeibaRaceId) continue;
  const key = `${h.netKeibaRaceId}/${h.date}`, set = allStoredOpponents.get(key) ?? new Set<string>();
  set.add(horseId); allStoredOpponents.set(key, set);
}
const fullStoredCount = history.filter(h => h.netKeibaRaceId && h.fieldSize !== null &&
  allStoredOpponents.get(`${h.netKeibaRaceId}/${h.date}`)?.size === h.fieldSize).length;
const output = { sourceHashes: dataset.sourceHashes, savedRowsHash: sha256(rows),
  agreement: summarize(agreement), disagreement: summarize(disagreement),
  disagreementPairedWinDifferenceCI95: pairedHitCI(disagreement),
  groups: Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, { n: g.length,
    sampleRaceIds: g.slice(0, 3).map(r => r.raceId) }])), cases,
  quality: { races: dataset.races.length, uniqueHistory: history.length, starters: latest.length,
    raceKindWarnings: dataset.races.filter(r => r.raceName.includes("障害") && r.surface !== "障")
      .map(r => ({ raceId: r.raceId, date: r.date, raceName: r.raceName, surface: r.surface,
        predictionSaved: rows.some(row => row.raceId === r.raceId) })),
    noHistory: latest.filter(h => !h).length, fields: quality,
    cornerLengths: count(history.filter(h => h.cornerPositionsRaw !== null).map(h => h.cornerPositionsRaw!.split("-").length)),
    cornerInvalidAgainstFieldSize: history.filter(h => h.cornerPositionsRaw !== null && h.fieldSize !== null &&
      h.cornerPositionsRaw.split("-").some(v => Number(v) < 1 || Number(v) > h.fieldSize!)).length,
    positionSpecial: count(history.map(h => h.positionRaw).filter(v => v === null || !/^\d+$/.test(v))),
    currentWeightMissing: dataset.races.flatMap(r => r.starters).filter(h => h.carriedWeight === null).length,
    final3fRangeChecks: Object.fromEntries(["芝", "ダ", "障"].map(surface => [surface,
      { n: history.filter(h => h.surface === surface).length,
        below25: history.filter(h => h.surface === surface && h.final3fRaw !== null && Number(h.final3fRaw) < 25).length,
        above60: history.filter(h => h.surface === surface && h.final3fRaw !== null && Number(h.final3fRaw) > 60).length }])),
    rawSamples: history.slice(0, 3).map(h => ({ date: h.date, marginRaw: h.marginRaw,
      final3fRaw: h.final3fRaw, cornerPositionsRaw: h.cornerPositionsRaw, carriedWeightRaw: h.carriedWeightRaw })),
    knownPastClass: knownClass.length, opponentCountMatchesStrictUsedUnion: fullCount,
    opponentCountMatchesAllStoredDevelopmentHistory: fullStoredCount },
  modelFitted: false, predictionsGenerated: false };
assert.deepEqual(loadDevelopment().sourceHashes, dataset.sourceHashes);
assert.equal(agreement.length, 313); assert.equal(disagreement.length, 453);
assert.equal(rows.filter(r => r.independent!.win).length, 158);
assert.equal(rows.filter(r => r.market.win).length, 243);
assert.equal(history.length, 75733); assert.equal(latest.length, 18870);
assert.equal(cases.length, selected.size);
console.log(JSON.stringify(output, null, 2));
