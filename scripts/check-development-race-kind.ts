/** Structural domain audit only. No training, prediction, settlement or performance metrics. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadDevelopment, prepareInput } from "./simulator/input";
import { flatExclusionReason, RACE_KIND_VERSION } from "./simulator/race-kind";
import { WINDOWS } from "./run-stage1-independent";
if (process.argv.length !== 2) throw new Error("No custom paths/conditions accepted");
const dataset = loadDevelopment(), logs = dataset.classification!.races;
const count = (values: string[]) => values.reduce<Record<string, number>>((a, s) => { a[s] = (a[s] ?? 0) + 1; return a; }, {});
const corrected = logs.filter(r => r.storedSurface !== r.kind), excluded = logs.filter(r => r.exclusionReason !== null);
let inputHistoryRows = 0, excludedHistoryRows = 0, noFlatHistoryRaces = 0;
for (const race of dataset.races.filter(r => flatExclusionReason(r) === null)) {
  const input = prepareInput(race, dataset.historyByHorse);
  const before = race.starters.reduce((n, s) => n + dataset.historyByHorse[s.horseId]
    .filter(h => h.date < race.date && h.netKeibaRaceId !== race.raceId).length, 0);
  const after = input.horses.reduce((n, h) => n + h.history.length, 0);
  inputHistoryRows += after; excludedHistoryRows += before - after;
  assert(input.horses.every(h => h.history.every(r => ["芝", "ダ"].includes(r.surface!) && r.date < race.date)));
  if (input.horses.every(h => !h.history.some(r => r.positionRaw !== null && /^\d+$/.test(r.positionRaw) &&
    r.position === Number(r.positionRaw) && r.fieldSize !== null && r.fieldSize >= 2 &&
    r.position !== null && r.position >= 1 && r.position <= r.fieldSize))) noFlatHistoryRaces++;
}
for (const [file, hash] of Object.entries(dataset.sourceHashes)) {
  assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), hash);
}
assert.equal(logs.length, 1338); assert.equal(corrected.length, 29);
assert(corrected.every(r => r.storedSurface === "芝" && r.kind === "障"));
assert.equal(logs.filter(r => r.kind === "unknown").length, 0);
console.log(JSON.stringify({ classificationVersion: RACE_KIND_VERSION, developmentRaces: logs.length,
  before: count(logs.map(r => r.storedSurface)), after: count(logs.map(r => r.kind)),
  flatRacesBefore: logs.filter(r => ["芝", "ダ"].includes(r.storedSurface)).length,
  flatRacesAfter: logs.filter(r => flatExclusionReason({ surface: r.kind }) === null).length,
  corrected, excluded, inputHistoryRows, excludedHistoryRows, noFlatHistoryRaces,
  windows: WINDOWS.map(w => ({ name: w.name,
    trainingFlatBefore: logs.filter(r => r.date <= w.cutoff && ["芝", "ダ"].includes(r.storedSurface)).length,
    trainingFlatAfter: logs.filter(r => r.date <= w.cutoff && ["芝", "ダ"].includes(r.kind)).length,
    targetFlatBefore: logs.filter(r => r.date >= w.start && r.date <= w.end && ["芝", "ダ"].includes(r.storedSurface)).length,
    targetFlatAfter: logs.filter(r => r.date >= w.start && r.date <= w.end && ["芝", "ダ"].includes(r.kind)).length })),
  sourceHashes: dataset.sourceHashes, fitted: false, predictionsGenerated: false }, null, 2));
