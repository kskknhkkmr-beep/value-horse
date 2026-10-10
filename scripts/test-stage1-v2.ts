import assert from "node:assert/strict";
import test from "node:test";
import type { History, RaceSpec } from "./simulator/types";
import { prepareInput } from "./simulator/input";
import { prepareInputV2, isJraFlat } from "./stage1-v2-input";
import * as base from "./stage1-independent";
import { pairedRateCI } from "./stage1-v2-audit-core";
import type { AuditRow } from "./stage1-first-audit-core";
import { simulate } from "./simulator/stage1-v2-runner";
import type { Truth, Policy } from "./simulator/types";
import { derive, independentInput, assertIndependent, train, model, FEATURES, SETTINGS, parseKg } from "./stage1-independent-v2";
const row: History = {
  netKeibaRaceId: "202605010101", date: "2026-03-21", venue: "東京", venueRaw: "1東京1", raceName: "未勝利",
  weatherRaw: null, surface: "芝", distance: 1600, trackConditionRaw: null, fieldSize: 8,
  frameNumber: null, horseNumber: 1, positionRaw: "2", position: 2, marginRaw: null,
  raceTimeRaw: null, cornerPositionsRaw: "4-3", final3fRaw: null, jockey: null, jockeyId: null,
  carriedWeightRaw: "54", horseWeightRaw: null, oddsRaw: "99", popularity: 8
};
const starter = { horseId: "9000000001", horse: "test", horseNumber: 1, frameNumber: 1, sex: null,
  age: null, carriedWeight: 56, carriedWeightRaw: "56", jockey: null, jockeyId: null, trainer: null, trainerId: null };
const race: RaceSpec = { raceId: "202605020101", date: "2026-05-02", venue: "東京", raceNumber: 1,
  raceName: "未勝利", surface: "芝", distance: 1600, classRaw: null, structuredClass: null, grade: null, starters: [starter] };
const feature = (rows: History[], changes: Partial<RaceSpec> = {}) => derive(independentInput(prepareInputV2({ ...race, ...changes }, { "9000000001": rows }))).horses[0].features;

test("paired rate CI seed and exact-zero identical selections", () => {
  const outcome = { win: true, place: true };
  const rows = [{ independent: outcome, market: outcome, vh: outcome }] as AuditRow[];
  assert.deepEqual(pairedRateCI(rows, "independent", "vh").ci95, [0, 0]);
  assert.equal(pairedRateCI(rows, "independent", "market", "place").seed, 20261010);
  assert.throws(() => pairedRateCI([], "independent", "market"), /Incomplete/);
});

