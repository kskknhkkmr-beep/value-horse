/** Pure diagnosis of saved predictions: no fitting, feature generation or model mutation. */
import assert from "node:assert/strict";
import { events } from "./stage1-first-audit-core";
import type { AuditRow } from "./stage1-first-audit-core";
import { metrics } from "./simulator/settlement";
import type { RankedPrediction } from "./simulator/types";

const names = ["recentFinish", "surfaceFinish", "distanceFinish", "historyCount", "restDays", "cornerPosition", "weightChange"];
export const MASKS = ["none", "withoutCorner", "withoutWeight"] as const;
export type Mask = typeof MASKS[number];
export function ranking(predictions: readonly RankedPrediction[], mask: Mask) {
  assert(MASKS.includes(mask)); assert(predictions.length > 0);
  assert.equal(new Set(predictions.map(p => p.horseId)).size, predictions.length);
  assert.equal(new Set(predictions.map(p => p.horseNumber)).size, predictions.length);
  const remove = mask === "withoutCorner" ? [5, 12] : mask === "withoutWeight" ? [6, 13] : [];
  const scored = predictions.map(p => {
    assert.equal(p.reasons.length, 14);
    p.reasons.forEach((r, j) => {
      assert.equal(r.name, j < 7 ? names[j] : names[j - 7] + ":missing");
      assert(typeof r.contribution === "number" && Number.isFinite(r.contribution));
    });
    return { horseId: p.horseId, horseNumber: p.horseNumber,
      score: p.reasons.reduce((s, r, j) => s + (remove.includes(j) ? 0 : r.contribution!), 0) };
  });
  const max = Math.max(...scored.map(p => p.score));
  const denominator = scored.reduce((s, p) => s + Math.exp(p.score - max), 0);
  return scored.map(p => ({ ...p, probability: Math.exp(p.score - max) / denominator }))
    .sort((a, b) => b.score - a.score || a.horseNumber - b.horseNumber);
}
export function contributionGap(chosen: RankedPrediction, previous: RankedPrediction) {
  ranking([chosen, previous], "none");
  const gap = (indices: number[]) => indices.reduce((s, j) =>
    s + chosen.reasons[j].contribution! - previous.reasons[j].contribution!, 0);
  const legacy = gap([0,1,2,3,4,7,8,9,10,11]), corner = gap([5,12]), weight = gap([6,13]);
  return { legacy, corner, weight, total: legacy + corner + weight };
}
export const profitDelta = (r: AuditRow) => {
  assert(r.independent && r.vh); return r.independent.settlement.profitYen! - r.vh.settlement.profitYen!;
};
export const changedPick = (r: AuditRow) => {
  assert(r.independent && r.vh); return r.independent.horseId !== r.vh.horseId;
};
export function pairedAccounts(rows: AuditRow[]) {
  const account = (key: "independent" | "vh") => {
    assert(rows.every(r => r[key] !== null));
    const xs = rows.map(r => r[key]!);
    const { curve: _curve, hitIntervals: _intervals, ...money } = metrics(events(rows, key));
    void _curve; void _intervals;
    const wins = xs.filter(x => x.win).length;
    return { n: rows.length, wins, winRate: rows.length ? wins / rows.length : null,
      place: xs.filter(x => x.place).length, placeRate: rows.length ? xs.filter(x => x.place).length / rows.length : null,
      below20Hits: wins < 20, popularity: Object.fromEntries(Array.from({ length: 18 }, (_, i) =>
        [i + 1, xs.filter(x => x.popularity === i + 1).length])), ...money };
  };
  const v2 = account("independent"), previous = account("vh");
  return { v2, previous, profitDifference: v2.profitYen - previous.profitYen,
    roiDifference: v2.roiNet === null || previous.roiNet === null ? null : v2.roiNet - previous.roiNet };
}
export function outcomeGroups(rows: AuditRow[]) {
  assert(rows.every(r => r.independent && r.vh));
  return { newOnlyWin: rows.filter(r => r.independent!.win && !r.vh!.win),
    previousOnlyWin: rows.filter(r => !r.independent!.win && r.vh!.win),
    bothWin: rows.filter(r => r.independent!.win && r.vh!.win),
    neitherWin: rows.filter(r => !r.independent!.win && !r.vh!.win) };
}
export function commonSensitivity(rows: AuditRow[], basis: "v2Payout" | "eitherPayout" | "positiveDelta") {
  assert(rows.every(r => r.independent && r.vh));
  const value = (r: AuditRow) => basis === "v2Payout" ? r.independent!.settlement.returnYen! :
    basis === "eitherPayout" ? Math.max(r.independent!.settlement.returnYen!, r.vh!.settlement.returnYen!) : profitDelta(r);
  const ordered = rows.filter(r => value(r) > 0).sort((a,b) => value(b) - value(a) ||
    a.date.localeCompare(b.date) || a.raceId.localeCompare(b.raceId));
  return [1,2].map(k => {
    const removed = ordered.slice(0,k), ids = new Set(removed.map(r => r.raceId));
    return { basis, requested: k, removed: removed.map(r => ({ raceId: r.raceId, date: r.date,
      v2Return: r.independent!.settlement.returnYen, previousReturn: r.vh!.settlement.returnYen, delta: profitDelta(r) })),
      remaining: pairedAccounts(rows.filter(r => !ids.has(r.raceId))) };
  });
}
export function firstExamples(rows: AuditRow[]) {
  const ordered = rows.filter(changedPick).sort((a,b) => a.date.localeCompare(b.date) || a.raceId.localeCompare(b.raceId));
  const groups = outcomeGroups(ordered);
  return { success: groups.newOnlyWin.slice(0,3), failure: groups.previousOnlyWin.slice(0,3) };
}
