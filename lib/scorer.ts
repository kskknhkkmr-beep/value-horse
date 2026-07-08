export interface RaceResult {
  date: string;
  surface: "芝" | "ダ" | "障";
  distance: number;
  position: number;
  fieldSize: number;
}

export interface JockeyStats {
  wins: number;
  rides: number;
  places: number; // 1着 + 2着の合計
}

/**
 * モデルバージョン。算出コードの実体が変わった境界を表す。
 *   v1: jockeyScore・trainingScore がデフォルト値(65)固定だった旧モデル（2feature相当、〜2026-07-05）
 *   v2: jockeyScore・trainingScore を実データ化した現行モデル（4feature、be7add6 以降）
 */
export type ModelVersion = "v1" | "v2";

/** 現行 fetch-scores が付与するモデルバージョン */
export const CURRENT_MODEL_VERSION: ModelVersion = "v2";

export interface HorseScores {
  formScore: number;
  pedigreeScore: number;
  jockeyScore: number;
  trainingScore: number;
  /** このスコアを算出したコードのバージョン。未設定(旧データ)は v1 とみなす。 */
  modelVersion?: ModelVersion;
  /** このスコアを算出した時刻(ISO)。 */
  computedAt?: string;
}

// 直近レースほど高ウェイト
const FORM_WEIGHTS = [0.40, 0.25, 0.15, 0.12, 0.08];

/**
 * 近走成績から形状スコアを計算（0-100）
 * 直近5走の着順を加重平均。1着=100、最下位=0 に正規化。
 */
export function calcFormScore(results: RaceResult[]): number {
  const valid = results
    .filter((r) => r.position >= 1 && r.fieldSize >= 2)
    .slice(0, 5);
  if (valid.length === 0) return 65;

  let wSum = 0;
  let wTotal = 0;
  valid.forEach((r, i) => {
    const w = FORM_WEIGHTS[i] ?? 0.05;
    const score = (100 * (r.fieldSize - r.position)) / (r.fieldSize - 1);
    wSum += w * Math.max(0, score);
    wTotal += w;
  });

  return Math.round(wSum / wTotal);
}

/**
 * 同コース・同距離(±200m)の成績から適性スコアを計算（0-100）
 * 該当レースが2走未満の場合は全成績で代替。
 */
export function calcPedigreeScore(
  results: RaceResult[],
  surface: "芝" | "ダ" | "障",
  distance: number
): number {
  const valid = results.filter((r) => r.position >= 1 && r.fieldSize >= 2);
  const matched = valid.filter(
    (r) => r.surface === surface && Math.abs(r.distance - distance) <= 200
  );

  const pool = matched.length >= 2 ? matched : valid;
  if (pool.length === 0) return 65;

  const avg =
    pool.reduce(
      (sum, r) => sum + (100 * (r.fieldSize - r.position)) / (r.fieldSize - 1),
      0
    ) / pool.length;

  return Math.round(Math.max(0, avg));
}

/**
 * 騎手の勝率・連対率からスコアを計算（0-100）
 * JRAトップ騎手: 勝率~20% → 約80点, 連対率~35% → 約52点
 */
export function calcJockeyScore(stats: JockeyStats): number {
  if (stats.rides === 0) return 65;
  const winRate = stats.wins / stats.rides;
  const placeRate = stats.places / stats.rides;
  const raw = winRate * 400 + placeRate * 150;
  return Math.min(95, Math.max(40, Math.round(raw)));
}