test("two new features have fixed units and legacy five values unchanged", () => {
  const v = feature([row]), old = base.derive(base.independentInput(prepareInput(race, { "9000000001": [row] }))).horses[0].features;
  assert.deepEqual(v.slice(0, 5).map(f => f.value), old.map(f => f.value));
  assert.equal(v[5].value, 5/7); assert.equal(v[6].value, .2);
  assert.equal(v[5].details?.used, 1); assert.equal(v[5].details?.candidates[0].segments, 2);
  assert.equal(FEATURES.length, 7);
  assert.deepEqual({ ...SETTINGS, version: base.SETTINGS.version }, base.SETTINGS);
});
test("latest-three chosen before validity; no fourth-run fallback", () => {
  const rows = [0,1,2,3].map(i => ({ ...row, date: `2026-03-${24-i}`, cornerPositionsRaw: i===3 ? "1" : "**" }));
  assert.equal(feature(rows)[5].value, null);
  assert.equal(feature(rows)[5].details?.candidates.length, 3);
});
test("1-4 intervals, special finish, zero/out-of-range and non-JRA cases", () => {
  for (const raw of ["1", "1-2", "1-2-3", "1-2-3-4"]) assert.notEqual(feature([{ ...row, cornerPositionsRaw: raw }])[5].value, null);
  for (const raw of ["**", "0-1", "1-9", "1-2-3-4-5", "1/2"]) assert.equal(feature([{ ...row, cornerPositionsRaw: raw }])[5].value, null);
  assert.throws(() => feature([{ ...row, cornerPositionsRaw: "" }]), /Expected text/);
  assert.equal(feature([{ ...row, position: null, positionRaw: "中" }])[5].value, null);
  assert.equal(isJraFlat({ ...row, venue: "大井" }), false);
  assert.equal(feature([{ ...row, netKeibaRaceId: null }])[5].value, null);
});
test("actual previous jump/unknown/local gives missing weight, never older substitute", () => {
  for (const prev of [{ ...row, surface: "障" }, { ...row, surface: null }, { ...row, venue: "大井" }]) {
    const f=feature([{ ...prev, date: "2026-04-25" }, row]);
    assert.equal(f[6].value, null); assert.match(f[6].missingReason!, /not confirmed/);
  }
  assert.equal(parseKg("**"), null); assert.equal(parseKg("55kg"), null);
  assert.equal(parseKg("54.5"), 54.5);
  assert.equal(feature([{ ...row, carriedWeightRaw: null }])[6].value, null);
  assert.equal(feature([{ ...row, position: null, positionRaw: "取" }])[6].value, null);
  assert.equal(feature([row, { ...row, netKeibaRaceId: "202605010102" }])[6].value, null);
  assert.equal(feature([row], { starters: [{ ...starter, carriedWeight: 57 }] })[6].value, null);
});
test("future/same-day/target history and market values cannot influence input", () => {
  const a=independentInput(prepareInputV2(race, { "9000000001": [row] }));
  const b=independentInput(prepareInputV2(race, { "9000000001": [
    { ...row, oddsRaw: "1.1", popularity: 1 }, { ...row, date: race.date },
    { ...row, date: "2026-06-21" }, { ...row, netKeibaRaceId: race.raceId }] }));
  assert.deepEqual(a,b);
  assert.throws(() => assertIndependent({ ...a, odds: 3 } as typeof a), /Unapproved/);
  assert.throws(() => assertIndependent({ ...a, horses: [{ ...a.horses[0], history: [{ ...a.horses[0].history[0], date: race.date }] }] }), /Future/);
  assert.equal("oddsRaw" in a.horses[0].history[0], false);
});
test("non-flat numeric bypass and obstacle targets are rejected", () => {
  const a=independentInput(prepareInputV2(race, { "9000000001": [{ ...row, surface: "障" }] }));
  assert.equal(a.horses[0].history[0].carriedWeightRaw, null);
  assert.throws(() => assertIndependent({ ...a, horses: [{ ...a.horses[0], history: [{ ...a.horses[0].history[0], position: 1 }] }] }), /Non-flat/);
  assert.throws(() => feature([row], { surface: "障" }), /Flat model/);
});
test("fixed fit deterministic, version guard and all contribution sums reproduce probabilities", () => {
  const training=derive(independentInput(prepareInputV2({ ...race, date: "2026-04-04" }, { "9000000001": [row] })));
  const ex=[{ input: training, winnerId: starter.horseId }];
  const a=train(ex,"2026-04-04"), b=train(ex,"2026-04-04"); assert.deepEqual(a,b);
  assert.equal(a.weights.length,14);
  const m=model(a,"0".repeat(64)), input=prepareInputV2({ ...race, raceId: "202605020102" }, { "9000000001": [row] });
  const output=m.predict(input,{seed:0,random:()=>0});
  assert.equal(output[0].reasons.length,14); assert.equal(output[0].probability,1);
  assert.deepEqual(output,m.predict(input,{seed:0,random:()=>0}));
  assert.throws(()=>model({ ...a, settings: { ...a.settings, version: "old" } } as typeof a,"0".repeat(64)), /mismatch/);
  assert.throws(()=>m.predict(prepareInputV2(race,{ "9000000001": [row] }),{seed:0,random:()=>0}), /In-sample/);
});

test("v2 simulator joins truth only after prediction; target outcome and prices cannot change picks", () => {
  const training=derive(independentInput(prepareInputV2({ ...race, date:"2026-04-04" },{"9000000001":[row]})));
  const artifact=train([{input:training,winnerId:starter.horseId}],"2026-04-04");
  const target={...race,raceId:"202605020102"},identity={name:"no-bets",version:"v1",codeSha256:"0".repeat(64),trainedThroughDate:null,config:{}};
  const policy:Policy={identity,tickets:()=>[]};
  const unavailable={status:"not_offered" as const,rawCombination:null,rawPayout:null,entries:[]};
  const truth:Truth={raceId:target.raceId,date:target.date,archivedStartTime:null,
    horses:[{horseId:starter.horseId,horseNumber:1,positionRaw:"1",raceTimeRaw:null,marginRaw:null,
      final3fRaw:null,cornerPositionsRaw:null,finalOddsRaw:"2",popularity:1}],
    payouts:{tan:unavailable,fuku:unavailable,wide:unavailable,umaren:unavailable,umatan:unavailable,sanfuku:unavailable,santan:unavailable}};
  const data={races:[target],historyByHorse:{"9000000001":[row]},truthByRace:{[target.raceId]:truth},sourceHashes:{},constraints:[]};
  const m=model(artifact,"0".repeat(64));
  const a=simulate(data,m,policy,0,"0".repeat(64));
  const changed={...truth,horses:truth.horses.map(h=>({...h,positionRaw:"9",finalOddsRaw:"99",popularity:9}))};
  const b=simulate({...data,truthByRace:{[target.raceId]:changed}},m,policy,0,"0".repeat(64));
  assert.deepEqual(a.records[0].predictions,b.records[0].predictions);
  assert.equal(a.inputSha256,b.inputSha256);assert.notEqual(a.truthSha256,b.truthSha256);
});
