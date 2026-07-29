/**
 * 一回限りの検証スクリプト: ①②実装前後で v1・v2 それぞれの AUC・ROI がどう
 * 変わったかを、同一の races-cache.json / results-cache.json 上で比較する。
 *
 * 「旧」= git show c816562~1 の lib/engine.ts (scripts/_cache/_engine-old.ts に保存)
 *        + 移行前バックアップの scores-cache.json (scripts/_cache/_scores-cache-old.json)
 * 「新」= 現行 lib/engine.ts + 移行後の lib/scores-cache.json
 *
 * calculateScore (softmax TEMP=4.0 / MARKET_WEIGHT=0.35 / ブレンド式) は
 * 旧新で完全に同一（git diff で確認済み）。差分は calculateStrength の
 * trainingScore・jockeyScore clamp の扱いのみ。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { calculateScore as calculateScoreNew } from "../lib/engine";
import { calculateScore as calculateScoreOld } from "./_cache/_engine-old";
import type { RacesCache } from "./fetch-races";
import type { ResultsCache } from "./fetch-results";
import type { HorseScores, ModelVersion } from "../lib/scorer";

const EV_MIN = 0.10, EDGE_MIN = 0.02, ODDS_MAX = 50;
const DEFAULT = 65;

function loadJSON<T>(dir: string, f: string): T {
  const p = join(process.cwd(), dir, f);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

const racesCache = loadJSON<RacesCache>("lib", "races-cache.json");
const resultsCache = loadJSON<ResultsCache>("lib", "results-cache.json");

const newScoresRaw = loadJSON<{ scores?: Record<string, HorseScores> }>("lib", "scores-cache.json");
const newScores: Record<number, HorseScores> = {};
for (const [k, v] of Object.entries(newScoresRaw.scores ?? {})) newScores[Number(k)] = v;

type OldHorseScores = HorseScores & { trainingScore?: number | null };
const oldScoresPath = join(process.cwd(), "scripts", "_cache", "_scores-cache-old.json");
if (!existsSync(oldScoresPath)) {
  console.error("scripts/_cache/_scores-cache-old.json が見つかりません");
  process.exit(1);
}
const oldScoresRaw = JSON.parse(readFileSync(oldScoresPath, "utf-8")) as { scores: Record<string, OldHorseScores> };
const oldScores: Record<number, OldHorseScores> = {};
for (const [k, v] of Object.entries(oldScoresRaw.scores)) oldScores[Number(k)] = v;

// ── auc（同順位は平均ランク。_ab-backtest.ts と同一ロジック）──
function auc(pairs: Array<{ score: number; hit: boolean }>): number {
  const pos = pairs.filter((p) => p.hit).map((p) => p.score);
  const neg = pairs.filter((p) => !p.hit).map((p) => p.score);
  if (!pos.length || !neg.length) return 0.5;
  const all = [...pairs].sort((a, b) => a.score - b.score);
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

type Metrics = {
  races: number; horses: number;
  aucStrength: number; aucFinal: number;
  targetRaces: number; bets: number; hitRate: number; roi: number;
};

function emptyAgg() {
  return {
    strengthPairs: [] as Array<{ score: number; hit: boolean }>,
    finalPairs: [] as Array<{ score: number; hit: boolean }>,
    races: new Set<string>(),
    horses: 0,
    targetRaces: 0, bets: 0, hitRaces: 0, invested: 0, returned: 0,
  };
}
function toMetrics(a: ReturnType<typeof emptyAgg>): Metrics {
  return {
    races: a.races.size, horses: a.horses,
    aucStrength: auc(a.strengthPairs), aucFinal: auc(a.finalPairs),
    targetRaces: a.targetRaces, bets: a.bets,
    hitRate: a.targetRaces ? a.hitRaces / a.targetRaces : 0,
    roi: a.invested ? (a.returned - a.invested) / a.invested : 0,
  };
}

const aggOldV1 = emptyAgg(), aggOldV2 = emptyAgg();
const aggNewV1 = emptyAgg(), aggNewV2 = emptyAgg();

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

  // modelVersion タグは移行で変更していないので新旧で同一の判定になるはず
  const versionNew: ModelVersion = withOdds.some((h) => newScores[h.id]?.modelVersion === "v2") ? "v2" : "v1";
  const versionOld: ModelVersion = withOdds.some((h) => oldScores[h.id]?.modelVersion === "v2") ? "v2" : "v1";
  if (versionNew !== versionOld) {
    console.warn(`  ⚠ modelVersion不一致: race=${race.netKeibaRaceId} old=${versionOld} new=${versionNew}`);
  }

  const hitOf = (h: { horse: string; horseNumber: number }) =>
    winner != null && (winner.horse === h.horse || winner.horseNumber === h.horseNumber);

  // ── 旧エンジン ──
  const oldInputs = withOdds.map((h) => {
    const c = oldScores[h.id];
    const rawT = c ? (c.trainingScore ?? null) : DEFAULT;
    const rawJ = c ? (c.jockeyScore ?? null) : DEFAULT;
    return {
      id: h.id, name: h.horse,
      formScore: (c?.formScore ?? DEFAULT) / 100,
      pedigreeScore: (c?.pedigreeScore ?? DEFAULT) / 100,
      trainingScore: rawT == null ? null : rawT / 100,
      jockeyScore: rawJ == null ? null : rawJ / 100,
      odds: h.odds,
    };
  });
  const oldResult = calculateScoreOld(oldInputs);
  const aggOld = versionOld === "v2" ? aggOldV2 : aggOldV1;
  aggOld.races.add(race.netKeibaRaceId);
  oldResult.finalScores.forEach((s, i) => {
    const hit = hitOf(withOdds[i]);
    aggOld.strengthPairs.push({ score: s.strength, hit });
    aggOld.finalPairs.push({ score: s.probability, hit });
    aggOld.horses++;
  });
  const oldPicked = oldResult.finalScores.filter((s) => s.ev > EV_MIN && s.edge > EDGE_MIN && s.odds <= ODDS_MAX);
  if (oldPicked.length) {
    aggOld.targetRaces++; aggOld.bets += oldPicked.length; aggOld.invested += oldPicked.length;
    aggOld.returned += oldPicked.reduce((sum, s) => sum + (hitOf(withOdds[oldResult.finalScores.indexOf(s)]) ? s.odds : 0), 0);
    if (oldPicked.some((s) => hitOf(withOdds[oldResult.finalScores.indexOf(s)]))) aggOld.hitRaces++;
  }

  // ── 新エンジン ──
  const newInputs = withOdds.map((h) => {
    const c = newScores[h.id];
    const rawJ = c ? (c.jockeyScore ?? null) : DEFAULT;
    return {
      id: h.id, name: h.horse,
      formScore: (c?.formScore ?? DEFAULT) / 100,
      pedigreeScore: (c?.pedigreeScore ?? DEFAULT) / 100,
      jockeyScore: rawJ == null ? null : rawJ / 100,
      odds: h.odds,
    };
  });
  const newResult = calculateScoreNew(newInputs);
  const aggNew = versionNew === "v2" ? aggNewV2 : aggNewV1;
  aggNew.races.add(race.netKeibaRaceId);
  newResult.finalScores.forEach((s, i) => {
    const hit = hitOf(withOdds[i]);
    aggNew.strengthPairs.push({ score: s.strength, hit });
    aggNew.finalPairs.push({ score: s.probability, hit });
    aggNew.horses++;
  });
  const newPicked = newResult.finalScores.filter((s) => s.ev > EV_MIN && s.edge > EDGE_MIN && s.odds <= ODDS_MAX);
  if (newPicked.length) {
    aggNew.targetRaces++; aggNew.bets += newPicked.length; aggNew.invested += newPicked.length;
    aggNew.returned += newPicked.reduce((sum, s) => sum + (hitOf(withOdds[newResult.finalScores.indexOf(s)]) ? s.odds : 0), 0);
    if (newPicked.some((s) => hitOf(withOdds[newResult.finalScores.indexOf(s)]))) aggNew.hitRaces++;
  }
}

function row(label: string, m: Metrics) {
  const pad = (s: string, n: number) => s.padStart(n);
  console.log(
    `${label.padEnd(28)} | ${pad(String(m.races), 4)}R | ${pad(String(m.horses), 5)}頭 | ` +
    `${pad(m.aucStrength.toFixed(4), 6)} | ${pad(m.aucFinal.toFixed(4), 6)} | ` +
    `${pad(String(m.targetRaces), 4)} | ${pad(String(m.bets), 4)} | ${pad((m.hitRate * 100).toFixed(1) + "%", 6)} | ${pad((m.roi * 100).toFixed(1) + "%", 7)}`
  );
}

console.log("設定".padEnd(28) + " | レース |  馬数  | AUC強 | AUC最終 | 対象R | 点数 | 的中率 |     ROI");
console.log("-".repeat(100));
row("v1 旧(clamp+training)", toMetrics(aggOldV1));
row("v1 新(①②実装後)", toMetrics(aggNewV1));
console.log("-".repeat(100));
row("v2 旧(clamp+training)", toMetrics(aggOldV2));
row("v2 新(①②実装後)", toMetrics(aggNewV2));
