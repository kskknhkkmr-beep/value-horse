import { calculateScore } from "./engine";

type RaceResult = {
  raceId: number;
  horses: {
    id: number;
    name: string;

    formScore: number;
    pedigreeScore: number;
    trainingScore: number;
    jockeyScore: number;

    odds: number;
    finishedPosition: number;
  }[];
};

export type BacktestResult = {
  totalRaces: number;
  roi: number;
  totalReturn: number;
  avgEV: number;
  avgEdge: number;
  hitRateTop1: number;
  hitRateTop3: number;
};

export function runBacktest(races: RaceResult[]): BacktestResult {
  let totalReturn = 0;
  let totalEV = 0;
  let totalEdge = 0;

  let top1 = 0;
  let top3 = 0;

  const totalRaces = races.length;

  for (const race of races) {
    const result = calculateScore(race.horses);
    const ranked = result.valueRanking;

    const winner = race.horses.find(h => h.finishedPosition === 1);

    const top3Actual = race.horses
      .filter(h => h.finishedPosition <= 3)
      .map(h => h.id);

    if (ranked[0].id === winner?.id) top1++;

    const predictedTop3 = ranked.slice(0, 3).map(h => h.id);

    if (predictedTop3.some(id => top3Actual.includes(id))) {
      top3++;
    }

    const predictedWinner = ranked[0];

    if (winner) {
      if (predictedWinner.id === winner.id) {
        totalReturn += predictedWinner.odds - 1;
      } else {
        totalReturn -= 1;
      }
    }

    for (const h of result.finalScores) {
      totalEV += h.ev;
      totalEdge += h.edge;
    }
  }

  const totalHorses = races.reduce((s, r) => s + r.horses.length, 0);

  return {
    totalRaces,
    totalReturn,
    roi: totalReturn / totalRaces,
    avgEV: totalEV / totalHorses,
    avgEdge: totalEdge / totalHorses,
    hitRateTop1: top1 / totalRaces,
    hitRateTop3: top3 / totalRaces,
  };
}
