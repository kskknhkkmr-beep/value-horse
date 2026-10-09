import { calculateScore } from "../lib/engine";
import { evToStars } from "../lib/starRating";
import { metrics, type Event } from "./simulator/settlement";

export type Scored = ReturnType<typeof calculateScore>["finalScores"][number];
export function recommendations(scores: Scored[], graded: boolean): Scored[] {
  return [...scores].sort((a, b) => b.ev - a.ev)
    .filter((h) => h.ev > 0.10 && (graded || (h.edge > 0.02 && h.odds <= 50)));
}
const sigmoid = (x: number) => 1 / (1 + Math.exp(-10 * (x - 0.5)));
const logit = (x: number) => Math.log(Math.max(x, 1e-6) / Math.max(1 - x, 1e-6));
/** Algebraic trace, NOT a causal attribution or a new model. */
export function traces(scores: Scored[]) {
  const expSum = scores.reduce((n, h) => n + Math.exp(4 * h.strength), 0);
  return scores.map((h) => {
    const scale = h.jockeyScore == null ? 0.65 / 0.5 : 1;
    const formTerm = scale * 0.3 * sigmoid(h.formScore);
    const aptitudeTerm = scale * 0.2 * h.pedigreeScore ** 1.2;
    const jockeyTerm = h.jockeyScore == null ? 0 : scale * 0.15 * h.jockeyScore ** 1.3;
    const interactionTerm = h.jockeyScore == null ? 0 : 0.1 * sigmoid(0.6 * h.jockeyScore + 0.4 * h.pedigreeScore);
    if (Math.abs(formTerm + aptitudeTerm + jockeyTerm + interactionTerm - h.strength) > 1e-12) throw new Error("Strength trace mismatch");
    const pureModelProbability = Math.exp(4 * h.strength) / expSum;
    const modelLogitTerm = 0.65 * logit(pureModelProbability), marketLogitTerm = 0.35 * logit(h.marketProb);
    return { id: h.id, formTerm, aptitudeTerm, jockeyTerm, interactionTerm, pureModelProbability,
      modelLogitTerm, marketLogitTerm, unnormalizedBlend: 1 / (1 + Math.exp(-modelLogitTerm - marketLogitTerm)),
      passesEV: h.ev > 0.10, passesEdge: h.edge > 0.02, passesOdds: h.odds <= 50, evDerivedStars: evToStars(h.ev) };
  });
}
export function bootstrap(events: Event[], other?: Event[], iterations = 2000) {
  if (other && (events.length !== other.length || events.some((e, i) => e.raceId !== other[i].raceId))) throw new Error("Unpaired bootstrap");
  const totals = (xs: Event[]) => xs.map((e) => ({
    stake: e.settlements.reduce((s, t) => s + (t.status === "refunded" ? 0 : t.stakeYen), 0),
    profit: e.settlements.reduce((s, t) => { if (t.profitYen == null) throw new Error("Unresolved"); return s + t.profitYen; }, 0),
    hit: Number(e.settlements.some((s) => s.status === "win")), bet: Number(e.settlements.some((s) => s.status !== "refunded")),
  }));
  const a = totals(events), b = other ? totals(other) : null;
  let seed = 20261009;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const rois: number[] = [], diffs: number[] = [], hitDiffs: number[] = [];
  for (let k = 0; k < iterations; k++) {
    let stake = 0, profit = 0, os = 0, op = 0, hit = 0, bet = 0, oh = 0, ob = 0;
    for (let i = 0; i < a.length; i++) {
      const j = Math.floor(random() * a.length), x = a[j], y = b?.[j];
      stake += x.stake; profit += x.profit; hit += x.hit; bet += x.bet;
      if (y) { os += y.stake; op += y.profit; oh += y.hit; ob += y.bet; }
    }
    if (stake) rois.push(profit / stake);
    if (stake && os) diffs.push(profit / stake - op / os);
    if (bet && ob) hitDiffs.push(hit / bet - oh / ob);
  }
  const ci = (xs: number[]) => { xs.sort((a, b) => a - b); return xs.length ? [xs[Math.floor((xs.length - 1) * 0.025)], xs[Math.floor((xs.length - 1) * 0.975)]] : null; };
  return { raceBootstrapIterations: iterations, seed: 20261009, roi95CI: ci(rois), pairedRoiDifference95CI: ci(diffs), pairedRaceHitDifference95CI: ci(hitDiffs) };
}
export function summarize(events: Event[]) {
  const m = metrics(events);
  const returns = events.flatMap((e) => e.settlements.filter((s) => s.status === "win").map((s) => s.returnYen!)).sort((a, b) => b - a);
  const byDay = new Map<string, { bets: number; hits: number }>();
  for (const e of events) { const d = byDay.get(e.date) ?? { bets: 0, hits: 0 };
    d.bets += e.settlements.filter((s) => s.status !== "refunded").length;
    d.hits += e.settlements.filter((s) => s.status === "win").length; byDay.set(e.date, d); }
  const { curve: _curve, hitIntervals, ...compact } = m;
  void _curve;
  return { ...compact, bootstrap: bootstrap(events),
    roiWithoutLargest1Return: m.riskedYen ? (m.profitYen - (returns[0] ?? 0)) / m.riskedYen : null,
    roiWithoutLargest2Returns: m.riskedYen ? (m.profitYen - (returns[0] ?? 0) - (returns[1] ?? 0)) / m.riskedYen : null,
    below20Hits: m.hitTickets < 20, betDays: [...byDay.values()].filter((d) => d.bets > 0).length,
    allLossDates: [...byDay].filter(([, d]) => d.bets > 0 && d.hits === 0).map(([day]) => day),
    hitIntervals, averageHitGapBetRaces: hitIntervals.length ? hitIntervals.reduce((s, x) => s + x.betRaceGap, 0) / hitIntervals.length : null };
}
