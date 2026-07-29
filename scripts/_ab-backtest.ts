/**
 * 是正案のA/B検証ハーネス（分析専用・本番ロジック非改変）。
 *
 * lib/engine.ts の calculateScore をパラメータ化して複製し、以下を個別に切り替える:
 *   - useTraining : trainingScore を strength から外すか
 *   - jockeyMode  : クランプ済み(既存) / 生スコア / パーセンタイル正規化
 *   - temp        : softmax 温度（既定 4.0）
 *
 * 評価は AUC（純モデル strength / ブレンド後 probability）と、本番フィルタ
 * (EV>0.10, edge>0.02, odds<=50) を通した ROI の両方。
 * レース単位のペアブートストラップで差の信頼区間を出す。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RacesCache } from "./fetch-races";
import type { ResultsCache } from "./fetch-results";
import type { HorseScores, ModelVersion, JockeyStats } from "../lib/scorer";

const SP = "scripts/_cache";
const DEFAULT = 65;
const EV_MIN = 0.10, EDGE_MIN = 0.02, ODDS_MAX = 50;

function loadJSON<T>(f: string): T | null {
  const p = join(process.cwd(), "lib", f);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

// ── パラメータ化したエンジン（本番と同一式・オプションのみ差し替え）──────────
export type EngineOpts = {
  useTraining: boolean;
  jockeyMode: "clamp" | "raw" | "percentile";
  temp: number;
  marketWeight: number;
};
export const BASELINE: EngineOpts = {
  useTraining: true, jockeyMode: "clamp", temp: 4.0, marketWeight: 0.35,
};

type EHorse = {
  formScore: number; pedigreeScore: number;
  trainingScore: number | null; jockeyScore: number | null;
  odds: number;
};

const sigmoid = (x: number) => 1 / (1 + Math.exp(-10 * (x - 0.5)));
const BASE_WEIGHT = { form: 0.3, pedigree: 0.2, training: 0.2, jockey: 0.15 };
const TOTAL_BASE_WEIGHT = BASE_WEIGHT.form + BASE_WEIGHT.pedigree + BASE_WEIGHT.training + BASE_WEIGHT.jockey;

function strengthOf(h: EHorse, o: EngineOpts): number {
  const base: Array<{ value: number; weight: number }> = [
    { value: sigmoid(h.formScore), weight: BASE_WEIGHT.form },
    { value: Math.pow(h.pedigreeScore, 1.2), weight: BASE_WEIGHT.pedigree },
  ];
  const useT = o.useTraining && h.trainingScore != null;
  if (useT) base.push({ value: sigmoid(h.trainingScore! * 1.1), weight: BASE_WEIGHT.training });
  if (h.jockeyScore != null) base.push({ value: Math.pow(h.jockeyScore, 1.3), weight: BASE_WEIGHT.jockey });

  // 欠損ぶんの重みを残り要素へ再配分（本番と同じ）
  const availWeight = base.reduce((s, b) => s + b.weight, 0);
  const scale = availWeight > 0 ? TOTAL_BASE_WEIGHT / availWeight : 0;
  let sum = base.reduce((s, b) => s + b.value * b.weight * scale, 0);

  if (h.jockeyScore != null) sum += sigmoid(h.jockeyScore * 0.6 + h.pedigreeScore * 0.4) * 0.1;
  if (useT) sum += Math.pow(h.formScore * h.trainingScore!, 0.5) * 0.05;
  return sum;
}

export type Scored = { strength: number; prob: number; marketProb: number; edge: number; ev: number; odds: number };

export function scoreRace(horses: EHorse[], o: EngineOpts): Scored[] {
  const strengths = horses.map((h) => strengthOf(h, o));
  const overround = horses.reduce((s, h) => s + 1 / h.odds, 0);
  const fair = horses.map((h) => 1 / h.odds / overround);

  const expS = strengths.map((s) => Math.exp(s * o.temp));
  const expSum = expS.reduce((a, b) => a + b, 0);
  const modelProbs = expS.map((e) => e / expSum);

  const blended = modelProbs.map((mp, i) => {
    const fm = fair[i];
    const lm = Math.log(Math.max(mp, 1e-6) / Math.max(1 - mp, 1e-6));
    const lk = Math.log(Math.max(fm, 1e-6) / Math.max(1 - fm, 1e-6));
    const lb = (1 - o.marketWeight) * lm + o.marketWeight * lk;
    return 1 / (1 + Math.exp(-lb));
  });
  const bs = blended.reduce((a, b) => a + b, 0);
  const final = blended.map((p) => p / bs);

  return horses.map((h, i) => ({
    strength: strengths[i],
    prob: final[i],
    marketProb: fair[i],
    edge: final[i] - fair[i],
    ev: final[i] * h.odds - 1,
    odds: h.odds,
  }));
}

// ── データセット構築 ─────────────────────────────────────────────────────────
export type DHorse = EHorse & { hit: boolean; jockeyId: string };
export type DRace = { netId: string; version: ModelVersion; horses: DHorse[] };

export function buildDataset(): DRace[] {
  const racesCache = loadJSON<RacesCache>("races-cache.json")!;
  const resultsCache = loadJSON<ResultsCache>("results-cache.json")!;
  const scoresRaw = loadJSON<{ scores?: Record<string, HorseScores> }>("scores-cache.json");
  const scores: Record<number, HorseScores> = {};
  for (const [k, v] of Object.entries(scoresRaw?.scores ?? {})) scores[Number(k)] = v;

  const jrPath = `${SP}/jockey_raw.json`;
  const jockeyRaw: Record<string, (JockeyStats & { name: string }) | null> =
    existsSync(jrPath) ? JSON.parse(readFileSync(jrPath, "utf-8")) : {};

  // 生の騎手指標: winRate*400 + placeRate*150（clamp 前の raw）
  const rawScoreOf = (id: string): number | null => {
    const s = jockeyRaw[id];
    if (!s || s.rides === 0) return null;
    return (s.wins / s.rides) * 400 + (s.places / s.rides) * 150;
  };
  // パーセンタイル正規化用に全騎手の raw 分布を作る
  const allRaw = Object.keys(jockeyRaw).map(rawScoreOf).filter((x): x is number => x != null).sort((a, b) => a - b);
  const pctOf = (v: number): number => {
    let lo = 0, hi = allRaw.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (allRaw[m] < v) lo = m + 1; else hi = m; }
    return allRaw.length ? lo / allRaw.length : 0.5;
  };

  const races: DRace[] = [];
  for (const race of racesCache.races) {
    if (race.entriesPending || !race.horses.length) continue;
    const re = resultsCache.results.find((r) => r.netKeibaRaceId === race.netKeibaRaceId);
    if (!re || !re.finishers.length) continue;

    const oddsMap = new Map<string, number>();
    for (const f of re.finishers) if (f.odds != null && f.odds > 0) oddsMap.set(f.horse, f.odds);
    const winner = re.finishers.find((f) => f.position === 1);

    const withOdds = race.horses
      .map((h) => ({ ...h, odds: h.odds ?? oddsMap.get(h.horse) ?? null }))
      .filter((h): h is typeof h & { odds: number } => h.odds != null && h.odds > 0);
    if (withOdds.length === 0) continue;

    const horses: DHorse[] = withOdds.map((h) => {
      const c = scores[h.id];
      const rawT = c ? (c.trainingScore ?? null) : DEFAULT;
      const rawJ = c ? (c.jockeyScore ?? null) : DEFAULT;
      const jid = h.jockeyId ?? "";
      const rs = rawScoreOf(jid);
      return {
        formScore: (c?.formScore ?? DEFAULT) / 100,
        pedigreeScore: (c?.pedigreeScore ?? DEFAULT) / 100,
        trainingScore: rawT == null ? null : rawT / 100,
        jockeyScore: rawJ == null ? null : rawJ / 100,
        jockeyRaw: rs,
        jockeyPct: rs == null ? null : pctOf(rs),
        odds: h.odds,
        jockeyId: jid,
        hit: winner != null && (winner.horse === h.horse || winner.horseNumber === h.horseNumber),
      } as DHorse & { jockeyRaw: number | null; jockeyPct: number | null };
    });

    const version: ModelVersion = withOdds.some((h) => scores[h.id]?.modelVersion === "v2") ? "v2" : "v1";
    races.push({ netId: race.netKeibaRaceId, version, horses });
  }
  return races;
}

/** jockeyMode に応じて jockeyScore を差し替えた馬配列を返す */
export function applyJockeyMode(horses: DHorse[], mode: EngineOpts["jockeyMode"]): EHorse[] {
  return horses.map((h) => {
    const x = h as DHorse & { jockeyRaw: number | null; jockeyPct: number | null };
    let j = h.jockeyScore;
    if (mode === "raw") {
      // clamp を外した raw をそのまま 0-1 化（40..95 の外側も潰さない）
      j = x.jockeyRaw == null ? h.jockeyScore : x.jockeyRaw / 100;
    } else if (mode === "percentile") {
      // 全騎手の中での相対順位を 0.40..0.95 のレンジへ線形写像（尺度は既存と揃える）
      j = x.jockeyPct == null ? h.jockeyScore : 0.40 + x.jockeyPct * 0.55;
    }
    return { formScore: h.formScore, pedigreeScore: h.pedigreeScore, trainingScore: h.trainingScore, jockeyScore: j, odds: h.odds };
  });
}

