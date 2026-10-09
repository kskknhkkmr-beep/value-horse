/** Synthetic fixtures only: no actual development performance evaluation. */
import assert from "node:assert/strict";
import { canonical, sha256 } from "./simulator/canonical";
import { prepareInput } from "./simulator/input";
import { simulate } from "./simulator/runner";
import type { Dataset, History, Policy, RaceSpec, Truth } from "./simulator/types";
import { assertIndependent, derive, independentInput, model, SETTINGS, softmax, train, trainingExample, unsupported } from "./stage1-independent";
import { WINDOWS } from "./run-stage1-independent";

let count = 0;
const test = (name: string, f: () => void) => { f(); count++; console.log(`PASS ${name}`); };
const past: History = { netKeibaRaceId: "202500000001", date: "2026-01-01", venueRaw: null,
  venue: null, raceName: null, weatherRaw: null, surface: "芝", distance: 1200, trackConditionRaw: null,
  fieldSize: 3, frameNumber: null, horseNumber: null, positionRaw: "1", position: 1,
  marginRaw: null, raceTimeRaw: null, cornerPositionsRaw: null, final3fRaw: null, jockey: null,
  jockeyId: null, carriedWeightRaw: null, horseWeightRaw: null, oddsRaw: "1.1", popularity: 1 };
const race: RaceSpec = { raceId: "202600000001", date: "2026-02-07", venue: "synthetic", raceNumber: 1,
  raceName: "fixture", surface: "芝", distance: 1200, classRaw: null, structuredClass: null, grade: null,
  starters: [1, 2, 3].map(n => ({ horseId: `900000000${n}`, horse: `fixture${n}`, horseNumber: n,
    frameNumber: n, sex: "牝", age: 3, carriedWeight: 55, carriedWeightRaw: "55", jockey: null,
    jockeyId: null, trainer: null, trainerId: null })) };
const histories = Object.fromEntries(race.starters.map((h, i) => [h.horseId,
  [{ ...past, position: i + 1, positionRaw: `${i + 1}` }]]));
const truth: Truth = { raceId: race.raceId, date: race.date, archivedStartTime: null,
  horses: race.starters.map((h, i) => ({ horseId: h.horseId, horseNumber: h.horseNumber,
    positionRaw: `${i + 1}`, raceTimeRaw: null, marginRaw: null, final3fRaw: null,
    cornerPositionsRaw: null, finalOddsRaw: "2.0", popularity: i + 1 })),
  payouts: Object.fromEntries(["tan", "fuku", "wide", "umaren", "umatan", "sanfuku", "santan"].map(k =>
    [k, { status: "missing", rawCombination: null, rawPayout: null, entries: [] }])) as unknown as Truth["payouts"] };
const featured = derive(independentInput(prepareInput(race, histories)));
const example = trainingExample(featured, truth, "2026-03-29");
if (typeof example === "string") throw new Error(example);
const artifact = train([example], "2026-03-29");
const fitted = model(artifact, sha256("synthetic-stage1"));
const target = { ...race, raceId: "202600000002", date: "2026-04-04" };
const input = prepareInput(target, histories);

