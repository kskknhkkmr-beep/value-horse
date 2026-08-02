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
 * 騎手の年度別成績テーブルの1行（集約前の生データ）。
 * label は "累計"（キャリア通算）または西暦4桁。
 * 生のまま保存しておくことで、cutoff ルールや MIN_RIDES を変えても
 * 再スクレイピングなしにオフラインで再導出できる。
 */
export interface JockeyYearRow {
  label: string;
  wins: number;
  seconds: number;
  thirds: number;
  others: number;
}

/** 年度成績の騎乗数がこれ未満の場合、さらに過去の年度と合算してサンプルを確保する */
export const MIN_RIDES_FOR_YEAR = 30;

/**
 * モデルバージョン。算出コードの実体が変わった境界を表す。
 *   v1: jockeyScore・trainingScore がデフォルト値(65)固定だった旧モデル（2feature相当、〜2026-07-05）
 *   v2: jockeyScore・trainingScore を実データ化した現行モデル（4feature、be7add6 以降）
 *       ※ trainingScore は後に除去、jockeyScore は後にクランプ解除（是正案①②）。
 *   v3: jockeyScore を「年度 < レース年」の行のみから導出したリーク無しモデル
 *       （バックテスト専用。本番ライブ経路は v2 のまま）。
 */
export type ModelVersion = "v1" | "v2" | "v3";

/** 現行 fetch-scores が付与するモデルバージョン */
export const CURRENT_MODEL_VERSION: ModelVersion = "v2";

export interface HorseScores {
  formScore: number;
  pedigreeScore: number;
  /** 騎手スコア。取得不能な場合は null（「データ欠損」を「平均評価」と区別する）。 */
  jockeyScore: number | null;
  /**
   * jockeyScore の元になった生スタッツ（wins/rides/places）。取得不能な場合は null。
   * 正規化方法（clamp・パーセンタイル化等）を見直す際に再スクレイピングなしで
   * 再計算できるよう、計算済みスコアと一緒に保持する。
   */
  jockeyStats: JockeyStats | null;
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
 * 騎手の勝率・連対率からスコアを計算（0-100想定域だが上限は設けない）
 * JRAトップ騎手: 勝率~20% → 約80点, 連対率~35% → 約52点
 * 騎乗実績が無い場合は null（欠損）を返す。
 *
 * 以前は 40〜95 に clamp していたが、下位騎手の約4割が下限40に張り付き
 * 実力差の情報が失われていたため撤廃（是正案②）。
 */
export function calcJockeyScore(stats: JockeyStats): number | null {
  if (stats.rides === 0) return null;
  const winRate = stats.wins / stats.rides;
  const placeRate = stats.places / stats.rides;
  const raw = winRate * 400 + placeRate * 150;
  return Math.round(raw);
}

/**
 * 年度別の生成績から、レース年 Y 時点で「未来を見ていない」JockeyStats を導出する（純関数）。
 *
 * 遡及バックフィルでは、当年（進行中）の行にはレース後の騎乗結果が混入するため使えない。
 * 「年度 < Y の行のみ」を使い、サンプル不足時のフォールバックは必ず過去方向へ倒す。
 *   1. 既定              → 年度 Y−1
 *   2. rides < MIN       → Y−1 + Y−2
 *   3. なお rides < MIN  → 年度 < Y の全行を合算
 *   4. 年度 < Y の行が皆無（当年デビュー） → null（欠損。デフォルト値では埋めない）
 *
 * 「累計」行はキャリア通算＝当年を含むため使用しない。
 */
export function resolveJockeyStats(
  rows: JockeyYearRow[],
  raceYear: number
): JockeyStats | null {
  const past = rows
    .filter((r) => /^\d{4}$/.test(r.label) && Number(r.label) < raceYear)
    .sort((a, b) => Number(b.label) - Number(a.label)); // 新しい年度から降順

  if (past.length === 0) return null;

  const sum = (n: number): JockeyStats => {
    const taken = past.slice(0, n);
    const wins = taken.reduce((s, r) => s + r.wins, 0);
    const seconds = taken.reduce((s, r) => s + r.seconds, 0);
    const rides = taken.reduce((s, r) => s + r.wins + r.seconds + r.thirds + r.others, 0);
    return { wins, places: wins + seconds, rides };
  };

  for (const n of [1, 2, past.length]) {
    const stats = sum(n);
    if (stats.rides >= MIN_RIDES_FOR_YEAR) return stats;
  }

  const all = sum(past.length);
  return all.rides > 0 ? all : null;
}
