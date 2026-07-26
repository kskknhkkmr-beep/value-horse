/**
 * EV値を0〜5の星評価（0.5刻み）に変換する共通ユーティリティ。
 *
 * 現状は重賞レース（G1/G2/G3）の本命馬・単勝リストにのみ適用しているが、
 * 将来的に全レースへ展開できるよう、表示対象を問わない汎用関数として独立させている。
 *
 * 区切り値は等間隔方式（パーセンタイル等の動的基準は不使用）。
 * 紐付けバグ是正済み384R（結果確定336R、本命馬が存在する324R）の実データで
 * 本命馬EVの分布を確認し、p90(≈1.97)に近い切りの良い数値としてEV=2.0を
 * 5★の上限に採用した（EV=2.0以上は一律5★に丸める）。
 */
export const EV_STAR_CAP = 2.0;

/** EV値を0〜5の星評価に変換する（0.5刻みに丸め、cap以上は5★で頭打ち）。 */
export function evToStars(ev: number, cap: number = EV_STAR_CAP): number {
  const clamped = Math.max(0, Math.min(ev, cap));
  const raw = (clamped / cap) * 5;
  return Math.round(raw * 2) / 2;
}

/**
 * 星評価(0〜5、任意の粒度)を、星1つずつの塗りつぶし率(0/10/20/.../100)の配列に変換する。
 * UIはこの配列を使って星を1個ずつ10%刻みでレンダリングする
 * （evToStars の0.5刻み入力は各星が0%・50%・100%のいずれかになる）。
 */
export function starFillPercents(stars: number): number[] {
  const clamped = Math.max(0, Math.min(stars, 5));
  return Array.from({ length: 5 }, (_, i) => {
    const fill = Math.max(0, Math.min(1, clamped - i));
    return Math.round((fill * 100) / 10) * 10;
  });
}