test("feature formula, provenance, missing distinction and raw status exclusion", () => {
  assert.equal(featured.horses[0].features[0].value, 1);
  assert.equal(featured.horses[1].features[0].value, 0.5);
  assert.equal(featured.horses[2].features[0].value, 0);
  assert.equal(featured.horses[0].features[4].value, 37 / 365);
  const special = { ...histories, [race.starters[0].horseId]: [{ ...past, positionRaw: "中", position: 3 }] };
  const f = derive(independentInput(prepareInput(race, special))).horses[0].features[0];
  assert.equal(f.value, null); assert.equal(f.missingReason, "no valid matching finish");
  const empty = { ...histories, [race.starters[0].horseId]: [] };
  assert.equal(derive(independentInput(prepareInput(race, empty))).horses[0].features[0].missingReason, "no prior history");
});
test("chronological latest-three selection ignores input ordering", () => {
  const rows = [1, 2, 3, 4].map((n) => ({ ...past, date: `2026-01-0${n}`, position: n === 1 ? 3 : 1,
    positionRaw: n === 1 ? "3" : "1", netKeibaRaceId: `20250000000${n}` }));
  const a = derive(independentInput(prepareInput(race, Object.fromEntries(race.starters.map(h => [h.horseId, rows])))));
  const b = derive(independentInput(prepareInput(race, Object.fromEntries(race.starters.map(h => [h.horseId, [...rows].reverse()])))));
  assert.equal(a.horses[0].features[0].value, 1); assert.equal(canonical(a), canonical(b));
});
test("same-day/future/target histories cannot influence predictions", () => {
  const changed = Object.fromEntries(Object.entries(histories).map(([id, rows]) => [id, [...rows,
    { ...past, date: target.date }, { ...past, date: "2026-06-21" },
    { ...past, netKeibaRaceId: target.raceId }]]));
  assert.equal(canonical(fitted.predict(input, { seed: 0, random: () => 0 })),
    canonical(fitted.predict(prepareInput(target, changed), { seed: 0, random: () => 0 })));
  const leaked = JSON.parse(canonical(independentInput(input)));
  leaked.horses[0].history[0].date = target.date;
  assert.throws(() => derive(leaked));
});
test("market columns absent at second boundary and price perturbations invariant", () => {
  const changed = Object.fromEntries(Object.entries(histories).map(([id, rows]) => [id,
    rows.map(r => ({ ...r, oddsRaw: "999.0", popularity: 99, raceName: "changed" }))]));
  const projected = independentInput(input);
  assert.equal(canonical(projected), canonical(independentInput(prepareInput(target, changed))));
  assert.throws(() => assertIndependent({ ...projected, odds: 1 } as typeof projected));
  const injected = JSON.parse(canonical(projected)); injected.horses[0].history[0].popularity = 1;
  assert.throws(() => derive(injected));
  assert.throws(() => independentInput({ ...input, payouts: {} } as typeof input));
});
test("fixed optimizer is deterministic and missing imputation is training-only", () => {
  assert.equal(canonical(artifact), canonical(train([example], "2026-03-29")));
  assert.equal(artifact.means[0], 0.5); assert.equal(artifact.weights.length, 10);
  assert.equal(SETTINGS.iterations, 200); assert.equal(SETTINGS.learningRate, 0.1);
  const missing = prepareInput(target, { ...histories, [target.starters[0].horseId]: [] });
  const p = fitted.predict(missing, { seed: 0, random: () => 0 });
  assert.equal(p[0].reasons[0].rawValue && (p[0].reasons[0].rawValue as { trainingMean: number }).trainingMean, 0.5);
  assert.equal(p[0].reasons[5].contribution, artifact.weights[5]);
});
test("training cutoffs, duplicate races, same-race reuse and sealed target dates rejected", () => {
  assert.throws(() => train([example], "2026-02-06"));
  assert.throws(() => train([example, example], "2026-03-29"));
  assert.throws(() => trainingExample({ ...featured, date: "2026-04-04" }, truth, "2026-03-29"));
  assert.throws(() => fitted.predict(prepareInput(race, histories), { seed: 0, random: () => 0 }));
  assert.throws(() => fitted.predict({ ...input, raceId: race.raceId }, { seed: 0, random: () => 0 }));
  assert.throws(() => independentInput({ ...input, date: "2026-06-27" }));
  assert.throws(() => train([{ ...example, input: { ...featured, horses: featured.horses.map(h => ({ ...h,
    features: h.features.map(f => ({ ...f, sourceRows: f.sourceRows.map(r => ({ ...r, date: race.date })) })) })) } }], "2026-03-29"));
});
test("dead heat excluded from training, unknown races and obstacles abstain", () => {
  assert.equal(typeof trainingExample(featured, { ...truth, horses: truth.horses.map(h => ({ ...h, positionRaw: "1" })) }, "2026-03-29"), "string");
  assert.ok(unsupported(featured, "障害"));
  assert.equal(unsupported(featured, "ダ"), null);
  const allEmpty = Object.fromEntries(race.starters.map(h => [h.horseId, []]));
  assert.ok(unsupported(derive(independentInput(prepareInput(target, allEmpty))), "芝"));
  assert.throws(() => fitted.predict(prepareInput(target, allEmpty), { seed: 0, random: () => 0 }));
});
test("score decomposition reproduces probabilities and normalized all-starter outputs", () => {
  const p = fitted.predict(input, { seed: 0, random: () => 0 });
  const expected = softmax(p.map(h => h.reasons.reduce((s, r) => s + r.contribution!, 0)));
  assert.deepEqual(p.map(h => h.probability), expected);
  assert.ok(Math.abs(p.reduce((s, h) => s + h.probability, 0) - 1) < 1e-12);
  assert.ok(p.every(h => h.reasons.length === 10));
});
test("simulator connection: target outcome/market changes do not affect prediction", () => {
  const actual = { ...truth, raceId: target.raceId, date: target.date };
  const dataset: Dataset = { races: [target], historyByHorse: histories,
    truthByRace: { [target.raceId]: actual }, sourceHashes: { fixture: sha256("fixture") }, constraints: [] };
  const policy: Policy = { identity: { ...fitted.identity, trainedThroughDate: null }, tickets: () => [] };
  const a = simulate(dataset, fitted, policy, 0, sha256("runtime"));
  const changed = { ...actual, horses: actual.horses.map(h => ({ ...h, positionRaw: "99", finalOddsRaw: "999", popularity: 99 })) };
  const b = simulate({ ...dataset, truthByRace: { [target.raceId]: changed } }, fitted, policy, 0, sha256("runtime"));
  assert.deepEqual(a.records[0].predictions, b.records[0].predictions);
  assert.notEqual(a.truthSha256, b.truthSha256); assert.deepEqual(a.records[0].tickets, []);
  assert.equal(canonical(a), canonical(simulate(dataset, fitted, policy, 0, sha256("runtime"))));
});
test("calendar windows fixed, with strictly earlier training and no random split", () => {
  assert.equal(WINDOWS.reduce((s, w) => s + w.targetCount, 0), 792);
  assert.ok(WINDOWS.every(w => w.cutoff < w.start && w.end <= "2026-06-21"));
});
console.log(`${count} synthetic Stage 1 tests passed; no actual performance evaluated.`);
