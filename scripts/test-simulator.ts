/** All predictions/financial calculations in this file use synthetic fixtures only. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, frozenClone, isoDate, sha256 } from "./simulator/canonical";
import { assertInputPath, prepareInput } from "./simulator/input";
import { assertPreRaceInput, compareRuns, marketTopN, simulate, validateTickets } from "./simulator/runner";
import { metrics, settleRun, settleTicket } from "./simulator/settlement";
import { loadRun, saveRun, simulatorFingerprint, verifyRun } from "./simulator/store";
import type { Dataset, History, Model, Payout, Policy, RaceSpec, Starter, Ticket, TicketKind, Truth, Version } from "./simulator/types";

let tests = 0;
function test(name: string, check: () => void) { check(); tests++; console.log(`PASS ${name}`); }
const identity: Version = { name: "synthetic-test-double", version: "1", codeSha256: sha256("test-double"), config: {}, trainedThroughDate: null };
const horseIds = ["9000000001", "9000000002", "9000000003"];
const starters: Starter[] = horseIds.map((horseId, i) => ({ horseId, horse: `fixture-${i}`, horseNumber: i + 1,
  frameNumber: i + 1, sex: "牝", age: 3, carriedWeight: 55, carriedWeightRaw: "55", jockey: null,
  jockeyId: null, trainer: null, trainerId: null }));
const races: RaceSpec[] = ["2026-02-07", "2026-02-08", "2026-02-14"].map((date, i) => ({
  raceId: `20990000000${i + 1}`, date, venue: "synthetic", raceNumber: i + 1, raceName: "fixture",
  surface: "芝", distance: 1200, classRaw: null, structuredClass: null, grade: null, starters }));
const past: History = { netKeibaRaceId: null, date: "2026-01-01", venueRaw: null, venue: null,
  raceName: null, weatherRaw: null, surface: "芝", distance: 1200, trackConditionRaw: null, fieldSize: 3,
  frameNumber: null, horseNumber: null, positionRaw: "中", position: null, marginRaw: "クビ",
  raceTimeRaw: "1:12.3", cornerPositionsRaw: "10-9-9-8", final3fRaw: "**", jockey: null,
  jockeyId: null, carriedWeightRaw: "55", horseWeightRaw: "計不", oddsRaw: "5.0", popularity: null };
const payout = (horse: number, amount: number): Payout => ({ status: "ok", rawCombination: `${horse}`, rawPayout: `${amount}`, entries: [{ horse, payout: amount }] });
const truths: Truth[] = races.map((race, i) => ({ raceId: race.raceId, date: race.date, archivedStartTime: "10:00",
  horses: horseIds.map((horseId, n) => ({ horseId, horseNumber: n + 1, positionRaw: `${n + 1}`,
    raceTimeRaw: null, marginRaw: null, final3fRaw: null, cornerPositionsRaw: null,
    finalOddsRaw: ["4.0", "2.0", "9.0"][n], popularity: [2, 1, 3][n] })),
  payouts: Object.fromEntries(["tan", "fuku", "wide", "umaren", "umatan", "sanfuku", "santan"].map((kind) =>
    [kind, payout(i === 1 ? 2 : 1, i === 0 ? 300 : i === 1 ? 200 : 400)])) as Record<TicketKind, Payout> }));
const dataset: Dataset = { races, historyByHorse: Object.fromEntries(horseIds.map((id) => [id, [past]])),
  truthByRace: Object.fromEntries(truths.map((t) => [t.raceId, t])), sourceHashes: { synthetic: sha256("fixture") }, constraints: ["synthetic only"] };
// Fixed outputs test orchestration; this is NOT a proposed prediction model or betting strategy.
const model: Model = { identity, predict: (input) => input.horses.map((h, i) => ({ horseId: h.horseId,
  probability: [0.6, 0.3, 0.1][i], reasons: [{ name: "fixture-constant", rawValue: i, contribution: null, explanation: "test only" }] })) };
const policy: Policy = { identity, tickets: () => [{ kind: "tan", horses: [1], stakeYen: 100 }] };
const fingerprint = simulatorFingerprint();
const run = () => simulate(dataset, model, policy, 123, fingerprint);

test("history excludes same day/future/target race, preserving raw past", () => {
  const rows = [past, { ...past, date: "2026/02/07" }, { ...past, date: "2026-02-08" },
    { ...past, date: "2026-01-01", netKeibaRaceId: races[0].raceId }];
  const input = prepareInput(races[0], Object.fromEntries(horseIds.map((id) => [id, rows])));
  assert.equal(input.horses[0].history.length, 1);
  assert.equal(input.horses[0].history[0].cornerPositionsRaw, "10-9-9-8");
  assert.equal(input.horses[0].history[0].horseWeightRaw, "計不");
  assertPreRaceInput(input);
});
test("injected current labels, odds, popularity and body weight are dropped", () => {
  const injected = { ...races[0], odds: 1.1, result: { position: 1 }, labels: { payout: 1000 },
    starters: starters.map((h) => ({ ...h, odds: 1.1, popularity: 1, result: {}, horseWeightRaw: "510(-2)" })) };
  const input = prepareInput(injected, dataset.historyByHorse);
  assert.equal("labels" in input, false);
  for (const h of input.horses) for (const field of ["odds", "popularity", "result", "horseWeightRaw"]) assert.equal(field in h, false);
  assert.throws(() => assertPreRaceInput({ ...input, labels: {} } as typeof input));
  const changed = JSON.parse(canonical(input)); changed.horses[0].history[0].date = input.date;
  assert.throws(() => assertPreRaceInput(changed));
});
test("target dates outside development and invalid dates rejected", () => {
  assert.throws(() => prepareInput({ ...races[0], date: "2026-06-27" }, dataset.historyByHorse));
  assert.throws(() => isoDate("2026-02-30"));
  assert.throws(() => prepareInput(races[0], {}));
});
test("sealed/full-source paths rejected BEFORE filesystem inspection", () => {
  assert.throws(() => assertInputPath(".sealed-data/DO-NOT-READ.json"));
  assert.throws(() => assertInputPath("lib/backfill/scores-cache-v2.json"));
  assert.throws(() => assertInputPath("lib/results-cache.json"));
});
test("same inputs/seed/identities reproduce identical run bytes", () => {
  assert.equal(canonical(run()), canonical(run()));
  assert.equal(sha256({ a: 1, b: 2 }), sha256({ b: 2, a: 1 }));
  const randomModel: Model = { identity, predict: (input, context) => {
    const p = context.random();
    return input.horses.map((h, i) => ({ horseId: h.horseId, probability: [p, 1 - p, 0][i], reasons: [] }));
  } };
  assert.equal(simulate(dataset, randomModel, policy, 9, fingerprint).runId, simulate(dataset, randomModel, policy, 9, fingerprint).runId);
});
test("future trained weights are rejected", () => {
  assert.throws(() => simulate(dataset, { ...model, identity: { ...identity, trainedThroughDate: "2026-02-07" } }, policy, 1, fingerprint));
});
test("non-deterministic outputs and invalid probabilities rejected", () => {
  let count = 0;
  const unstable: Model = { identity, predict: (input) => { count++; return input.horses.map((h, i) => ({
    horseId: h.horseId, probability: [0.5 + count / 100, 0.5 - count / 100, 0][i], reasons: [] })); } };
  assert.throws(() => simulate(dataset, unstable, policy, 1, fingerprint));
  assert.throws(() => simulate(dataset, { ...model, predict: () => [] }, policy, 1, fingerprint));
  assert.throws(() => simulate(dataset, { ...model, predict: (input) => input.horses.map((h) => ({ horseId: h.horseId, probability: 0.1, reasons: [] })) }, policy, 1, fingerprint));
});
test("truth immutable; changing future truth does not change predictions", () => {
  const a = run();
  assert.throws(() => { a.records[0].actual.horses[0].positionRaw = "99"; });
  const changed = JSON.parse(canonical(dataset)) as Dataset;
  changed.truthByRace[races[0].raceId].horses[0].positionRaw = "99";
  changed.truthByRace[races[0].raceId].horses[0].finalOddsRaw = "99.0";
  const b = simulate(changed, model, policy, 123, fingerprint);
  assert.equal(a.inputSha256, b.inputSha256);
  assert.deepEqual(a.records.map((r) => r.predictions), b.records.map((r) => r.predictions));
  assert.notEqual(a.truthSha256, b.truthSha256);
  assert.throws(() => compareRuns(a, b));
});
test("version/policy runs retained and comparably identified", () => {
  const a = run(), b = simulate(dataset, model, { ...policy, identity: { ...identity, version: "2" },
    tickets: () => [{ kind: "tan", horses: [2], stakeYen: 100 }] }, 123, fingerprint);
  assert.notEqual(a.runId, b.runId);
  assert.ok(compareRuns(a, b).every((r) => !r.predictionsChanged && r.ticketsChanged));
});
test("final-market top N stays outside prediction inputs", () => {
  assert.deepEqual(marketTopN(truths[0], 2, [1, 2, 3]).map((h) => h.horseNumber), [2, 1]);
  const missing = frozenClone(truths[0]);
  assert.throws(() => marketTopN({ ...missing, horses: missing.horses.map((h) => ({ ...h, finalOddsRaw: null })) }, 1, [1, 2, 3]));
});
test("all seven ticket kinds; ordered vs unordered and dead heats", () => {
  for (const kind of ["tan", "fuku", "wide", "umaren", "umatan", "sanfuku", "santan"] as TicketKind[]) {
    const n = kind === "tan" || kind === "fuku" ? 1 : kind === "sanfuku" || kind === "santan" ? 3 : 2;
    const numbers = [1, 2, 3].slice(0, n);
    const p: Payout = { status: "ok", rawCombination: null, rawPayout: null,
      entries: n === 1 ? [{ horse: 1, payout: 300 }, { horse: 2, payout: 400 }] : [{ combo: numbers, payout: 300 }] };
    const truth = { ...truths[0], payouts: { ...truths[0].payouts, [kind]: p } };
    const ticket: Ticket = { kind, horses: numbers, stakeYen: 200 };
    assert.equal(settleTicket(ticket, truth).returnYen, 600);
    if (n === 1) assert.equal(settleTicket({ ...ticket, horses: [2] }, truth).returnYen, 800);
    else assert.equal(settleTicket({ ...ticket, horses: [...numbers].reverse() }, truth).status,
      ["umatan", "santan"].includes(kind) ? "loss" : "win");
  }
});
test("bad tickets, missing/refund/parse issues never silently become losses", () => {
  const input = prepareInput(races[0], dataset.historyByHorse);
  assert.throws(() => validateTickets([{ kind: "wide", horses: [1, 1], stakeYen: 100 }], input));
  assert.throws(() => validateTickets([{ kind: "tan", horses: [1], stakeYen: 101 }], input));
  const ticket: Ticket = { kind: "tan", horses: [1], stakeYen: 100 };
  for (const status of ["missing", "refund", "not_offered", "unparsed"] as const) {
    const truth = { ...truths[0], payouts: { ...truths[0].payouts, tan: { ...truths[0].payouts.tan, status } } };
    const s = settleTicket(ticket, truth);
    assert.equal(s.status, "unresolved");
    assert.throws(() => metrics([{ raceId: truth.raceId, date: truth.date, archivedStartTime: "10:00", settlements: [s] }]));
  }
  const refunded = settleTicket(ticket, { ...truths[0], refunds: [{ kind: "tan", horses: [1], evidence: "synthetic verified refund" }] });
  assert.equal(refunded.profitYen, 0);
});
test("yen P&L, net ROI, DD, miss streak and hit interval arithmetic", () => {
  const m = metrics(settleRun(run()));
  assert.equal(m.grossStakeYen, 300); assert.equal(m.returnYen, 700); assert.equal(m.profitYen, 400);
  assert.equal(m.roiNet, 400 / 300); assert.equal(m.maxDrawdownYen, 100);
  assert.equal(m.raceHitRate, 2 / 3); assert.equal(m.maxNoHitStreak, 1);
  assert.deepEqual(m.hitIntervals[0], { fromRaceId: races[0].raceId, toRaceId: races[2].raceId, raceGap: 2, betRaceGap: 2, calendarDays: 7 });
  assert.equal(metrics([]).roiNet, null);
});
test("append-only saved runs; hashes detect tampering (temporary fixture workspace)", () => {
  const current = process.cwd(), temp = mkdtempSync(join(tmpdir(), "value-horse-simulator-test-"));
  const fixture = run(); let path = "";
  try {
    process.chdir(temp); mkdirSync("lib");
    path = saveRun(fixture);
    assert.deepEqual(loadRun(fixture.runId), fixture);
    assert.throws(() => saveRun(fixture));
    const original = readFileSync(join(path, "run.json"), "utf8");
    writeFileSync(join(path, "run.json"), original.replace("fixture-constant", "tampered-constant"));
    assert.throws(() => loadRun(fixture.runId));
    assert.throws(() => loadRun("../outside"));
    verifyRun(fixture);
  } finally {
    process.chdir(current);
    if (path) { unlinkSync(join(path, "run.json")); unlinkSync(join(path, "manifest.json")); rmdirSync(path); }
    rmdirSync(join(temp, "lib", "simulation-runs")); rmdirSync(join(temp, "lib")); rmdirSync(temp);
  }
});
console.log(`${tests} synthetic simulator tests passed. No development performance evaluation executed.`);
