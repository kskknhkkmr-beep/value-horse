import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";
import { calculateScore } from "@/lib/engine";
import type { RacesCache } from "@/scripts/fetch-races";
import type { ResultsCache } from "@/scripts/fetch-results";
import type { HorseScores, ModelVersion } from "@/lib/scorer";

const EV_MIN = 0.10;
const EDGE_MIN = 0.02;
// 本番の買い目・records はこの上限で確定する（従来通り）。
const ODDS_MAX = 50;
// 並行計測する odds 上限。favorite-longshot bias 検証のため 20 を併記。
// いずれも records（odds<=ODDS_MAX）の部分集合なので records から派生集計する。
const ODDS_MAX_VARIANTS = [50, 20];
const DEFAULT = 65;

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

export type BacktestHorse = {
  horse: string;
  odds: number;
  hit: boolean;
  returnUnits: number; // 的中時 = odds, 外れ時 = 0
};

export type BacktestRaceRecord = {
  raceId: number;
  raceNumber: number;
  raceName: string;
  date: string;
  venue: string;
  winner: string | null;
  horses: BacktestHorse[];  // EV+と判定した馬の詳細
  hit: boolean;             // いずれかの馬が的中
  investedUnits: number;
  returnUnits: number;
  modelVersion: ModelVersion; // このレースのスコアを算出したモデルのバージョン
};

export type BacktestStats = {
  racesWithResult: number;
  racesWithEvPositive: number;
  totalBets: number;
  totalReturn: number;
  roi: number;
  hitRate: number;
};

// odds 上限ごとの集計（全体 + モデルバージョン別）
export type OddsMaxVariant = {
  overall: BacktestStats;
  byVersion: Record<ModelVersion, BacktestStats>;
};

export type BacktestResponse = {
  totalRaces: number;
  racesWithResult: number;
  racesWithEvPositive: number;
  totalBets: number;
  totalReturn: number;
  roi: number;
  hitRate: number;
  realDataOnly: boolean;
  // モデルバージョン別の分離集計（v1/v2 を混ぜて表示しないため）
  byVersion: Record<ModelVersion, BacktestStats>;
  // odds 上限別（"50"=本番, "20"=引き下げ案）の並行計測結果
  oddsMaxVariants: Record<string, OddsMaxVariant>;
  records: BacktestRaceRecord[];
};

/** レコード集合から集計統計を算出 */
function computeStats(records: BacktestRaceRecord[]): BacktestStats {
  const racesWithResult = records.length;
  const withEv = records.filter((r) => r.investedUnits > 0);
  const racesWithEvPositive = withEv.length;
  const totalBets = records.reduce((s, r) => s + r.investedUnits, 0);
  const totalReturn = records.reduce((s, r) => s + r.returnUnits, 0);
  const roi = totalBets > 0 ? ((totalReturn - totalBets) / totalBets) * 100 : 0;
  const hitRaceCount = withEv.filter((r) => r.hit).length;
  const hitRate = racesWithEvPositive > 0 ? (hitRaceCount / racesWithEvPositive) * 100 : 0;
  return { racesWithResult, racesWithEvPositive, totalBets, totalReturn, roi, hitRate };
}

/**
 * odds 上限 cap で records を再フィルタして集計（全体 + バージョン別）。
 * records は既に odds<=ODDS_MAX の馬のみを持つため、cap<=ODDS_MAX なら
 * 各レコードの馬を odds<=cap で絞り直すだけで派生集計できる。
 */
