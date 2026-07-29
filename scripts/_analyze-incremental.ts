/**
 * 新特徴量が現行 formScore と独立した情報を持つか（増分価値）を検証する。
 * ロジスティック回帰で組み合わせ、交差検証AUCを比較する。
 */
import { readFileSync } from "node:fs";

const SP = "scripts/_cache";
type PastRow = { date: string; fieldSize: number; position: number; odds: number | null; popularity: number | null; jockey: string; weightCarried: number | null; track: string; margin: number | null; corner: string; last3f: number | null; bodyWeight: number | null; bodyWeightDiff: number | null; raceName: string; surface: string; distance: number };
type Sample = { netId: string; date: string; horseId: string; horseName: string; odds: number; won: boolean; surface: string; distance: number; past: PastRow[] };
const samples: Sample[] = JSON.parse(readFileSync(`${SP}/newfeat_samples.json`, "utf-8"));

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const firstCorner = (c: string) => { const p = c.split("-").map((x) => parseInt(x, 10)).filter((x) => !isNaN(x)); return p.length ? p[0] : null; };

type Row = { x: number[]; y: boolean; netId: string };
const FEAT_NAMES = ["form相当", "直近3走平均人気", "直近3走平均着差", "通算複勝率", "直近3走平均通過順"];
const rows: Row[] = [];
for (const s of samples) {
  if (!s.past.length) continue;
  const p5 = s.past.slice(0, 5).filter((p) => p.position >= 1 && p.fieldSize >= 2);
  if (!p5.length) continue;
  const form = avg(p5.map((p) => (100 * (p.fieldSize - p.position)) / (p.fieldSize - 1)));
  const pops = s.past.slice(0, 3).map((p) => p.popularity).filter((x): x is number => x != null);
  const margins = s.past.slice(0, 3).map((p) => p.margin).filter((x): x is number => x != null);
  const corners = s.past.slice(0, 3).map((p) => firstCorner(p.corner)).filter((x): x is number => x != null);
  if (!pops.length || !margins.length || !corners.length || s.past.length < 3) continue;
  const top3 = s.past.filter((p) => p.position >= 1 && p.position <= 3).length / s.past.length;
  rows.push({
    x: [form / 100, Math.log(avg(pops)), avg(margins), top3, avg(corners) / 10],
    y: s.won, netId: s.netId,
  });
}
console.log(`有効サンプル: ${rows.length}頭  勝ち馬=${rows.filter((r) => r.y).length}\n`);

function auc(pairs: { x: number; y: boolean }[]) {
  const pos = pairs.filter((p) => p.y).map((p) => p.x), neg = pairs.filter((p) => !p.y).map((p) => p.x);
  if (!pos.length || !neg.length) return NaN;
  const ns = [...neg].sort((a, b) => a - b);
  let win = 0;
  for (const p of pos) {
    let lo = 0, hi = ns.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ns[m] < p) lo = m + 1; else hi = m; }
    let eq = 0, k = lo; while (k < ns.length && ns[k] === p) { eq++; k++; }
    win += lo + eq * 0.5;
  }
  return win / (pos.length * neg.length);
}

/** L2正則化つきロジスティック回帰（勾配降下） */
function fitLogistic(data: Row[], idx: number[], lambda = 0.01, iters = 3000, lr = 0.5) {
  const d = idx.length;
  let w = new Array(d).fill(0), b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (const r of data) {
      let z = b; for (let j = 0; j < d; j++) z += w[j] * r.x[idx[j]];
      const p = 1 / (1 + Math.exp(-z));
      const e = p - (r.y ? 1 : 0);
      for (let j = 0; j < d; j++) gw[j] += e * r.x[idx[j]];
      gb += e;
    }
    for (let j = 0; j < d; j++) w[j] = w[j] - lr * (gw[j] / data.length + lambda * w[j]);
    b -= lr * (gb / data.length);
  }
  return (r: Row) => { let z = b; for (let j = 0; j < d; j++) z += w[j] * r.x[idx[j]]; return 1 / (1 + Math.exp(-z)); };
}

// レース単位5分割CV
const netIds = [...new Set(rows.map((r) => r.netId))];
const foldOf = new Map(netIds.map((n, i) => [n, i % 5]));

function cvAuc(idx: number[]) {
  const preds: { x: number; y: boolean }[] = [];
  for (let f = 0; f < 5; f++) {
    const tr = rows.filter((r) => foldOf.get(r.netId) !== f);
    const te = rows.filter((r) => foldOf.get(r.netId) === f);
    if (!tr.length || !te.length) continue;
    const model = fitLogistic(tr, idx);
    for (const r of te) preds.push({ x: model(r), y: r.y });
  }
  return auc(preds);
}

console.log("════ 増分価値の検証（レース単位5分割交差検証AUC）════");
const base = cvAuc([0]);
console.log(`① form相当 単独                          AUC=${base.toFixed(4)}`);
const combos: [string, number[]][] = [
  ["form + 直近3走平均人気", [0, 1]],
  ["form + 直近3走平均着差", [0, 2]],
  ["form + 通算複勝率", [0, 3]],
  ["form + 平均通過順", [0, 4]],
  ["form + 人気 + 着差", [0, 1, 2]],
  ["全5特徴量", [0, 1, 2, 3, 4]],
];
for (const [label, idx] of combos) {
  const a = cvAuc(idx);
  const d = a - base;
  console.log(`② ${label.padEnd(38)} AUC=${a.toFixed(4)}  form単独比 ${(d >= 0 ? "+" : "") + d.toFixed(4)}${d > 0.02 ? "  ← 増分あり" : d < -0.01 ? "  ← 悪化" : "  ← ほぼ増分なし"}`);
}

// 特徴量間の相関（冗長性の確認）
function pearson(a: number[], b: number[]) {
  const n = a.length, ma = avg(a), mb = avg(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db);
}
console.log("\n════ form相当 との相関（冗長性チェック）════");
for (let j = 1; j < FEAT_NAMES.length; j++) {
  const r = pearson(rows.map((x) => x.x[0]), rows.map((x) => x.x[j]));
  console.log(`  form vs ${FEAT_NAMES[j].padEnd(20)} r=${r.toFixed(3)} ${Math.abs(r) > 0.7 ? "← 強く冗長" : Math.abs(r) > 0.4 ? "← やや冗長" : "← 独立性あり"}`);
}
console.log(`\n（参考）市場オッズのAUC=0.856。モデル側がここに届かない限り優位性は出ない。`);
