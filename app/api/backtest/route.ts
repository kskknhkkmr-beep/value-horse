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

export type BacktestRaceRecord = {
  raceId: number;
  raceName: string;
  date: string;
  venue: string;
  evPositive: string[];        // EV+と判定した馬名リスト
  winner: string | null;       // 実際の1着馬名
  hit: boolean;                // EV+馬が1着に入ったか
  investedUnits: number;       // 投じた単位数（EV+馬の頭数）
  returnUnits: number;         // 実際の払い戻し（単位）
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

    const horsesWithOdds = race.horses.filter((h) => h.odds != null && h.odds > 0);
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
        odds: h.odds!,
      };
    });

    const { evRanking } = calculateScore(inputs);
    const evPositiveHorses = evRanking.filter(
      (h) => h.ev > EV_MIN && h.edge > EDGE_MIN && h.odds <= ODDS_MAX
    );

    const winner = resultEntry.finishers.find((f) => f.position === 1);
    const winnerName = winner?.horse ?? null;

    const hit = evPositiveHorses.some((h) => h.name === winnerName) ||
      evPositiveHorses.some((h) => {
        // 馬番でも照合（名前の表記揺れ対策）
        const wNum = winner?.horseNumber;
        const hEntry = horsesWithOdds.find((e) => e.horse === h.name);
        return wNum != null && hEntry?.horseNumber === wNum;
      });

    const winnerOdds = (() => {
      const w = horsesWithOdds.find(
        (e) => e.horse === winnerName || e.horseNumber === winner?.horseNumber
      );
      return w?.odds ?? null;
    })();

    const investedUnits = evPositiveHorses.length;
    const returnUnits = hit && winnerOdds != null ? winnerOdds : 0;

    records.push({
      raceId: race.id,
      raceName: race.raceName,
      date: race.date,
      venue: race.venue,
      evPositive: evPositiveHorses.map((h) => h.name),
      winner: winnerName,
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
