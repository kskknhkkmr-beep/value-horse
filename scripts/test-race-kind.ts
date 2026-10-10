/** Synthetic regression tests; no dataset reads, fitting or metrics. */
import assert from "node:assert/strict";
import { classifyRaceKind, flatExclusionReason } from "./simulator/race-kind";
import { prepareInput } from "./simulator/input";
import { assertPreRaceInput } from "./simulator/runner";
import { assertIndependent, derive, independentInput, model } from "./stage1-independent";
import type { Artifact } from "./stage1-independent";
import type { History, RaceSpec } from "./simulator/types";

let passed = 0;
function test(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
const race: RaceSpec = { raceId: "202600000001", date: "2026-04-05", venue: "synthetic", raceNumber: 1,
  raceName: "flat fixture", surface: "芝", distance: 1200, classRaw: null, structuredClass: null, grade: null,
  starters: [{ horseId: "9000000001", horse: "fixture", horseNumber: 1, frameNumber: 1, sex: "牡", age: 4,
    carriedWeight: 57, carriedWeightRaw: "57", jockey: null, jockeyId: null, trainer: null, trainerId: null }] };
const past: History = { netKeibaRaceId: "202500000001", date: "2026-01-01", venueRaw: null, venue: null,
  raceName: "flat fixture", weatherRaw: null, surface: "芝", distance: 1200, trackConditionRaw: null,
  fieldSize: 2, frameNumber: 1, horseNumber: 1, position: 2, positionRaw: "2", marginRaw: null,
  raceTimeRaw: null, cornerPositionsRaw: null, final3fRaw: null, jockey: null, jockeyId: null,
  carriedWeightRaw: null, horseWeightRaw: null, oddsRaw: null, popularity: null };
const history = { "9000000001": [past] };
test("flat turf, dirt and stored jumps", () => {
  assert.equal(classifyRaceKind({ surface: "芝" }).kind, "芝");
  assert.equal(classifyRaceKind({ surface: "ダート" }).kind, "ダ");
  assert.equal(classifyRaceKind({ surface: "障" }).kind, "障");
});
test("legacy regex misreads mixed jump header; jump marker wins", () => {
  const header = "障芝 ダート2880m";
  assert.equal(header.match(/(芝|ダ|障)[^<]{0,4}?(\d{3,4})m/)![1], "芝");
  assert.equal(classifyRaceKind({ surface: "芝", courseRaw: header }).kind, "障");
});
test("explicit name, class, jump title and normalized jump grades", () => {
  for (const source of [{ raceName: "障害4歳以上未勝利" }, { classRaw: "障害3歳以上オープン" },
    { raceName: "東京ジャンプS" }, { grade: "ＪＧⅡ" }, { raceName: "中山グランドジャンプ(JGI)" }]) {
    assert.equal(classifyRaceKind({ surface: "芝", ...source }).kind, "障");
  }
});
test("flat grade and ambiguous/missing metadata do not fabricate a kind", () => {
  assert.equal(classifyRaceKind({ surface: "芝", raceName: "flat", grade: "GIII" }).kind, "芝");
  assert.equal(classifyRaceKind({ surface: "芝", raceName: "障害", grade: "GI" }).kind, "unknown");
  assert.equal(classifyRaceKind({ surface: null }).kind, "unknown");
  assert.equal(classifyRaceKind({ surface: "芝", courseRaw: "芝ダ1600m" }).kind, "unknown");
  assert.equal(classifyRaceKind({ surface: "芝", courseRaw: "ダ1600m" }).kind, "unknown");
  assert.match(flatExclusionReason({ surface: null })!, /unknown/);
});
test("target corrected without mutating raw; exclusion records evidence", () => {
  const jump = { ...race, raceName: "障害4歳以上未勝利" };
  const input = prepareInput(jump, history);
  assert.equal(jump.surface, "芝"); assert.equal(input.surface, "障");
  assert.match(flatExclusionReason(jump)!, /race name/);
  assert.throws(() => independentInput(input), /Flat model/);
  assert.throws(() => assertPreRaceInput({ ...input, surface: "芝" }), /Uncorrected/);
});
test("flat histories remove explicit and misclassified jumps and unknown kind", () => {
  const rows = [past, { ...past, surface: "障" }, { ...past, raceName: "障害未勝利" },
    { ...past, surface: null, raceName: null }];
  const input = prepareInput(race, { "9000000001": rows });
  assert.equal(input.horses[0].history.length, 1); assert.equal(rows.length, 4);
  assert.equal(derive(independentInput(input)).horses[0].features[0].value, 0);
  const bypass = independentInput(input);
  assert.throws(() => assertIndependent({ ...bypass, horses: [{ ...bypass.horses[0],
    history: [{ ...bypass.horses[0].history[0], surface: "障" }] }] }), /jump\/unknown history/);
});
test("same-day, future and target IDs remain excluded", () => {
  const rows = [past, { ...past, date: race.date }, { ...past, date: "2026-06-21" },
    { ...past, netKeibaRaceId: race.raceId }];
  assert.equal(prepareInput(race, { "9000000001": rows }).horses[0].history.length, 1);
});
test("legacy trained artifact cannot run on corrected inputs", () => {
  assert.throws(() => model({} as Artifact, "0".repeat(64)), /Legacy classification artifact/);
});
console.log(`${passed} classification tests passed; no real predictions evaluated.`);