function computeVariant(records: BacktestRaceRecord[], cap: number): OddsMaxVariant {
  const adj: BacktestRaceRecord[] = records.map((r) => {
    const horses = r.horses.filter((h) => h.odds <= cap);
    return {
      ...r,
      horses,
      hit: horses.some((h) => h.hit),
      investedUnits: horses.length,
      returnUnits: horses.reduce((s, h) => s + h.returnUnits, 0),
    };
  });
  return {
    overall: computeStats(adj),
    byVersion: {
      v1: computeStats(adj.filter((r) => r.modelVersion === "v1")),
      v2: computeStats(adj.filter((r) => r.modelVersion === "v2")),
    },
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const realDataOnly = searchParams.get("realDataOnly") === "1";

  const racesCache = loadJSON<RacesCache>("races-cache.json");
  const scoresCache = loadJSON<{ scores?: Record<string, HorseScores> }>("scores-cache.json");
  const resultsCache = loadJSON<ResultsCache>("results-cache.json");

  if (!racesCache || !resultsCache) {
    return NextResponse.json(
      { error: "races-cache.json または results-cache.json が見つかりません" },
      { status: 404 }
    );
  }

  const scoresById: ScoresCache = {};
  for (const [k, v] of Object.entries(scoresCache?.scores ?? {})) {
    scoresById[Number(k)] = v;
  }

  const records: BacktestRaceRecord[] = [];
  const processedNetIds = new Set<string>();

  // ── Pass 1: races-cache に存在するレース（スコアあり・現行週）──
  for (const race of racesCache.races) {
    if (race.entriesPending || race.horses.length === 0) continue;

    // realDataOnly: formScore・pedigreeScore が全頭実データ（≠65）のレースに限定
    if (realDataOnly) {
      const allReal = race.horses.every((h) => {
        const s = scoresById[h.id];
        return s && s.formScore !== DEFAULT && s.pedigreeScore !== DEFAULT;
      });
      if (!allReal) continue;
    }

    const resultEntry = resultsCache.results.find(
      (r) => r.netKeibaRaceId === race.netKeibaRaceId
    );
    if (!resultEntry || resultEntry.finishers.length === 0) continue;

    processedNetIds.add(race.netKeibaRaceId);

    // races-cache の odds が null の場合は results-cache の確定オッズを補完
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
      // training/jockey は欠損を null で保持（cached の null を DEFAULT で埋めない）
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
    const evPositiveHorses = evRanking.filter(
      (h) => h.ev > EV_MIN && h.edge > EDGE_MIN && h.odds <= ODDS_MAX
    );

    const winner = resultEntry.finishers.find((f) => f.position === 1);
    const winnerName = winner?.horse ?? null;

    const horsesDetail: BacktestHorse[] = evPositiveHorses.map((h) => {
      const hEntry = horsesWithOdds.find((e) => e.horse === h.name);
      const isHit =
        h.name === winnerName ||
        (winner?.horseNumber != null && hEntry?.horseNumber === winner.horseNumber);
      return { horse: h.name, odds: h.odds, hit: isHit, returnUnits: isHit ? h.odds : 0 };
    });

    // レースのモデルバージョン: 出走馬に v2 スコアが1頭でもあれば v2、なければ v1
    const raceVersion: ModelVersion = horsesWithOdds.some(
      (h) => scoresById[h.id]?.modelVersion === "v2"
    )
      ? "v2"
      : "v1";

    records.push({
      raceId: race.id,
      raceNumber: race.raceNumber,
      raceName: race.raceName,
      date: race.date,
      venue: race.venue,
      winner: winnerName,
      horses: horsesDetail,
      hit: horsesDetail.some((h) => h.hit),
      investedUnits: horsesDetail.length,
      returnUnits: horsesDetail.reduce((s, h) => s + h.returnUnits, 0),
      modelVersion: raceVersion,
    });
  }

  // ── Pass 2: results-cache のみに存在する過去週データ（デフォルトスコア）──
  // realDataOnly 時はスコア実データが存在しないため過去データをスキップ
  if (!realDataOnly) {
    for (const resultEntry of resultsCache.results) {
      if (processedNetIds.has(resultEntry.netKeibaRaceId)) continue;
      if (resultEntry.finishers.length === 0) continue;

      // netKeibaRaceId 末尾2桁がレース番号（例: 202602010301 → 01 → 1R）
      const raceNumber =
        (resultEntry as { raceNumber?: number }).raceNumber ??
        parseInt(resultEntry.netKeibaRaceId.slice(-2), 10);

      const horsesWithOdds = resultEntry.finishers
        .filter((f) => f.odds != null && f.odds > 0)
        .map((f) => ({
          horse: f.horse,
          horseNumber: f.horseNumber,
          odds: f.odds as number,
        }));

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
      const evPositiveHorses = evRanking.filter(
        (h) => h.ev > EV_MIN && h.edge > EDGE_MIN && h.odds <= ODDS_MAX
      );

      const winner = resultEntry.finishers.find((f) => f.position === 1);
      const winnerName = winner?.horse ?? null;

      const horsesDetail: BacktestHorse[] = evPositiveHorses.map((h) => {
        const hFinisher = horsesWithOdds.find((e) => e.horse === h.name);
        const isHit =
          h.name === winnerName ||
          (winner?.horseNumber != null && hFinisher?.horseNumber === winner.horseNumber);
        return { horse: h.name, odds: h.odds, hit: isHit, returnUnits: isHit ? h.odds : 0 };
      });

      records.push({
        raceId: resultEntry.raceId,
        raceNumber,
        raceName: resultEntry.raceName,
        date: resultEntry.date,
        venue: resultEntry.venue,
        winner: winnerName,
        horses: horsesDetail,
        hit: horsesDetail.some((h) => h.hit),
        investedUnits: horsesDetail.length,
        returnUnits: horsesDetail.reduce((s, h) => s + h.returnUnits, 0),
        modelVersion: "v1", // 過去週データ（デフォルトスコア）は旧モデル扱い
      });
    }
  }

  // date → venue → raceNumber でソート
  records.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const v = a.venue.localeCompare(b.venue);
    if (v !== 0) return v;
    return a.raceNumber - b.raceNumber;
  });

  // odds 上限別の並行計測（"50"=本番, "20"=引き下げ案 …）
  const oddsMaxVariants: Record<string, OddsMaxVariant> = {};
  for (const cap of ODDS_MAX_VARIANTS) {
    oddsMaxVariants[String(cap)] = computeVariant(records, cap);
  }

  // トップレベル・byVersion は本番 ODDS_MAX(=50) 相当（従来互換）
  const primary = oddsMaxVariants[String(ODDS_MAX)];

  return NextResponse.json({
    totalRaces: records.length,
    ...primary.overall,
    realDataOnly,
    byVersion: primary.byVersion,
    oddsMaxVariants,
    records,
  } satisfies BacktestResponse);
}