// ── 評価指標 ─────────────────────────────────────────────────────────────────
export function auc(pairs: Array<{ score: number; hit: boolean }>): number {
  const pos = pairs.filter((p) => p.hit).map((p) => p.score);
  const neg = pairs.filter((p) => !p.hit).map((p) => p.score);
  if (!pos.length || !neg.length) return 0.5;
  const all = [...pairs].sort((a, b) => a.score - b.score);
  // 同順位を平均ランクで処理
  const ranks = new Map<number, number>();
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].score === all[i].score) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks.set(k, r);
    i = j + 1;
  }
  let posRankSum = 0;
  all.forEach((p, idx) => { if (p.hit) posRankSum += ranks.get(idx)!; });
  return (posRankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

export type Metrics = {
  races: number; horses: number;
  aucStrength: number; aucFinal: number;
  top1: number;
  targetRaces: number; bets: number; hitRate: number; roi: number;
  probSdRatio: number;
};

export function evaluate(races: DRace[], o: EngineOpts): Metrics {
  const strengthPairs: Array<{ score: number; hit: boolean }> = [];
  const finalPairs: Array<{ score: number; hit: boolean }> = [];
  let top1 = 0, targetRaces = 0, bets = 0, hitRaces = 0, invested = 0, returned = 0;
  let sdModelSum = 0, sdMarketSum = 0, sdN = 0;
  let horses = 0;

  for (const race of races) {
    const eh = applyJockeyMode(race.horses, o.jockeyMode);
    const sc = scoreRace(eh, o);
    horses += sc.length;

    sc.forEach((s, i) => {
      strengthPairs.push({ score: s.strength, hit: race.horses[i].hit });
      finalPairs.push({ score: s.prob, hit: race.horses[i].hit });
    });

    // レース内確率ばらつき比（モデル / 市場）
    if (sc.length >= 2) {
      const sd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
      sdModelSum += sd(sc.map((s) => s.prob));
      sdMarketSum += sd(sc.map((s) => s.marketProb));
      sdN++;
    }

    // 本命(prob最大)が勝ったか
    let bi = 0;
    sc.forEach((s, i) => { if (s.prob > sc[bi].prob) bi = i; });
    if (race.horses[bi].hit) top1++;

    // 本番フィルタでのベット
    const picked = sc.map((s, i) => ({ s, hit: race.horses[i].hit }))
      .filter((x) => x.s.ev > EV_MIN && x.s.edge > EDGE_MIN && x.s.odds <= ODDS_MAX);
    if (picked.length) {
      targetRaces++; bets += picked.length; invested += picked.length;
      returned += picked.reduce((a, x) => a + (x.hit ? x.s.odds : 0), 0);
      if (picked.some((x) => x.hit)) hitRaces++;
    }
  }

  return {
    races: races.length, horses,
    aucStrength: auc(strengthPairs), aucFinal: auc(finalPairs),
    top1: races.length ? top1 / races.length : 0,
    targetRaces, bets,
    hitRate: targetRaces ? hitRaces / targetRaces : 0,
    roi: invested ? (returned - invested) / invested : 0,
    probSdRatio: sdN ? sdModelSum / sdMarketSum : 0,
  };
}

/** レース単位ペアブートストラップで variant - baseline の差のCIを出す */
export function bootstrapDelta(
  races: DRace[], a: EngineOpts, b: EngineOpts, iters = 400
): { aucFinal: [number, number]; roi: [number, number]; aucStrength: [number, number] } {
  const dAuc: number[] = [], dRoi: number[] = [], dAucS: number[] = [];
  for (let t = 0; t < iters; t++) {
    const samp: DRace[] = [];
    for (let i = 0; i < races.length; i++) samp.push(races[(Math.random() * races.length) | 0]);
    const ma = evaluate(samp, a), mb = evaluate(samp, b);
    dAuc.push(mb.aucFinal - ma.aucFinal);
    dAucS.push(mb.aucStrength - ma.aucStrength);
    dRoi.push(mb.roi - ma.roi);
  }
  const ci = (xs: number[]): [number, number] => {
    const s = [...xs].sort((x, y) => x - y);
    return [s[Math.floor(s.length * 0.025)], s[Math.floor(s.length * 0.975)]];
  };
  return { aucFinal: ci(dAuc), roi: ci(dRoi), aucStrength: ci(dAucS) };
}
