/** Evaluation only. No model fitting, feature changes or configurable selection rules. */
import { bootstrap } from "./stage0-audit-core";
import { metrics, settleTicket, type Event } from "./simulator/settlement";
import type { Truth } from "./simulator/types";

export const AUDIT_SETTINGS = { stakeYen: 1000, bootstrapIterations: 10000, seed: 20261009 } as const;
export type Outcome = { horseId: string; horseNumber: number; positionRaw: string; popularity: number;
  finalOdds: number; win: boolean; place: boolean; top3: boolean;
  settlement: ReturnType<typeof settleTicket> };
export type AuditRow = { raceId: string; date: string; archivedStartTime: string | null;
  independent: Outcome | null; market: Outcome; vh: Outcome | null };
export type Strategy = "independent" | "market" | "vh";
export function observe(truth: Truth, horseNumber: number): Outcome {
  const horse = truth.horses.find(h => h.horseNumber === horseNumber);
  if (!horse?.positionRaw || !Number.isInteger(horse.popularity) || horse.popularity! < 1 ||
      horse.popularity! > 18 || !horse.finalOddsRaw || !/^\d+(?:\.\d+)?$/.test(horse.finalOddsRaw) ||
      Number(horse.finalOddsRaw) <= 0) throw new Error("Missing outcome/market label");
  const settlement = settleTicket({ kind: "tan", horses: [horseNumber], stakeYen: AUDIT_SETTINGS.stakeYen }, truth);
  const place = settleTicket({ kind: "fuku", horses: [horseNumber], stakeYen: AUDIT_SETTINGS.stakeYen }, truth);
  if ([settlement, place].some(s => s.status === "unresolved" || s.status === "refunded")) throw new Error("Unresolved selection; never silently count as loss");
  const win = horse.positionRaw === "1";
  if (win !== (settlement.status === "win")) throw new Error("Winner/confirmed payout disagreement");
  return { horseId: horse.horseId, horseNumber, positionRaw: horse.positionRaw,
    popularity: horse.popularity!, finalOdds: Number(horse.finalOddsRaw), win,
    place: place.status === "win", top3: /^[123]$/.test(horse.positionRaw), settlement };
}
export function events(rows: AuditRow[], strategy: Strategy): Event[] {
  return rows.map(r => ({ raceId: r.raceId, date: r.date, archivedStartTime: r.archivedStartTime,
    settlements: r[strategy] ? [r[strategy]!.settlement] : [] }));
}
export function describe(rows: AuditRow[], strategy: Strategy) {
  const selected = rows.filter(r => r[strategy] !== null), outcomes = selected.map(r => r[strategy]!);
  const account = metrics(events(rows, strategy));
  const { curve: _curve, hitIntervals: _intervals, ...money } = account; void _curve; void _intervals;
  const wins = outcomes.filter(o => o.win).length, place = outcomes.filter(o => o.place).length;
  const top = selected.filter(r => r[strategy]!.win).sort((a, b) =>
    b[strategy]!.settlement.returnYen! - a[strategy]!.settlement.returnYen! ||
    a.date.localeCompare(b.date) || a.raceId.localeCompare(b.raceId));
  const sensitivity = [1, 2].map(k => {
    const removed = top.slice(0, k), ids = new Set(removed.map(r => r.raceId));
    const without = metrics(events(rows.filter(r => !ids.has(r.raceId)), strategy));
    const payout = removed.reduce((s, r) => s + r[strategy]!.settlement.returnYen!, 0);
    return { requested: k, removed: removed.map(r => ({ raceId: r.raceId, horseNumber: r[strategy]!.horseNumber,
      returnYen: r[strategy]!.settlement.returnYen })),
    removingRace: { profitYen: without.profitYen, roiNet: without.roiNet, stakeYen: without.riskedYen },
    keepingStakeZeroingPayout: { profitYen: account.profitYen - payout,
      roiNet: account.riskedYen ? (account.profitYen - payout) / account.riskedYen : null } };
  });
  return { cohortRaces: rows.length, selectedRaces: selected.length, noSelection: rows.length - selected.length,
    wins, winRate: selected.length ? wins / selected.length : null, paidPlace: place,
    paidPlaceRate: selected.length ? place / selected.length : null,
    top3: outcomes.filter(o => o.top3).length,
    top3Rate: selected.length ? outcomes.filter(o => o.top3).length / selected.length : null,
    popularity: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, outcomes.filter(o => o.popularity === i + 1).length])),
    below20Hits: wins < 20, ...money, sensitivity,
    uncertainty: bootstrap(events(rows, strategy), undefined, AUDIT_SETTINGS.bootstrapIterations) };
}
export function compare(rows: AuditRow[], left: Strategy, right: Strategy) {
  if (rows.some(r => !r[left] || !r[right])) throw new Error("Paired comparison requires both selections");
  const hits = (key: Strategy) => new Set(rows.filter(r => r[key]!.win).map(r => `${r.raceId}/${r[key]!.horseNumber}`));
  const a = hits(left), b = hits(right), intersection = [...a].filter(k => b.has(k)).length;
  return { races: rows.length, left, right,
    winRateDifference: rows.length ? rows.reduce((s, r) => s + Number(r[left]!.win) - Number(r[right]!.win), 0) / rows.length : null,
    sameSelections: rows.filter(r => r[left]!.horseNumber === r[right]!.horseNumber).length,
    sharedWinningTickets: intersection, winningTicketJaccard: new Set([...a, ...b]).size ? intersection / new Set([...a, ...b]).size : null,
    ...bootstrap(events(rows, left), events(rows, right), AUDIT_SETTINGS.bootstrapIterations) };
}
export function caseGroups(rows: AuditRow[]) {
  if (rows.some(r => !r.independent)) throw new Error("Cases require saved independent picks");
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.raceId.localeCompare(b.raceId));
  return {
    marketOutNewWin: ordered.filter(r => !r.market.place && r.independent!.win),
    marketOutNewPlace: ordered.filter(r => !r.market.place && r.independent!.place),
    marketWinNewOut: ordered.filter(r => r.market.win && !r.independent!.place),
    marketPlaceNewOut: ordered.filter(r => r.market.place && !r.independent!.place),
    bothPlace: ordered.filter(r => r.market.place && r.independent!.place),
    bothOut: ordered.filter(r => !r.market.place && !r.independent!.place),
    marketOutsideTop3NewWin: ordered.filter(r => !r.market.top3 && r.independent!.win),
    marketOutsideTop3NewTop3: ordered.filter(r => !r.market.top3 && r.independent!.top3),
    marketTop3NewOutsideTop3: ordered.filter(r => r.market.top3 && !r.independent!.top3),
  };
}
