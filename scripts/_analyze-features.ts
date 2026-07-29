/**
 * 調査1: 特徴量の寄与度分析 — 一時分析スクリプト。
 * （trainingScore は是正案①により本番から除去済みのため対象外）
 *   ① 各特徴量の実データ被覆率・分散（そもそも情報を持っているか）
 *   ② 単変量AUC（その特徴量だけで勝敗をどれだけ当てられるか）
 *   ③ 市場(log odds)との相関（市場が見ているものを捉えられているか）
 *   ④ アブレーション（各特徴量を抜いたときのAUC変化）
 *   ⑤ ロングショット過大評価の発生源（strengthの分離能力）
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateStrength } from "../lib/engine";
import type { RacesCache } from "./fetch-races";
import type { ResultsCache } from "./fetch-results";
import type { HorseScores } from "../lib/scorer";

const DEFAULT = 65;
const TEMP = 4.0;

function loadJSON<T>(f: string): T | null {
  const p = join(process.cwd(), "lib", f);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}
const racesCache = loadJSON<RacesCache>("races-cache.json")!;
const resultsCache = loadJSON<ResultsCache>("results-cache.json")!;
const scoresRaw = loadJSON<{ scores?: Record<string, HorseScores> }>("scores-cache.json");
const scoresById: Record<number, HorseScores> = {};
for (const [k, v] of Object.entries(scoresRaw?.scores ?? {})) scoresById[Number(k)] = v;

type H = {
  form: number; pedigree: number;
  jockey: number | null;
  hasRealScores: boolean; // scores-cache にエントリがあるか
  odds: number; won: boolean; raceIdx: number;
};
const horses: H[] = [];
const processed = new Set<string>();
let raceIdx = 0;

function push(hs: { id: number; horse: string; horseNumber: number; odds: number }[], fin: { position: number; horseNumber: number; horse: string }[]) {
  if (!hs.length) return;
  const w = fin.find((f) => f.position === 1);
  for (const h of hs) {
    const c = scoresById[h.id];
    horses.push({
      form: c?.formScore ?? DEFAULT,
      pedigree: c?.pedigreeScore ?? DEFAULT,
      jockey: c ? (c.jockeyScore ?? null) : DEFAULT,
      hasRealScores: !!c,
      odds: h.odds,
      won: w != null && (w.horse === h.horse || w.horseNumber === h.horseNumber),
      raceIdx,
    });
  }
  raceIdx++;
}

for (const race of racesCache.races) {
  if (race.entriesPending || !race.horses.length) continue;
  const re = resultsCache.results.find((r) => r.netKeibaRaceId === race.netKeibaRaceId);
  if (!re || !re.finishers.length) continue;
  processed.add(race.netKeibaRaceId);
  const om = new Map<string, number>();
  for (const f of re.finishers) if (f.odds != null && f.odds > 0) om.set(f.horse, f.odds);
  push(race.horses.map((h) => ({ ...h, odds: h.odds ?? om.get(h.horse) ?? null })).filter((h): h is typeof h & { odds: number } => h.odds != null && h.odds > 0), re.finishers);
}
for (const r of resultsCache.results) {
  if (processed.has(r.netKeibaRaceId) || !r.finishers.length) continue;
  push(r.finishers.filter((f) => f.odds != null && f.odds > 0).map((f) => ({ id: 0, horse: f.horse, horseNumber: f.horseNumber, odds: f.odds as number })), r.finishers);
}

// v2（実スコアあり）のみに限定した集合も用意
const real = horses.filter((h) => h.hasRealScores);

function auc(xs: number[], ys: boolean[]) {
  const pos: number[] = [], neg: number[] = [];
  xs.forEach((x, i) => (ys[i] ? pos : neg).push(x));
  if (!pos.length || !neg.length) return NaN;
  const ns = [...neg].sort((a, b) => a - b);
  let win = 0;
  for (const p of pos) {
    let lo = 0, hi = ns.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ns[m] < p) lo = m + 1; else hi = m; }
    let eq = 0, k = lo;
    while (k < ns.length && ns[k] === p) { eq++; k++; }
    win += lo + eq * 0.5;
  }
  return win / (pos.length * neg.length);
}
function pearson(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db);
}
function stats(xs: number[]) {
  const n = xs.length;
  const m = xs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / n);
  const u = new Set(xs).size;
  return { mean: m, sd, uniq: u, n };
}

console.log(`総出走馬=${horses.length}  レース数=${raceIdx}  勝ち馬=${horses.filter((h) => h.won).length}`);
console.log(`scores-cache に実データがある馬=${real.length} (${((real.length / horses.length) * 100).toFixed(1)}%)\n`);

console.log("════ ① 特徴量の被覆率と分散（実データ保有馬 n=" + real.length + " に限定）════");
const featDefs: [string, (h: H) => number | null][] = [
  ["formScore", (h) => h.form],
  ["pedigreeScore", (h) => h.pedigree],
  ["jockeyScore", (h) => h.jockey],
];
console.log("特徴量          | 欠損(null) | DEFAULT(65)固定 |   平均 |   SD | 異なる値の数");
for (const [name, get] of featDefs) {
  const vals = real.map(get);
  const nullN = vals.filter((v) => v == null).length;
  const nonNull = vals.filter((v): v is number => v != null);
  const defN = nonNull.filter((v) => v === DEFAULT).length;
  const s = stats(nonNull);
  console.log(
    `${name.padEnd(15)} | ${String(nullN).padStart(6)} (${((nullN / real.length) * 100).toFixed(1).padStart(4)}%) | ` +
    `${String(defN).padStart(6)} (${((defN / real.length) * 100).toFixed(1).padStart(4)}%) | ` +
    `${s.mean.toFixed(1).padStart(6)} | ${s.sd.toFixed(1).padStart(4)} | ${String(s.uniq).padStart(6)}`
  );
}

console.log("\n════ ② 単変量AUC（その特徴量単独で勝敗をどれだけ当てられるか）════");
console.log("  0.5=ランダム / 参考: 市場オッズのAUC=0.839, 現行モデル全体=0.664");
console.log("特徴量          | 有効n | 単独AUC | 判定");
for (const [name, get] of featDefs) {
  const sub = real.filter((h) => get(h) != null);
  const a = auc(sub.map((h) => get(h) as number), sub.map((h) => h.won));
  const verdict = a >= 0.60 ? "有意に寄与" : a >= 0.55 ? "弱いが寄与" : a >= 0.52 ? "ほぼノイズ" : "ノイズ/逆相関";
  console.log(`${name.padEnd(15)} | ${String(sub.length).padStart(5)} | ${a.toFixed(4).padStart(7)} | ${verdict}`);
}
// 参考: 市場オッズ単独（低いほど勝ちやすいので符号反転）
const oddsAuc = auc(real.map((h) => -h.odds), real.map((h) => h.won));
console.log(`${"(参考)市場オッズ".padEnd(15)} | ${String(real.length).padStart(5)} | ${oddsAuc.toFixed(4).padStart(7)} | 市場のベンチマーク`);

console.log("\n════ ③ 市場(log odds)との相関 ════");
console.log("  市場が見ているものを特徴量が捉えていれば負の相関（強い馬=低オッズ）が出るはず");
console.log("特徴量          | vs log(odds) 相関 | 解釈");
for (const [name, get] of featDefs) {
  const sub = real.filter((h) => get(h) != null);
  const r = pearson(sub.map((h) => get(h) as number), sub.map((h) => Math.log(h.odds)));
  const interp = r < -0.3 ? "市場と強く整合" : r < -0.15 ? "市場とやや整合" : r < -0.05 ? "市場との整合は弱い" : "市場とほぼ無関係";
  console.log(`${name.padEnd(15)} | ${r.toFixed(4).padStart(17)} | ${interp}`);
}

console.log("\n════ ④ アブレーション（特徴量を1つ除いたときの全体AUC変化）════");
function strengthAUC(mask: { form?: boolean; ped?: boolean; jk?: boolean }) {
  const xs: number[] = [], ys: boolean[] = [];
  for (const h of real) {
    const s = calculateStrength({
      id: 0, name: "",
      formScore: (mask.form === false ? DEFAULT : h.form) / 100,
      pedigreeScore: (mask.ped === false ? DEFAULT : h.pedigree) / 100,
      jockeyScore: mask.jk === false ? null : (h.jockey == null ? null : h.jockey / 100),
      odds: h.odds,
    });
    xs.push(s); ys.push(h.won);
  }
  return auc(xs, ys);
}
const baseAuc = strengthAUC({});
console.log(`全特徴量そろった strength の AUC = ${baseAuc.toFixed(4)}`);
const ablations: [string, Parameters<typeof strengthAUC>[0]][] = [
  ["formScore を除去", { form: false }],
  ["pedigreeScore を除去", { ped: false }],
  ["jockeyScore を除去", { jk: false }],
];
for (const [label, mask] of ablations) {
  const a = strengthAUC(mask);
  const d = a - baseAuc;
  console.log(`${label.padEnd(24)} AUC=${a.toFixed(4)}  変化=${(d >= 0 ? "+" : "") + d.toFixed(4)} ${d > 0.002 ? " ← 除いた方が良い(有害)" : Math.abs(d) < 0.002 ? " ← ほぼ無寄与" : ""}`);
}

console.log("\n════ ⑤ ロングショット過大評価の発生源 ════");
// レース内 strength のばらつき → softmax後の確率のばらつき
const byRace = new Map<number, H[]>();
for (const h of real) {
  if (!byRace.has(h.raceIdx)) byRace.set(h.raceIdx, []);
  byRace.get(h.raceIdx)!.push(h);
}
let sdStrength = 0, sdProb = 0, sdMarket = 0, cnt = 0;
let ratioSum = 0;
for (const [, hs] of byRace) {
  if (hs.length < 5) continue;
  const st = hs.map((h) => calculateStrength({
    id: 0, name: "", formScore: h.form / 100, pedigreeScore: h.pedigree / 100,
    jockeyScore: h.jockey == null ? null : h.jockey / 100, odds: h.odds,
  }));
  const ex = st.map((s) => Math.exp(s * TEMP));
  const sum = ex.reduce((a, b) => a + b, 0);
  const mp = ex.map((e) => e / sum);
  const ov = hs.reduce((s, h) => s + 1 / h.odds, 0);
  const fair = hs.map((h) => 1 / h.odds / ov);
  const sd = (a: number[]) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
  sdStrength += sd(st); sdProb += sd(mp); sdMarket += sd(fair);
  ratioSum += sd(mp) / Math.max(sd(fair), 1e-9);
  cnt++;
}
console.log(`レース内の平均ばらつき(SD):`);
console.log(`  strength      = ${(sdStrength / cnt).toFixed(4)}`);
console.log(`  モデル確率     = ${((sdProb / cnt) * 100).toFixed(2)}%`);
console.log(`  市場公正確率   = ${((sdMarket / cnt) * 100).toFixed(2)}%`);
console.log(`  モデル/市場のばらつき比 = ${(ratioSum / cnt).toFixed(3)}  (1.0未満=モデルは市場より横並びな予想しかできていない)`);

// 各特徴量が「レース内でどれだけ差をつけているか」
console.log(`\nレース内での特徴量のばらつき(SD, 実データ保有馬のみ):`);
for (const [name, get] of featDefs) {
  let s = 0, c = 0;
  for (const [, hs] of byRace) {
    const vs = hs.map(get).filter((v): v is number => v != null);
    if (vs.length < 5) continue;
    const m = vs.reduce((a, x) => a + x, 0) / vs.length;
    s += Math.sqrt(vs.reduce((a, x) => a + (x - m) ** 2, 0) / vs.length); c++;
  }
  console.log(`  ${name.padEnd(15)} = ${(s / c).toFixed(2)} 点`);
}
