/**
 * 調査2の実証分析: 候補特徴量の単変量AUCを測る。
 * _probe-newfeatures.ts が保存したサンプルを読み込む。
 */
import { readFileSync } from "node:fs";

const SP = "scripts/_cache";

type PastRow = {
  date: string; fieldSize: number; position: number;
  odds: number | null; popularity: number | null;
  jockey: string; weightCarried: number | null; track: string;
  margin: number | null; corner: string; last3f: number | null;
  bodyWeight: number | null; bodyWeightDiff: number | null;
  raceName: string; surface: string; distance: number;
};
type Sample = {
  netId: string; date: string; horseId: string; horseName: string;
  odds: number; won: boolean; surface: string; distance: number; past: PastRow[];
};

const samples: Sample[] = JSON.parse(readFileSync(`${SP}/newfeat_samples.json`, "utf-8"));
console.log(`サンプル: ${samples.length}頭 / ${new Set(samples.map((s) => s.netId)).size}レース  勝ち馬=${samples.filter((s) => s.won).length}`);
console.log(`過去走データを持つ馬: ${samples.filter((s) => s.past.length > 0).length} (${((samples.filter((s) => s.past.length > 0).length / samples.length) * 100).toFixed(0)}%)\n`);

// ── 特徴量定義（すべて対象レース以前の情報のみ） ──
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
function firstCornerPos(corner: string): number | null {
  const parts = corner.split("-").map((x) => parseInt(x.trim(), 10)).filter((x) => !isNaN(x));
  return parts.length ? parts[0] : null;
}
function daysBetween(a: string, b: string) {
  return (new Date(a.replace(/\//g, "-")).getTime() - new Date(b.replace(/\//g, "-")).getTime()) / 86400000;
}
function gradeLevel(name: string): number {
  if (/G\s*I(?![I])|GI(?![I])|ＧI(?![I])/.test(name) && !/GII|GIII/.test(name)) return 5;
  if (/GII(?!I)/.test(name)) return 4;
  if (/GIII/.test(name)) return 3;
  if (/\(L\)|リステッド/.test(name)) return 2.5;
  if (/オープン|\(OP\)|Ｓ$|S$/.test(name)) return 2;
  if (/3勝|1600万/.test(name)) return 1.5;
  if (/2勝|1000万/.test(name)) return 1.2;
  if (/1勝|500万/.test(name)) return 1;
  if (/未勝利|新馬/.test(name)) return 0.5;
  return 1;
}

type FeatDef = { name: string; desc: string; get: (s: Sample) => number | null; higherIsBetter: boolean };

const FEATS: FeatDef[] = [
  // ── 市場の過去評価（現行モデルが完全に無視している情報）──
  { name: "前走人気", desc: "市場の直近評価", higherIsBetter: false,
    get: (s) => s.past[0]?.popularity ?? null },
  { name: "直近3走平均人気", desc: "市場の継続的評価", higherIsBetter: false,
    get: (s) => { const v = s.past.slice(0, 3).map((p) => p.popularity).filter((x): x is number => x != null); return v.length ? avg(v) : null; } },
  { name: "前走オッズ(log)", desc: "市場の直近評価(連続値)", higherIsBetter: false,
    get: (s) => s.past[0]?.odds != null ? Math.log(s.past[0].odds!) : null },
  { name: "キャリア最高人気", desc: "過去最も支持された時", higherIsBetter: false,
    get: (s) => { const v = s.past.map((p) => p.popularity).filter((x): x is number => x != null); return v.length ? Math.min(...v) : null; } },
  // ── 着差（着順より細かい）──
  { name: "前走着差", desc: "勝ち馬との差(秒)", higherIsBetter: false,
    get: (s) => s.past[0]?.margin ?? null },
  { name: "直近3走平均着差", desc: "継続的な着差", higherIsBetter: false,
    get: (s) => { const v = s.past.slice(0, 3).map((p) => p.margin).filter((x): x is number => x != null); return v.length ? avg(v) : null; } },
  // ── 上がり3F（決め手）──
  { name: "前走上り3F", desc: "終いの脚(秒)", higherIsBetter: false,
    get: (s) => s.past[0]?.last3f ?? null },
  { name: "直近3走最速上り3F", desc: "最高の決め手", higherIsBetter: false,
    get: (s) => { const v = s.past.slice(0, 3).map((p) => p.last3f).filter((x): x is number => x != null); return v.length ? Math.min(...v) : null; } },
  // ── 馬体重 ──
  { name: "前走馬体重", desc: "馬格", higherIsBetter: true,
    get: (s) => s.past[0]?.bodyWeight ?? null },
  { name: "前走馬体重増減", desc: "調整状態", higherIsBetter: true,
    get: (s) => s.past[0]?.bodyWeightDiff ?? null },
  // ── ローテーション ──
  { name: "前走からの間隔(日)", desc: "レース間隔", higherIsBetter: false,
    get: (s) => s.past[0] ? daysBetween(s.date.replace(/-/g, "/"), s.past[0].date) : null },
  // ── 脚質 ──
  { name: "前走1角通過順", desc: "先行力", higherIsBetter: false,
    get: (s) => s.past[0] ? firstCornerPos(s.past[0].corner) : null },
  { name: "直近3走平均通過順", desc: "脚質の安定性", higherIsBetter: false,
    get: (s) => { const v = s.past.slice(0, 3).map((p) => firstCornerPos(p.corner)).filter((x): x is number => x != null); return v.length ? avg(v) : null; } },
  // ── 騎手継続性 ──
  { name: "騎手継続(前走と同じ)", desc: "コンビ継続=1", higherIsBetter: true,
    get: (s) => null }, // 現騎手名がサンプルに無いため後で個別処理
  // ── クラス・経験 ──
  { name: "キャリア出走数", desc: "経験", higherIsBetter: true,
    get: (s) => s.past.length || null },
  { name: "通算勝率", desc: "勝ち切る力", higherIsBetter: true,
    get: (s) => s.past.length >= 3 ? s.past.filter((p) => p.position === 1).length / s.past.length : null },
  { name: "通算複勝率", desc: "安定性", higherIsBetter: true,
    get: (s) => s.past.length >= 3 ? s.past.filter((p) => p.position >= 1 && p.position <= 3).length / s.past.length : null },
  { name: "経験最高クラス", desc: "格の高さ", higherIsBetter: true,
    get: (s) => s.past.length ? Math.max(...s.past.map((p) => gradeLevel(p.raceName))) : null },
  { name: "前走クラス", desc: "直近の格", higherIsBetter: true,
    get: (s) => s.past[0] ? gradeLevel(s.past[0].raceName) : null },
  // ── 適性 ──
  { name: "同馬場・同距離帯勝率", desc: "コース適性", higherIsBetter: true,
    get: (s) => { const m = s.past.filter((p) => p.surface === s.surface && Math.abs(p.distance - s.distance) <= 200); return m.length >= 2 ? m.filter((p) => p.position === 1).length / m.length : null; } },
  // ── 現行モデル相当（比較用）──
  { name: "[現行]form相当", desc: "直近5走の相対着順", higherIsBetter: true,
    get: (s) => { const v = s.past.slice(0, 5).filter((p) => p.position >= 1 && p.fieldSize >= 2); return v.length ? avg(v.map((p) => (100 * (p.fieldSize - p.position)) / (p.fieldSize - 1))) : null; } },
];

function auc(pairs: { x: number; y: boolean }[], higherIsBetter: boolean) {
  const pos = pairs.filter((p) => p.y).map((p) => (higherIsBetter ? p.x : -p.x));
  const neg = pairs.filter((p) => !p.y).map((p) => (higherIsBetter ? p.x : -p.x));
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

/** ブートストラップ95%信頼区間（馬単位リサンプリング） */
function aucCI(pairs: { x: number; y: boolean }[], higherIsBetter: boolean, iters = 2000) {
  const out: number[] = [];
  const n = pairs.length;
  for (let it = 0; it < iters; it++) {
    const rs: { x: number; y: boolean }[] = [];
    for (let i = 0; i < n; i++) rs.push(pairs[Math.floor(Math.random() * n)]);
    const a = auc(rs, higherIsBetter);
    if (!isNaN(a)) out.push(a);
  }
  out.sort((a, b) => a - b);
  return { lo: out[Math.floor(out.length * 0.025)], hi: out[Math.floor(out.length * 0.975)] };
}

const marketPairs = samples.map((s) => ({ x: Math.log(s.odds), y: s.won }));
const marketAuc = auc(marketPairs, false);
const marketCI = aucCI(marketPairs, false);
console.log(`【ベンチマーク】当日オッズ(市場)のAUC = ${marketAuc.toFixed(4)}  95%CI=[${marketCI.lo.toFixed(3)}, ${marketCI.hi.toFixed(3)}]\n`);

console.log("特徴量                  | 有効n | 被覆 |    AUC | 95%信頼区間      | 判定");
console.log("-".repeat(92));
const results: { name: string; auc: number; n: number; lo: number; hi: number }[] = [];
for (const f of FEATS) {
  if (f.name.startsWith("騎手継続")) continue;
  const pairs = samples
    .map((s) => ({ x: f.get(s), y: s.won }))
    .filter((p): p is { x: number; y: boolean } => p.x != null && !isNaN(p.x));
  if (pairs.length < 50) { console.log(`${f.name.padEnd(23)} | データ不足(n=${pairs.length})`); continue; }
  const a = auc(pairs, f.higherIsBetter);
  const ci = aucCI(pairs, f.higherIsBetter);
  const cov = (pairs.length / samples.length) * 100;
  // 信頼区間が0.5を含むか＝「ランダムと区別できるか」
  const sig = ci.lo > 0.5;
  const verdict = !sig ? "× 有意でない(CIが0.5を含む)" : a >= 0.70 ? "★強い" : a >= 0.63 ? "◎有用" : a >= 0.57 ? "○弱い" : "△微弱";
  console.log(
    `${f.name.padEnd(23)} | ${String(pairs.length).padStart(5)} | ${cov.toFixed(0).padStart(3)}% | ` +
    `${a.toFixed(4).padStart(6)} | [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}] | ${verdict}`
  );
  results.push({ name: f.name, auc: a, n: pairs.length, lo: ci.lo, hi: ci.hi });
}

console.log("\n════ AUC上位 ════");
console.log("（注: 勝ち馬が少ないためCIは広い。順位の細かい差は信頼できない）");
for (const r of [...results].sort((a, b) => b.auc - a.auc).slice(0, 10)) {
  console.log(`  ${r.name.padEnd(23)} AUC=${r.auc.toFixed(4)}  CI=[${r.lo.toFixed(3)}, ${r.hi.toFixed(3)}]`);
}
