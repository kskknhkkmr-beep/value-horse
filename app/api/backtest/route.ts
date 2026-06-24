import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";
import { calculateScore } from "@/lib/engine";
import type { RacesCache } from "@/scripts/fetch-races";
import type { ResultsCache } from "@/scripts/fetch-results";
import type { HorseScores } from "@/lib/scorer";

const EV_MIN = 0.10;
const EDGE_MIN = 0.02;
const ODDS_MAX = 30;

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
  raceName: string;
  date: string;
  venue: string;
  winner: string | null;
  horses: BacktestHorse[];  // EV+と判定した馬の詳細
  hit: boolean;             // いずれかの馬が的中
  investedUnits: number;
  returnUnits: number;
};

export type BacktestResponse = {
  totalRaces: number;
  racesWithResult: number;
  racesWithEvPositive: number;
  totalBets: number;
  totalReturn: number;
  roi: number;                 // (totalReturn - totalBets) / totalBets * 100
  hitRate: number;             // 1着的中率（EV+馬が1着に入ったレース / EV+馬がいたレース）
  records: BacktestRaceRecord[];
};

export async function GET() {
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

  for (const race of racesCache.races) {
    if (race.entriesPending || race.horses.length === 0) continue;

    const resultEntry = resultsCache.results.find((r) => r.raceId === race.id);
    if (!resultEntry || resultEntry.finishers.length === 0) continue;

    // races-cache の odds が null の場合は results-cache の確定オッズを補完
    const finisherOddsMap = new Map<string, number>();
    for (const f of resultEntry.finishers) {
      if (f.odds != null && f.odds > 0) finisherOddsMap.set(f.horse, f.odds);
    }

    const horsesWithOdds = race.horses
      .map((h) => ({ ...h, odds: h.odds ?? finisherOddsMap.get(h.horse) ?? null }))
      .filter((h): h is typeof h & { odds: number } => h.odds != null && h.odds > 0);

    if (horsesWithOdds.length === 0) continue;

    const DEFAULT = 65;
    const inputs = horsesWithOdds.map((h) => {
      const cached = scoresById[h.id];
      return {
        id: h.id,
        name: h.horse,
        formScore: (cached?.formScore ?? DEFAULT) / 100,
        pedigreeScore: (cached?.pedigreeScore ?? DEFAULT) / 100,
        trainingScore: (cached?.trainingScore ?? DEFAULT) / 100,
        jockeyScore: (cached?.jockeyScore ?? DEFAULT) / 100,
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

    const hit = horsesDetail.some((h) => h.hit);
    const investedUnits = horsesDetail.length;
    const returnUnits = horsesDetail.reduce((s, h) => s + h.returnUnits, 0);

    records.push({
      raceId: race.id,
      raceName: race.raceName,
      date: race.date,
      venue: race.venue,
      winner: winnerName,
      horses: horsesDetail,
      hit,
      investedUnits,
      returnUnits,
    });
  }

  const racesWithResult = records.length;
  const racesWithEvPositive = records.filter((r) => r.investedUnits > 0).length;
  const totalBets = records.reduce((s, r) => s + r.investedUnits, 0);
  const totalReturn = records.reduce((s, r) => s + r.returnUnits, 0);
  const roi = totalBets > 0 ? ((totalReturn - totalBets) / totalBets) * 100 : 0;
  const hitRaceCount = records.filter((r) => r.investedUnits > 0 && r.hit).length;
  const hitRate = racesWithEvPositive > 0 ? (hitRaceCount / racesWithEvPositive) * 100 : 0;

  return NextResponse.json({
    totalRaces: racesCache.races.length,
    racesWithResult,
    racesWithEvPositive,
    totalBets,
    totalReturn,
    roi,
    hitRate,
    records,
  } satisfies BacktestResponse);
}
