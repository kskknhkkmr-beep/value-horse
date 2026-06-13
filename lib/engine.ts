// VALUE HORSE - ENGINE (STABLE)

type Horse = {
  id: number;
  name: string;

  formScore: number;
  pedigreeScore: number;
  trainingScore: number;
  jockeyScore: number;

  odds: number;
};

type HorseWithScore = Horse & {
  strength: number;
  probability: number;
  marketProb: number;
  edge: number;
  ev: number;
  valueRating: number;
};

// -----------------------
// utils
// -----------------------
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-10 * (x - 0.5)));
}

// -----------------------
// interaction
// -----------------------
function jockeyHorseInteraction(j: number, p: number): number {
  return sigmoid(j * 0.6 + p * 0.4);
}

function formTrainingInteraction(f: number, t: number): number {
  return Math.pow(f * t, 0.5);
}

// -----------------------
// strength
// -----------------------
export function calculateStrength(h: Horse): number {
  const form = sigmoid(h.formScore);
  const pedigree = Math.pow(h.pedigreeScore, 1.2);
  const training = sigmoid(h.trainingScore * 1.1);
  const jockey = Math.pow(h.jockeyScore, 1.3);

  const interaction =
    jockeyHorseInteraction(h.jockeyScore, h.pedigreeScore) * 0.1 +
    formTrainingInteraction(h.formScore, h.trainingScore) * 0.05;

  return form * 0.3 + pedigree * 0.2 + training * 0.2 + jockey * 0.15 + interaction;
}

// -----------------------
// Bradley-Terry
// -----------------------
function bt(si: number, sj: number): number {
  return Math.exp(si) / (Math.exp(si) + Math.exp(sj));
}

// -----------------------
// main model
// -----------------------
export function calculateScore(horses: Horse[]) {
  const strengths = horses.map(calculateStrength);

  const probs = strengths.map((si, i) => {
    let score = 0;
    for (let j = 0; j < strengths.length; j++) {
      if (i === j) continue;
      score += bt(si, strengths[j]);
    }
    return score / (strengths.length - 1);
  });

  const sum = probs.reduce((a, b) => a + b, 0);

  const finalScores: HorseWithScore[] = horses.map((h, i) => {
    const probability = probs[i] / sum;
    const marketProb = 1 / h.odds;

    const edge = probability - marketProb;
    const ev = probability * h.odds - 1;

    return {
      ...h,
      strength: strengths[i],
      probability,
      marketProb,
      edge,
      ev,
      valueRating: edge * 100 + ev * 10,
    };
  });

  return {
    finalScores,
    valueRanking: [...finalScores].sort((a, b) => b.valueRating - a.valueRating),
    evRanking: [...finalScores].sort((a, b) => b.ev - a.ev),
    edgeRanking: [...finalScores].sort((a, b) => b.edge - a.edge),
  };
}