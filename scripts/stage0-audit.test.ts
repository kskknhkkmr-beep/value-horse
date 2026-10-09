import test from "node:test";
import assert from "node:assert/strict";
import { calculateScore } from "../lib/engine";
import { evToStars } from "../lib/starRating";
import { bootstrap, recommendations, summarize, traces } from "./stage0-audit-core";
import type { Event } from "./simulator/settlement";

test("trace exactly reproduces production strength and blended probabilities including missing jockey", () => {
  const scored = calculateScore([
    { id: 1, name: "a", formScore: 0.65, pedigreeScore: 0.42, jockeyScore: null, odds: 3 },
    { id: 2, name: "b", formScore: 0.1, pedigreeScore: 0.8, jockeyScore: 1.25, odds: 20 },
    { id: 3, name: "c", formScore: 1, pedigreeScore: 1, jockeyScore: 0.7, odds: 2 },
  ]).finalScores;
  const ts = traces(scored), sum = ts.reduce((s, t) => s + t.unnormalizedBlend, 0);
  ts.forEach((t, i) => assert.ok(Math.abs(t.unnormalizedBlend / sum - scored[i].probability) < 1e-12));
  assert.equal(ts[0].jockeyTerm, 0); assert.equal(ts[0].interactionTerm, 0);
});
test("UI recommendations are strict thresholds and EV order, not probability order", () => {
  const base = calculateScore([{ id: 1, name: "x", formScore: 0.65, pedigreeScore: 0.65, jockeyScore: null, odds: 2 }]).finalScores[0];
  const xs = [{ ...base, id: 1, ev: 0.1, edge: 0.1 }, { ...base, id: 2, ev: 0.3, edge: 0.02 },
    { ...base, id: 3, ev: 0.2, edge: 0.03, odds: 50, probability: 0.5 },
    { ...base, id: 4, ev: 0.4, edge: 0.03, odds: 50.1 },
    { ...base, id: 5, ev: 0.5, edge: 0.03, probability: 0.1 }];
  assert.deepEqual(recommendations(xs, false).map((x) => x.id), [5, 3]);
  assert.deepEqual(recommendations(xs, true).map((x) => x.id), [5, 4, 2, 3]);
  assert.equal(evToStars(0.2), 0.5); assert.equal(evToStars(2), 5); assert.equal(evToStars(20), 5);
});
const events: Event[] = ["2026-02-07", "2026-02-08", "2026-02-14"].map((date, i) => ({ raceId: String(i), date, archivedStartTime: "10:00",
  settlements: [{ kind: "tan", horses: [1], stakeYen: 1000, status: i === 1 ? "win" : "loss",
    returnYen: i === 1 ? 3000 : 0, profitYen: i === 1 ? 2000 : -1000, note: null }] }));
test("race bootstrap is deterministic, paired, and independent of repeated calls", () => {
  assert.deepEqual(bootstrap(events, events, 100), bootstrap(events, events, 100));
  assert.deepEqual(bootstrap(events, events, 100).pairedRoiDifference95CI, [0, 0]);
  assert.throws(() => bootstrap(events, [...events].reverse(), 10), /Unpaired/);
});
test("yen accounting, conservative payoff sensitivity and all-loss days", () => {
  const s = summarize(events);
  assert.equal(s.roiNet, 0); assert.equal(s.profitYen, 0); assert.equal(s.maxDrawdownYen, 1000);
  assert.equal(s.roiWithoutLargest1Return, -1); assert.equal(s.maxNoHitStreak, 1);
  assert.deepEqual(s.allLossDates, ["2026-02-07", "2026-02-14"]);
});
