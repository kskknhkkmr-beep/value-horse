const WEIGHTS = {
  form: 0.35,
  pedigree: 0.20,
  training: 0.25,
  jockey: 0.20,
};

export type HorseInput = {
  id: number;
  name: string;
  formScore: number;
  pedigreeScore: number;
  trainingScore: number;
  jockeyScore: number;
  odds: number;
  finishedPosition?: number;
};

export type HorseScore = {
  id: number;
  name: string;
  odds: number;
  latentStrength: number;
  modelProb: number;
  marketProb: number;
  edge: number;
  ev: number;
};

export type ScoreResult = {
  valueRanking: HorseScore[];
  finalScores: HorseScore[];
};

export function calculateScore(horses: HorseInput[]): ScoreResult {
  // latent strength: weighted linear combination of features
  const withStrength = horses.map(h => ({
    ...h,
    latentStrength:
      WEIGHTS.form * h.formScore +
      WEIGHTS.pedigree * h.pedigreeScore +
      WEIGHTS.training * h.trainingScore +
      WEIGHTS.jockey * h.jockeyScore,
  }));

  // Bradley-Terry win probability via softmax over latent strengths
  const expStrengths = withStrength.map(h => Math.exp(h.latentStrength));
  const sumExp = expStrengths.reduce((s, v) => s + v, 0);

  // Normalize market probabilities to remove bookmaker vig
  const rawMarketProbs = horses.map(h => 1 / h.odds);
  const sumMarket = rawMarketProbs.reduce((s, v) => s + v, 0);

  const scores: HorseScore[] = withStrength.map((h, i) => {
    const modelProb = expStrengths[i] / sumExp;
    const marketProb = rawMarketProbs[i] / sumMarket;
    const edge = modelProb - marketProb;
    // EV per unit bet: expected return - 1 unit staked
    const ev = modelProb * h.odds - 1;
    return {
      id: h.id,
      name: h.name,
      odds: h.odds,
      latentStrength: h.latentStrength,
      modelProb,
      marketProb,
      edge,
      ev,
    };
  });

  const valueRanking = [...scores].sort((a, b) => b.ev - a.ev);

  return { valueRanking, finalScores: scores };
}
