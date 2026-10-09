import assert from "node:assert/strict";
import test from "node:test";
import type { Truth } from "./simulator/types";
import { caseGroups, compare, describe, observe, type AuditRow } from "./stage1-first-audit-core";

function truth(index: number): Truth {
  const winner = index + 1, positions = [1, 2, 3].map(n => n === winner ? 1 : n === (winner % 3) + 1 ? 2 : 3);
  const second = positions.indexOf(2) + 1;
  const unavailable = { status: "not_offered" as const, rawCombination: null, rawPayout: null, entries: [] };
  return { raceId: `20260000000${index + 1}`, date: `2026-04-0${4 + index}`, archivedStartTime: "10:00",
    horses: positions.map((p, i) => ({ horseId: `900000000${i + 1}`, horseNumber: i + 1,
      positionRaw: String(p), raceTimeRaw: null, marginRaw: null, final3fRaw: null,
      cornerPositionsRaw: null, finalOddsRaw: "3.0", popularity: i + 1 })),
    payouts: { tan: { status: "ok", rawCombination: null, rawPayout: null, entries: [{ horse: winner, payout: 300 }] },
      fuku: { status: "ok", rawCombination: null, rawPayout: null,
        entries: [{ horse: winner, payout: 120 }, { horse: second, payout: 110 }] },
      umaren: unavailable, umatan: unavailable, wide: unavailable, sanfuku: unavailable, santan: unavailable } };
}
const rows: AuditRow[] = [0, 1, 2].map(i => { const t = truth(i); return {
  raceId: t.raceId, date: t.date, archivedStartTime: t.archivedStartTime,
  independent: observe(t, 1), market: observe(t, 2), vh: i === 2 ? null : observe(t, 3) }; });

test("single-stake accounting, chronology, DD/streak and both jackpot sensitivities", () => {
  const m = describe([...rows].reverse(), "independent");
  assert.equal(m.selectedRaces, 3); assert.equal(m.wins, 1); assert.equal(m.riskedYen, 3000);
  assert.equal(m.profitYen, 0); assert.equal(m.roiNet, 0);
  assert.equal(m.maxDrawdownYen, 2000); assert.equal(m.maxNoHitStreak, 2);
  assert.equal(m.sensitivity[0].removingRace.profitYen, -2000);
  assert.equal(m.sensitivity[0].removingRace.roiNet, -1);
  assert.equal(m.sensitivity[0].keepingStakeZeroingPayout.profitYen, -3000);
  assert.equal(m.sensitivity[1].removed.length, 1);
});
test("paid place differs from top-three and no nomination is not silently a losing bet", () => {
  const third = truth(0).horses.find(h => h.positionRaw === "3")!;
  const out = observe(truth(0), third.horseNumber);
  assert.equal(out.top3, true); assert.equal(out.place, false);
  const m = describe(rows, "vh"); assert.equal(m.selectedRaces, 2); assert.equal(m.noSelection, 1);
  assert.equal(m.riskedYen, 2000);
  assert.throws(() => compare(rows, "independent", "vh"));
});
test("paired bootstrap preserves race pairing and identical strategies give exact zero CI", () => {
  const identical = rows.map(r => ({ ...r, market: r.independent! }));
  const a = compare(identical, "independent", "market"), b = compare(identical, "independent", "market");
  assert.deepEqual(a, b); assert.equal(a.winRateDifference, 0);
  assert.deepEqual(a.pairedRaceHitDifference95CI, [0, 0]);
  assert.deepEqual(a.pairedRoiDifference95CI, [0, 0]);
  assert.equal(a.winningTicketJaccard, 1); assert.equal(a.sharedWinningTickets, 1);
});
test("all positive and negative cases are classified and examples use chronological order", () => {
  const yes = { ...rows[0].independent!, win: true, place: true, top3: true };
  const no = { ...rows[1].independent!, win: false, place: false, top3: false };
  const fixtures = [ { ...rows[2], independent: yes, market: no },
    { ...rows[1], independent: no, market: yes }, { ...rows[0], independent: yes, market: no } ];
  const groups = caseGroups(fixtures);
  assert.deepEqual(groups.marketOutNewWin.map(r => r.raceId), [rows[0].raceId, rows[2].raceId]);
  assert.equal(groups.marketPlaceNewOut.length, 1); assert.equal(groups.marketWinNewOut.length, 1);
});
test("missing payout or inconsistent winner is rejected; dead heats settle confirmed amounts", () => {
  const t = truth(0);
  assert.throws(() => observe({ ...t, payouts: { ...t.payouts, tan: { ...t.payouts.tan, status: "missing" } } }, 1));
  assert.throws(() => observe({ ...t, horses: t.horses.map(h => ({ ...h, positionRaw: "2" })) }, 1));
  const tied = { ...t, horses: t.horses.map(h => ({ ...h, positionRaw: h.horseNumber <= 2 ? "1" : "3" })),
    payouts: { ...t.payouts, tan: { ...t.payouts.tan, entries: [{ horse: 1, payout: 150 }, { horse: 2, payout: 210 }] } } };
  assert.equal(observe(tied, 2).settlement.returnYen, 2100);
});
