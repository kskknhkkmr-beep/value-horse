/**
 * 閾値スイープ・シミュレーション（分析専用・本番ロジック非改変）
 *
 * backtest/route.ts の Pass1/Pass2 を忠実に再現しつつ、各レースの「全出走馬の
 * ev/edge/odds/hit」を中間データとして保持する。そこへ EDGE_MIN × ODDS_MAX の
 * 組み合わせを後掛けフィルタして ROI・的中率・対象レース数・賭け点数を集計する。
 *
 * EV_MIN は据え置き(0.10)。集計は TARGET_VERSION（既定 v1）に限定。
 *
 * 実行: npx tsx scripts/sim-thresholds.ts
 *
 * ▼ 方針・結論・今後の対応は docs/threshold-sweep-decision.md を参照。
 *   現時点の有力候補は EDGE_MIN=0.02 × ODDS_MAX=20（本番フィルタは未変更）。
 *   v2 データ蓄積後（2026-07-18 週〜）に TARGET_VERSION="v2" で再実行し傾向を再確認する。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { calculateScore } from "@/lib/engine";
import type { RacesCache } from "@/scripts/fetch-races";
import type { ResultsCache } from "@/scripts/fetch-results";
import type { HorseScores, ModelVersion } from "@/lib/scorer";

const EV_MIN = 0.10; // 据え置き
const EDGE_MINS = [0.02, 0.05, 0.08, 0.10];
const ODDS_MAXS = [50, 30, 20, 15];
const DEFAULT = 65;

// この分析は route.ts の byVersion.v1 に対応させる（v1・214R）
const TARGET_VERSION: ModelVersion = "v1";

type ScoresCache = Record<number, HorseScores>;

function loadJSON<T>(filename: string): T | null {
  try {
    const p = join(process.cwd(), "lib", filename);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

// 各レースの候補馬（EV_MIN のみ通過前の全馬情報を保持）
type Candidate = { ev: number; edge: number; odds: number; hit: boolean };
type RaceCand = { modelVersion: ModelVersion; horses: Candidate[] };

function buildRaces(): RaceCand[] {
  const racesCache = loadJSON<RacesCache>("races-cache.json");
  const scoresCache = loadJSON<{ scores?: Record<string, HorseScores> }>("scores-cache.json");
  const resultsCache = loadJSON<ResultsCache>("results-cache.json");
  if (!racesCache || !resultsCache) throw new Error("cache 不在");

  const scoresById: ScoresCache = {};
  for (const [k, v] of Object.entries(scoresCache?.scores ?? {})) scoresById[Number(k)] = v;

  const races: RaceCand[] = [];
  const processedNetIds = new Set<string>();

  // ── Pass 1: races-cache（スコアあり）──
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
      const rawTraining = cached ? (cached.trainingScore ?? null) : DEFAULT;
      const rawJockey = cached ? (cached.jockeyScore ?? null) : DEFAULT;
      return {
        id: h.id,
        name: h.horse,
        formScore: (cached?.formScore ?? DEFAULT) / 100,
        pedigreeScore: (cached?.pedigreeScore ?? DEFAULT) / 100,
        trainingScore: rawTraining == null ? null : rawTraining / 100,
        jockeyScore: rawJockey == null ? null : rawJockey / 100,
        odds: h.odds,
      };
    });

    const { evRanking } = calculateScore(inputs);
    const winner = resultEntry.finishers.find((f) => f.position === 1);
    const winnerName = winner?.horse ?? null;

    const horses: Candidate[] = evRanking.map((h) => {
      const hEntry = horsesWithOdds.find((e) => e.horse === h.name);
      const isHit =
        h.name === winnerName ||
        (winner?.horseNumber != null && hEntry?.horseNumber === winner.horseNumber);
      return { ev: h.ev, edge: h.edge, odds: h.odds, hit: !!isHit };
    });

    const raceVersion: ModelVersion = horsesWithOdds.some(
      (h) => scoresById[h.id]?.modelVersion === "v2"
    )
      ? "v2"
      : "v1";

    races.push({ modelVersion: raceVersion, horses });
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
      trainingScore: DEFAULT / 100,
      jockeyScore: DEFAULT / 100,
      odds: h.odds,
    }));

    const { evRanking } = calculateScore(inputs);
    const winner = resultEntry.finishers.find((f) => f.position === 1);
    const winnerName = winner?.horse ?? null;

    const horses: Candidate[] = evRanking.map((h) => {
      const hFin = horsesWithOdds.find((e) => e.horse === h.name);
      const isHit =
        h.name === winnerName ||
        (winner?.horseNumber != null && hFin?.horseNumber === winner.horseNumber);
      return { ev: h.ev, edge: h.edge, odds: h.odds, hit: !!isHit };
    });

    races.push({ modelVersion: "v1", horses });
  }

  return races;
}

type Stats = {
  targetRaces: number; // 対象レース数（1頭以上ベット対象）
  bets: number;        // 賭け点数
  hitRaces: number;    // 的中レース数
  hitRate: number;     // %
  invested: number;
  returned: number;
  roi: number;         // %
};

function simulate(races: RaceCand[], edgeMin: number, oddsMax: number): Stats {
  let targetRaces = 0;
  let bets = 0;
  let hitRaces = 0;
  let invested = 0;
  let returned = 0;
  for (const race of races) {
    const picked = race.horses.filter(
      (h) => h.ev > EV_MIN && h.edge > edgeMin && h.odds <= oddsMax
    );
    if (picked.length === 0) continue;
    targetRaces++;
    bets += picked.length;
    invested += picked.length; // 1点=1単位
    returned += picked.reduce((s, h) => s + (h.hit ? h.odds : 0), 0);
    if (picked.some((h) => h.hit)) hitRaces++;
  }
  const hitRate = targetRaces > 0 ? (hitRaces / targetRaces) * 100 : 0;
  const roi = invested > 0 ? ((returned - invested) / invested) * 100 : 0;
  return { targetRaces, bets, hitRaces, hitRate, invested, returned, roi };
}

function main() {
  const all = buildRaces();
  const races = all.filter((r) => r.modelVersion === TARGET_VERSION);
  console.log(`\n=== 閾値スイープ (version=${TARGET_VERSION}, EV_MIN=${EV_MIN}固定) ===`);
  console.log(`集計対象レース総数(結果あり): ${races.length}R  [全バージョン: ${all.length}R]\n`);

  const base = simulate(races, 0.02, 50);
  console.log(
    `ベースライン(EDGE_MIN=0.02, ODDS_MAX=50): ROI=${base.roi.toFixed(1)}%  対象=${base.targetRaces}R  的中率=${base.hitRate.toFixed(1)}%  点数=${base.bets}\n`
  );

  // ヘッダ
  const pad = (s: string, n: number) => s.padStart(n);
  console.log(
    "EDGE_MIN | ODDS_MAX |  対象R |  点数 | 的中率 |    ROI | ROI改善 | 対象R残率"
  );
  console.log("-".repeat(78));

  for (const edge of EDGE_MINS) {
    for (const oddsMax of ODDS_MAXS) {
      const s = simulate(races, edge, oddsMax);
      const roiDelta = s.roi - base.roi;
      const raceRetain = base.targetRaces > 0 ? (s.targetRaces / base.targetRaces) * 100 : 0;
      console.log(
        `${pad(edge.toFixed(2), 8)} | ${pad(String(oddsMax), 8)} | ${pad(String(s.targetRaces), 5)} | ${pad(String(s.bets), 5)} | ${pad(s.hitRate.toFixed(1) + "%", 6)} | ${pad(s.roi.toFixed(1) + "%", 6)} | ${pad((roiDelta >= 0 ? "+" : "") + roiDelta.toFixed(1), 6)} | ${pad(raceRetain.toFixed(0) + "%", 6)}`
      );
    }
    console.log("-".repeat(78));
  }
}

main();
