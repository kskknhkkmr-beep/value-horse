/**
 * 一回限りの検証スクリプト。
 * v2 の EDGE_MIN=0.05 × ODDS_MAX=20 (ROI+4.2%, 58R/65点) が本物の効果か
 * ノイズかを見極める。sim-thresholds.ts の buildRaces() と同じ構築ロジック
 * だが、的中馬・レースを特定できるよう識別情報を保持したまま複製する
 * （sim-thresholds.ts 自体は変更しない）。
 *
 *   1. レース単位ブートストラップでROIの信頼区間を出す
 *   2. 該当65点の内訳（オッズ・的中・レース）を全件列挙し、上位1〜2点で
 *      全体が持ち上がっていないか確認する
 *   3. 同条件をv1でも計算し、v2固有の現象かを切り分ける
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { calculateScore } from "../lib/engine";
import type { RacesCache } from "./fetch-races";
import type { ResultsCache } from "./fetch-results";
import type { HorseScores, ModelVersion } from "../lib/scorer";

const EV_MIN = 0.10;
const DEFAULT = 65;

function loadJSON<T>(filename: string): T | null {
  try {
    const p = join(process.cwd(), "lib", filename);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

type Candidate = {
  ev: number; edge: number; odds: number; hit: boolean;
  horse: string; raceLabel: string; netKeibaRaceId: string;
};
type RaceCand = { modelVersion: ModelVersion; netKeibaRaceId: string; raceLabel: string; horses: Candidate[] };

function buildRaces(): RaceCand[] {
  const racesCache = loadJSON<RacesCache>("races-cache.json");
  const scoresCache = loadJSON<{ scores?: Record<string, HorseScores> }>("scores-cache.json");
  const resultsCache = loadJSON<ResultsCache>("results-cache.json");
  if (!racesCache || !resultsCache) throw new Error("cache 不在");

  const scoresById: Record<number, HorseScores> = {};
  for (const [k, v] of Object.entries(scoresCache?.scores ?? {})) scoresById[Number(k)] = v;

  const races: RaceCand[] = [];
  const processedNetIds = new Set<string>();

  // ── Pass 1: races-cache（スコアあり）── sim-thresholds.ts と同一条件
  for (const race of racesCache.races) {
    if (race.entriesPending || race.horses.length === 0) continue;

    const resultEntry = resultsCache.results.find((r) => r.netKeibaRaceId === race.netKeibaRaceId);
    if (!resultEntry || resultEntry.finishers.length === 0) continue;
    processedNetIds.add(race.netKeibaRaceId);

    const finisherOddsMap = new Map<string, number>();
    for (const f of resultEntry.finishers) {
      if (f.odds != null && f.odds > 0) finisherOddsMap.set(f.horse, f.odds);
    }

    const horsesWithOdds = race.horses
      .map((h) => ({ ...h, odds: h.odds ?? finisherOddsMap.get(h.horse) ?? null }))
      .filter((h): h is typeof h & { odds: number } => h.odds != null && h.odds > 0);
    if (horsesWithOdds.length === 0) continue;

    const inputs = horsesWithOdds.map((h) => {
      const cached = scoresById[h.id];
      const rawJockey = cached ? (cached.jockeyScore ?? null) : DEFAULT;
      return {
        id: h.id,
        name: h.horse,
        formScore: (cached?.formScore ?? DEFAULT) / 100,
        pedigreeScore: (cached?.pedigreeScore ?? DEFAULT) / 100,
        jockeyScore: rawJockey == null ? null : rawJockey / 100,
        odds: h.odds,
      };
    });

    const { evRanking } = calculateScore(inputs);
    const winner = resultEntry.finishers.find((f) => f.position === 1);
    const winnerName = winner?.horse ?? null;
    const raceLabel = `${race.date} ${race.venue}${race.raceNumber}R ${race.raceName}`;

    const horses: Candidate[] = evRanking.map((h) => {
      const hEntry = horsesWithOdds.find((e) => e.horse === h.name);
      const isHit =
        h.name === winnerName ||
        (winner?.horseNumber != null && hEntry?.horseNumber === winner.horseNumber);
      return { ev: h.ev, edge: h.edge, odds: h.odds, hit: !!isHit, horse: h.name, raceLabel, netKeibaRaceId: race.netKeibaRaceId };
    });

    const raceVersion: ModelVersion = horsesWithOdds.some(
      (h) => scoresById[h.id]?.modelVersion === "v2"
    ) ? "v2" : "v1";

    races.push({ modelVersion: raceVersion, netKeibaRaceId: race.netKeibaRaceId, raceLabel, horses });
  }

  // ── Pass 2: results-cache のみ（過去週・デフォルトスコア）→ v1 ──
  for (const resultEntry of resultsCache.results) {
    if (processedNetIds.has(resultEntry.netKeibaRaceId)) continue;
    if (resultEntry.finishers.length === 0) continue;

    const horsesWithOdds = resultEntry.finishers
      .filter((f) => f.odds != null && f.odds > 0)
      .map((f) => ({ horse: f.horse, horseNumber: f.horseNumber, odds: f.odds as number }));
    if (horsesWithOdds.length === 0) continue;

    const inputs = horsesWithOdds.map((h) => ({
      id: 0,
      name: h.horse,
      formScore: DEFAULT / 100,
      pedigreeScore: DEFAULT / 100,
      jockeyScore: DEFAULT / 100,
      odds: h.odds,
    }));

    const { evRanking } = calculateScore(inputs);
    const winner = resultEntry.finishers.find((f) => f.position === 1);
    const winnerName = winner?.horse ?? null;
    const raceLabel = `${resultEntry.date} ${resultEntry.venue} ${resultEntry.raceName}`;

    const horses: Candidate[] = evRanking.map((h) => {
      const hFin = horsesWithOdds.find((e) => e.horse === h.name);
      const isHit =
        h.name === winnerName ||
        (winner?.horseNumber != null && hFin?.horseNumber === winner.horseNumber);
      return { ev: h.ev, edge: h.edge, odds: h.odds, hit: !!isHit, horse: h.name, raceLabel, netKeibaRaceId: resultEntry.netKeibaRaceId };
    });

    races.push({ modelVersion: "v1", netKeibaRaceId: resultEntry.netKeibaRaceId, raceLabel, horses });
  }

  return races;
}

type Stats = { targetRaces: number; bets: number; hitRaces: number; hitRate: number; invested: number; returned: number; roi: number };

function simulate(races: RaceCand[], edgeMin: number, oddsMax: number): Stats {
  let targetRaces = 0, bets = 0, hitRaces = 0, invested = 0, returned = 0;
  for (const race of races) {
    const picked = race.horses.filter((h) => h.ev > EV_MIN && h.edge > edgeMin && h.odds <= oddsMax);
    if (picked.length === 0) continue;
    targetRaces++; bets += picked.length; invested += picked.length;
    returned += picked.reduce((s, h) => s + (h.hit ? h.odds : 0), 0);
    if (picked.some((h) => h.hit)) hitRaces++;
  }
  const hitRate = targetRaces > 0 ? (hitRaces / targetRaces) * 100 : 0;
  const roi = invested > 0 ? ((returned - invested) / invested) * 100 : 0;
  return { targetRaces, bets, hitRaces, hitRate, invested, returned, roi };
}

const all = buildRaces();
const EDGE = 0.05, ODDS = 20;

for (const version of ["v2", "v1"] as const) {
  const races = all.filter((r) => r.modelVersion === version);
  const s = simulate(races, EDGE, ODDS);
  console.log(`\n════ ${version}: EDGE_MIN=${EDGE} × ODDS_MAX=${ODDS} ════`);
  console.log(`対象${s.targetRaces}R / ${s.bets}点  的中率=${s.hitRate.toFixed(1)}%  ROI=${s.roi.toFixed(1)}%  (投資${s.invested} / 回収${s.returned.toFixed(1)})`);

  // ── ② 内訳の列挙（的中分を配当降順） ──
  const picks: Array<{ race: RaceCand; h: Candidate }> = [];
  for (const race of races) {
    const picked = race.horses.filter((h) => h.ev > EV_MIN && h.edge > EDGE && h.odds <= ODDS);
    for (const h of picked) picks.push({ race, h });
  }
  const hits = picks.filter((p) => p.h.hit).sort((a, b) => b.h.odds - a.h.odds);
  console.log(`  的中 ${hits.length}件 / ${picks.length}点:`);
  for (const p of hits) {
    console.log(`    odds=${p.h.odds.toFixed(1)}  ${p.h.horse}  [${p.race.raceLabel}]`);
  }
  const totalReturn = picks.reduce((s, p) => s + (p.h.hit ? p.h.odds : 0), 0);
  const totalInvest = picks.length;
  console.log(`  投資${totalInvest} 回収${totalReturn.toFixed(1)} ROI=${(((totalReturn - totalInvest) / totalInvest) * 100).toFixed(1)}%`);
  if (hits.length > 0) {
    const top = hits[0];
    const returnWithoutTop = totalReturn - top.h.odds;
    const roiWithoutTop = ((returnWithoutTop - totalInvest) / totalInvest) * 100;
    console.log(`  → 最高配当1点(odds=${top.h.odds.toFixed(1)}, ${top.h.horse})を除くと ROI=${roiWithoutTop.toFixed(1)}%`);
    if (hits.length > 1) {
      const top2 = hits[1];
      const returnWithoutTop2 = returnWithoutTop - top2.h.odds;
      const roiWithoutTop2 = ((returnWithoutTop2 - totalInvest) / totalInvest) * 100;
      console.log(`  → 上位2点(odds=${top.h.odds.toFixed(1)}, ${top2.h.odds.toFixed(1)})を除くと ROI=${roiWithoutTop2.toFixed(1)}%`);
    }
  }

  // ── ① レース単位ブートストラップでROIの信頼区間 ──
  const iters = 2000;
  const roiSamples: number[] = [];
  for (let t = 0; t < iters; t++) {
    const samp: RaceCand[] = [];
    for (let i = 0; i < races.length; i++) samp.push(races[(Math.random() * races.length) | 0]);
    const m = simulate(samp, EDGE, ODDS);
    roiSamples.push(m.roi);
  }
  roiSamples.sort((a, b) => a - b);
  const p2_5 = roiSamples[Math.floor(iters * 0.025)];
  const p50 = roiSamples[Math.floor(iters * 0.5)];
  const p97_5 = roiSamples[Math.floor(iters * 0.975)];
  const shareNegOrZero = roiSamples.filter((x) => x <= 0).length / iters;
  console.log(`  ブートストラップ(レース単位, ${iters}回): ROI中央値=${p50.toFixed(1)}%  95%CI=[${p2_5.toFixed(1)}%, ${p97_5.toFixed(1)}%]`);
  console.log(`  → リサンプルのうちROI<=0の割合: ${(shareNegOrZero * 100).toFixed(1)}%`);
}
