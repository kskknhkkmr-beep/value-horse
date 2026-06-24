/**
 * Harville 式による複合券種の EV 計算
 *
 * 推定市場オッズ = (1 - 控除率) / Harville(市場確率)
 * EV = Harville(モデル確率) × 推定市場オッズ - 1
 */

// 各券種の控除率（JRA 公式）
const TAKEOUT: Record<string, number> = {
  umaren: 0.225,
  umatan: 0.25,
  wide: 0.225,
  sanrenpuku: 0.25,
  sanrentan: 0.275,
};

export type ComboType = "umaren" | "umatan" | "wide" | "sanrenpuku" | "sanrentan";

export type ComboBet = {
  type: ComboType;
  label: string;       // "3-7" / "3→7" / "3-7-9" etc.
  horses: string[];    // 馬名（表示順）
  horseNumbers: number[];
  estOdds: number;     // 推定市場オッズ
  ev: number;          // EV (0.10 = +10%)
};

export type HarvilleInput = {
  name: string;
  horseNumber: number;
  probability: number;  // モデル確率
  marketProb: number;   // 公正市場確率
};

// ── Harville 基本関数 ─────────────────────────────────────────────────────────

function h12(p: number[], i: number, j: number): number {
  const d = 1 - p[i];
  return d > 0 ? p[i] * p[j] / d : 0;
}

function h123(p: number[], i: number, j: number, k: number): number {
  const d2 = 1 - p[i];
  const d3 = 1 - p[i] - p[j];
  return d2 > 0 && d3 > 0 ? p[i] * (p[j] / d2) * (p[k] / d3) : 0;
}

// 馬連: A,B が 1・2 着（順不同）
function pQuinella(p: number[], a: number, b: number): number {
  return h12(p, a, b) + h12(p, b, a);
}

// 馬単: A が 1 着、B が 2 着
function pExacta(p: number[], a: number, b: number): number {
  return h12(p, a, b);
}

// ワイド: A,B が 3 着以内（順不同）
function pWide(p: number[], a: number, b: number): number {
  let total = 0;
  for (let k = 0; k < p.length; k++) {
    if (k === a || k === b) continue;
    total +=
      h123(p, a, b, k) + h123(p, a, k, b) +
      h123(p, b, a, k) + h123(p, b, k, a) +
      h123(p, k, a, b) + h123(p, k, b, a);
  }
  return total;
}

// 三連複: A,B,C が 3 着以内（順不同）
function pTrio(p: number[], a: number, b: number, c: number): number {
  return (
    h123(p, a, b, c) + h123(p, a, c, b) +
    h123(p, b, a, c) + h123(p, b, c, a) +
    h123(p, c, a, b) + h123(p, c, b, a)
  );
}

// 三連単: A→B→C
function pTrifecta(p: number[], a: number, b: number, c: number): number {
  return h123(p, a, b, c);
}

// ── EV 計算ヘルパー ───────────────────────────────────────────────────────────

function ev(
  modelP: number,
  marketP: number,
  takeout: number,
  minMarketP = 1e-6
): number {
  if (marketP < minMarketP) return -1;
  const estOdds = (1 - takeout) / marketP;
  return modelP * estOdds - 1;
}

function estOdds(marketP: number, takeout: number): number {
  return (1 - takeout) / Math.max(marketP, 1e-6);
}

// ── メイン関数 ────────────────────────────────────────────────────────────────

const MAX_PER_TYPE = 5;
const EV_THRESHOLD = 0.0; // 0 より大きければ表示

/**
 * 上位 N 頭を対象に全券種の EV を計算し、正のものだけ返す。
 * 計算コスト削減のため top-8 に絞る。
 */
