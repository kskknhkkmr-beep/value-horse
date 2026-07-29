/**
 * 調査1補足: trainingScore の実態と「横並び予想 → ロングショット過大評価」機構の確認。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateStrength } from "../lib/engine";
import type { RacesCache } from "./fetch-races";
import type { ResultsCache } from "./fetch-results";
import type { HorseScores } from "../lib/scorer";

const DEFAULT = 65, TEMP = 4.0;
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

// trainingScore の値分布（scores-cache 全体）
console.log("════ trainingScore の値分布（scores-cache 全エントリ）════");
const dist = new Map<string, number>();
let total = 0;
for (const v of Object.values(scoresRaw?.scores ?? {})) {
  const k = v.trainingScore == null ? "null(欠損)" : String(v.trainingScore);
  dist.set(k, (dist.get(k) ?? 0) + 1); total++;
}
for (const [k, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)}: ${String(n).padStart(5)} (${((n / total) * 100).toFixed(1)}%)`);
}
console.log(`  合計 ${total}`);

// jockeyScore の分布も参考に
console.log("\n════ jockeyScore の値分布(上位10) ════");
const jd = new Map<string, number>();
for (const v of Object.values(scoresRaw?.scores ?? {})) {
  const k = v.jockeyScore == null ? "null(欠損)" : String(v.jockeyScore);
  jd.set(k, (jd.get(k) ?? 0) + 1);
}
for (const [k, n] of [...jd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${k.padEnd(12)}: ${String(n).padStart(5)} (${((n / total) * 100).toFixed(1)}%)`);
}

// ── 横並び機構の確認 ──
type R = { probs: number[]; fair: number[]; odds: number[]; won: boolean[] };
const races: R[] = [];
const processed = new Set<string>();
function build(hs: { id: number; horse: string; horseNumber: number; odds: number }[], fin: { position: number; horseNumber: number; horse: string }[]) {
  if (hs.length < 5) return;
  const st = hs.map((h) => {
    const c = scoresById[h.id];
    const rt = c ? (c.trainingScore ?? null) : DEFAULT;
    const rj = c ? (c.jockeyScore ?? null) : DEFAULT;
    return calculateStrength({
      id: 0, name: "", formScore: (c?.formScore ?? DEFAULT) / 100, pedigreeScore: (c?.pedigreeScore ?? DEFAULT) / 100,
      trainingScore: rt == null ? null : rt / 100, jockeyScore: rj == null ? null : rj / 100, odds: h.odds,
    });
  });
  const ex = st.map((s) => Math.exp(s * TEMP));
  const sum = ex.reduce((a, b) => a + b, 0);
  const ov = hs.reduce((s, h) => s + 1 / h.odds, 0);
  const w = fin.find((f) => f.position === 1);
  races.push({
    probs: ex.map((e) => e / sum),
    fair: hs.map((h) => 1 / h.odds / ov),
    odds: hs.map((h) => h.odds),
    won: hs.map((h) => w != null && (w.horse === h.horse || w.horseNumber === h.horseNumber)),
  });
}
for (const race of racesCache.races) {
  if (race.entriesPending || !race.horses.length) continue;
  const re = resultsCache.results.find((r) => r.netKeibaRaceId === race.netKeibaRaceId);
  if (!re || !re.finishers.length) continue;
  processed.add(race.netKeibaRaceId);
  const om = new Map<string, number>();
  for (const f of re.finishers) if (f.odds != null && f.odds > 0) om.set(f.horse, f.odds);
  build(race.horses.map((h) => ({ ...h, odds: h.odds ?? om.get(h.horse) ?? null })).filter((h): h is typeof h & { odds: number } => h.odds != null && h.odds > 0), re.finishers);
}
for (const r of resultsCache.results) {
  if (processed.has(r.netKeibaRaceId) || !r.finishers.length) continue;
  build(r.finishers.filter((f) => f.odds != null && f.odds > 0).map((f) => ({ id: 0, horse: f.horse, horseNumber: f.horseNumber, odds: f.odds as number })), r.finishers);
}

console.log("\n════ 「横並び予想」の定量化 ════");
// 各レースで、モデルが最も高く評価した馬の確率 vs 市場1番人気の確率
let modelTop = 0, marketTop = 0, n = 0;
let modelRange = 0, marketRange = 0;
for (const r of races) {
  modelTop += Math.max(...r.probs);
  marketTop += Math.max(...r.fair);
  modelRange += Math.max(...r.probs) - Math.min(...r.probs);
  marketRange += Math.max(...r.fair) - Math.min(...r.fair);
  n++;
}
console.log(`レース内の最高確率  モデル=${((modelTop / n) * 100).toFixed(2)}%  市場=${((marketTop / n) * 100).toFixed(2)}%`);
console.log(`レース内の確率レンジ モデル=${((modelRange / n) * 100).toFixed(2)}pt  市場=${((marketRange / n) * 100).toFixed(2)}pt`);
console.log(`→ モデルは「本命を本命として突き放す」ことができていない`);

// 均等配分(1/N)ベースラインとの比較: モデルは均等配分からどれだけ離れているか
let distModel = 0, distMarket = 0;
for (const r of races) {
  const u = 1 / r.probs.length;
  distModel += r.probs.reduce((s, p) => s + Math.abs(p - u), 0) / 2; // total variation distance
  distMarket += r.fair.reduce((s, p) => s + Math.abs(p - u), 0) / 2;
}
console.log(`\n均等配分(1/N)からの乖離(TV距離)  モデル=${(distModel / n).toFixed(4)}  市場=${(distMarket / n).toFixed(4)}`);
console.log(`→ 0に近いほど「全馬同じ確率」に近い。モデルは市場の${((distModel / n) / (distMarket / n) * 100).toFixed(0)}%しか差をつけていない`);

// モデル確率と市場確率の順位相関(Spearman)
function spearman(a: number[], b: number[]) {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const r = new Array(v.length).fill(0);
    idx.forEach(([, i], k) => (r[i] = k + 1));
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const m = (x: number[]) => x.reduce((s, y) => s + y, 0) / x.length;
  const ma = m(ra), mb = m(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) { const x = ra[i] - ma, y = rb[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db);
}
let sp = 0, spN = 0;
for (const r of races) { const s = spearman(r.probs, r.fair); if (!isNaN(s)) { sp += s; spN++; } }
console.log(`\nレース内でのモデル順位 vs 市場順位の相関(Spearman平均) = ${(sp / spN).toFixed(4)}`);
console.log(`→ 1.0=完全一致, 0=無関係。低いほど「市場と違う馬を推している」`);

// 本命馬(モデル最高確率)が市場でも1番人気だった割合
let agree = 0;
for (const r of races) {
  const mi = r.probs.indexOf(Math.max(...r.probs));
  const fi = r.fair.indexOf(Math.max(...r.fair));
  if (mi === fi) agree++;
}
console.log(`モデル1位 = 市場1番人気 だった割合: ${((agree / races.length) * 100).toFixed(1)}%`);
