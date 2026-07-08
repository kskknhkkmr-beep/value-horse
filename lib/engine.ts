// VALUE HORSE - ENGINE (STABLE)

type Horse = {
  id: number;
  name: string;

  formScore: number;
  pedigreeScore: number;
  // 追い切り・騎手は取得不能なら null（欠損）。欠損時は重みを再配分する。
  trainingScore: number | null;
  jockeyScore: number | null;

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
// ベース要素の元ウェイト。欠損 feature は式から外し、残りの重みを合計 0.85
// （= 全ベースウェイト）へ再正規化する。全 feature が揃っていれば従来と完全一致。
const BASE_WEIGHT = { form: 0.3, pedigree: 0.2, training: 0.2, jockey: 0.15 };
const TOTAL_BASE_WEIGHT =
  BASE_WEIGHT.form + BASE_WEIGHT.pedigree + BASE_WEIGHT.training + BASE_WEIGHT.jockey;

export function calculateStrength(h: Horse): number {
  // 利用可能なベース要素のみを集める（form・pedigree は常に存在）
  const base: Array<{ value: number; weight: number }> = [
    { value: sigmoid(h.formScore), weight: BASE_WEIGHT.form },
    { value: Math.pow(h.pedigreeScore, 1.2), weight: BASE_WEIGHT.pedigree },
  ];
  if (h.trainingScore != null) {
    base.push({ value: sigmoid(h.trainingScore * 1.1), weight: BASE_WEIGHT.training });
  }
  if (h.jockeyScore != null) {
    base.push({ value: Math.pow(h.jockeyScore, 1.3), weight: BASE_WEIGHT.jockey });
  }

  // 欠損ぶんの重みを残り要素へ再配分（合計ウェイトを一定に保つ）
  const availWeight = base.reduce((s, b) => s + b.weight, 0);
  const scale = availWeight > 0 ? TOTAL_BASE_WEIGHT / availWeight : 0;
  const baseSum = base.reduce((s, b) => s + b.value * b.weight * scale, 0);

  // 交互作用は必要な feature が揃っている場合のみ加算
  let interaction = 0;
  if (h.jockeyScore != null) {
    interaction += jockeyHorseInteraction(h.jockeyScore, h.pedigreeScore) * 0.1;
  }
  if (h.trainingScore != null) {
    interaction += formTrainingInteraction(h.formScore, h.trainingScore) * 0.05;
  }

  return baseSum + interaction;
}

// -----------------------
// main model
// -----------------------
export function calculateScore(horses: Horse[]) {
  const strengths = horses.map(calculateStrength);

  // オーバーラウンド（控除率）: sum(1/odds) — 公正確率への補正に使う
  const overround = horses.reduce((s, h) => s + 1 / h.odds, 0);

  // 公正市場確率（オーバーラウンド除去済み、合計=1）
  const fairMarketProbs = horses.map((h) => 1 / h.odds / overround);

  // ── ソフトマックス（温度スケーリング付き）で純モデル確率を生成 ──
  // 温度 TEMP が大きいほど差が強調される
  // ペアワイズ平均は平滑化が強すぎるため、直接 softmax を使う
  const TEMP = 4.0;
  const expS = strengths.map((s) => Math.exp(s * TEMP));
  const expSum = expS.reduce((a, b) => a + b, 0);
  const modelProbs = expS.map((e) => e / expSum);

  // ── 市場確率とのブレンド（対数オッズ空間） ──
  // 市場価格はモデルが捉えられない情報（調教評価・馬体重変化等）を織り込んでいる
  // MARKET_WEIGHT: 0=純モデル, 1=純市場
  const MARKET_WEIGHT = 0.35;

  const blendedProbs = modelProbs.map((mp, i) => {
    const fm = fairMarketProbs[i];
    // 対数オッズブレンド（端値でのクラッシュ防止のため clamp）
    const logOddsModel = Math.log(Math.max(mp, 1e-6) / Math.max(1 - mp, 1e-6));
    const logOddsMarket = Math.log(Math.max(fm, 1e-6) / Math.max(1 - fm, 1e-6));
    const logOddsBlend = (1 - MARKET_WEIGHT) * logOddsModel + MARKET_WEIGHT * logOddsMarket;
    return 1 / (1 + Math.exp(-logOddsBlend));
  });

  // 合計を 1 に正規化
  const blendSum = blendedProbs.reduce((a, b) => a + b, 0);
  const finalProbs = blendedProbs.map((p) => p / blendSum);

  const finalScores: HorseWithScore[] = horses.map((h, i) => {
    const probability = finalProbs[i];
    const marketProb = fairMarketProbs[i]; // オーバーラウンド除去済み公正確率

    // edge: モデル確率 − 公正市場確率（正 = 市場が過小評価している）
    const edge = probability - marketProb;
    // ev: 実際の払い戻しオッズで計算した期待値（EV > 0 = プラス期待値）
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