export function calcComboBets(horses: HarvilleInput[]): ComboBet[] {
  if (horses.length < 2) return [];

  // モデル確率降順で上位 8 頭
  const top = [...horses]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 8);

  const n = top.length;

  // 正規化
  const mSum = top.reduce((s, h) => s + h.probability, 0);
  const fSum = top.reduce((s, h) => s + h.marketProb, 0);
  const mp = top.map((h) => h.probability / mSum);
  const fp = top.map((h) => h.marketProb / fSum);

  const results: ComboBet[] = [];

  // 馬連
  const umaren: ComboBet[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const e = ev(pQuinella(mp, a, b), pQuinella(fp, a, b), TAKEOUT.umaren);
      if (e <= EV_THRESHOLD) continue;
      const [ha, hb] = [top[a], top[b]].sort((x, y) => x.horseNumber - y.horseNumber);
      umaren.push({
        type: "umaren",
        label: `${ha.horseNumber}-${hb.horseNumber}`,
        horses: [ha.name, hb.name],
        horseNumbers: [ha.horseNumber, hb.horseNumber],
        estOdds: estOdds(pQuinella(fp, a, b), TAKEOUT.umaren),
        ev: e,
      });
    }
  }
  results.push(...umaren.sort((a, b) => b.ev - a.ev).slice(0, MAX_PER_TYPE));

  // 馬単
  const umatan: ComboBet[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const e = ev(pExacta(mp, a, b), pExacta(fp, a, b), TAKEOUT.umatan);
      if (e <= EV_THRESHOLD) continue;
      umatan.push({
        type: "umatan",
        label: `${top[a].horseNumber}→${top[b].horseNumber}`,
        horses: [top[a].name, top[b].name],
        horseNumbers: [top[a].horseNumber, top[b].horseNumber],
        estOdds: estOdds(pExacta(fp, a, b), TAKEOUT.umatan),
        ev: e,
      });
    }
  }
  results.push(...umatan.sort((a, b) => b.ev - a.ev).slice(0, MAX_PER_TYPE));

  // ワイド
  if (n >= 3) {
    const wide: ComboBet[] = [];
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const e = ev(pWide(mp, a, b), pWide(fp, a, b), TAKEOUT.wide);
        if (e <= EV_THRESHOLD) continue;
        const [ha, hb] = [top[a], top[b]].sort((x, y) => x.horseNumber - y.horseNumber);
        wide.push({
          type: "wide",
          label: `${ha.horseNumber}-${hb.horseNumber}`,
          horses: [ha.name, hb.name],
          horseNumbers: [ha.horseNumber, hb.horseNumber],
          estOdds: estOdds(pWide(fp, a, b), TAKEOUT.wide),
          ev: e,
        });
      }
    }
    results.push(...wide.sort((a, b) => b.ev - a.ev).slice(0, MAX_PER_TYPE));
  }

  // 三連複
  if (n >= 3) {
    const sanrenpuku: ComboBet[] = [];
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        for (let c = b + 1; c < n; c++) {
          const e = ev(pTrio(mp, a, b, c), pTrio(fp, a, b, c), TAKEOUT.sanrenpuku);
          if (e <= EV_THRESHOLD) continue;
          const sorted = [top[a], top[b], top[c]].sort((x, y) => x.horseNumber - y.horseNumber);
          sanrenpuku.push({
            type: "sanrenpuku",
            label: sorted.map((h) => h.horseNumber).join("-"),
            horses: sorted.map((h) => h.name),
            horseNumbers: sorted.map((h) => h.horseNumber),
            estOdds: estOdds(pTrio(fp, a, b, c), TAKEOUT.sanrenpuku),
            ev: e,
          });
        }
      }
    }
    results.push(...sanrenpuku.sort((a, b) => b.ev - a.ev).slice(0, MAX_PER_TYPE));
  }

  // 三連単
  if (n >= 3) {
    const sanrentan: ComboBet[] = [];
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        if (b === a) continue;
        for (let c = 0; c < n; c++) {
          if (c === a || c === b) continue;
          const e = ev(pTrifecta(mp, a, b, c), pTrifecta(fp, a, b, c), TAKEOUT.sanrentan);
          if (e <= EV_THRESHOLD) continue;
          sanrentan.push({
            type: "sanrentan",
            label: `${top[a].horseNumber}→${top[b].horseNumber}→${top[c].horseNumber}`,
            horses: [top[a].name, top[b].name, top[c].name],
            horseNumbers: [top[a].horseNumber, top[b].horseNumber, top[c].horseNumber],
            estOdds: estOdds(pTrifecta(fp, a, b, c), TAKEOUT.sanrentan),
            ev: e,
          });
        }
      }
    }
    results.push(...sanrentan.sort((a, b) => b.ev - a.ev).slice(0, MAX_PER_TYPE));
  }

  return results;
}
