/**
 * 同一馬集合で「本番のscores-cache値」と「過去成績から再導出した値」のAUCを直接比較する。
 * 差があれば、本番スコアの鮮度・算出に問題がある可能性を示す。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { calcFormScore, calcPedigreeScore, type RaceResult } from "../lib/scorer";
import type { RacesCache } from "./fetch-races";
import type { HorseScores } from "../lib/scorer";

const SP = "scripts/_cache";

type PastRow = {
  date: string; fieldSize: number; position: number; odds: number | null; popularity: number | null;
  jockey: string; weightCarried: number | null; track: string; margin: number | null;
  corner: string; last3f: number | null; bodyWeight: number | null; bodyWeightDiff: number | null;
  raceName: string; surface: string; distance: number;
};
type Sample = {
  netId: string; date: string; horseId: string; horseName: string;
  odds: number; won: boolean; surface: string; distance: number; past: PastRow[];
};

const samples: Sample[] = JSON.parse(readFileSync(`${SP}/newfeat_samples.json`, "utf-8"));

function loadJSON<T>(f: string): T | null {
  const p = join(process.cwd(), "lib", f);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}
const racesCache = loadJSON<RacesCache>("races-cache.json")!;
const scoresRaw = loadJSON<{ scores?: Record<string, HorseScores> }>("scores-cache.json");
const scoresById: Record<number, HorseScores> = {};
for (const [k, v] of Object.entries(scoresRaw?.scores ?? {})) scoresById[Number(k)] = v;

// netId+horseName → 本番スコア を引く
const prodScore = new Map<string, HorseScores>();
for (const race of racesCache.races) {
  for (const h of race.horses) {
    const c = scoresById[h.id];
    if (c) prodScore.set(`${race.netKeibaRaceId}|${h.horse}`, c);
  }
}

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

// 過去走 → RaceResult[] に変換（scorer が期待する形）
function toRaceResults(past: PastRow[]): RaceResult[] {
  return past
    .filter((p) => p.position >= 1 && p.fieldSize >= 2 && p.surface)
    .slice(0, 10)
    .map((p) => ({
      date: p.date,
      surface: (p.surface === "芝" ? "芝" : p.surface === "障" ? "障" : "ダ") as "芝" | "ダ" | "障",
      distance: p.distance,
      position: p.position,
      fieldSize: p.fieldSize,
    }));
}

const rows: { prodForm: number | null; reForm: number; prodPed: number | null; rePed: number; won: boolean }[] = [];
let matched = 0, unmatched = 0;
for (const s of samples) {
  if (s.past.length === 0) continue;
  const prod = prodScore.get(`${s.netId}|${s.horseName}`);
  const rr = toRaceResults(s.past);
  if (rr.length === 0) continue;
  const reForm = calcFormScore(rr);
  const rePed = calcPedigreeScore(rr, (s.surface === "芝" ? "芝" : s.surface === "障" ? "障" : "ダ") as "芝" | "ダ" | "障", s.distance);
  if (prod) matched++; else unmatched++;
  rows.push({ prodForm: prod?.formScore ?? null, reForm, prodPed: prod?.pedigreeScore ?? null, rePed, won: s.won });
}

console.log(`比較対象: ${rows.length}頭（本番スコア照合できた=${matched}, できなかった=${unmatched}）\n`);

const withProd = rows.filter((r) => r.prodForm != null);
console.log("════ 同一馬集合での AUC 直接比較 ════");
console.log(`n=${withProd.length}  勝ち馬=${withProd.filter((r) => r.won).length}`);
console.log(`  本番 formScore      AUC = ${auc(withProd.map((r) => ({ x: r.prodForm as number, y: r.won })), true).toFixed(4)}`);
console.log(`  再導出 formScore    AUC = ${auc(withProd.map((r) => ({ x: r.reForm, y: r.won })), true).toFixed(4)}`);
console.log(`  本番 pedigreeScore  AUC = ${auc(withProd.map((r) => ({ x: r.prodPed as number, y: r.won })), true).toFixed(4)}`);
console.log(`  再導出 pedigree     AUC = ${auc(withProd.map((r) => ({ x: r.rePed, y: r.won })), true).toFixed(4)}`);

// 値そのものの一致度
const diffs = withProd.map((r) => Math.abs((r.prodForm as number) - r.reForm));
const exact = diffs.filter((d) => d === 0).length;
const near = diffs.filter((d) => d <= 3).length;
console.log(`\n本番formScore と 再導出formScore の一致度:`);
console.log(`  完全一致       : ${exact}/${withProd.length} (${((exact / withProd.length) * 100).toFixed(0)}%)`);
console.log(`  ±3点以内      : ${near}/${withProd.length} (${((near / withProd.length) * 100).toFixed(0)}%)`);
console.log(`  平均絶対差     : ${(diffs.reduce((s, d) => s + d, 0) / diffs.length).toFixed(1)} 点`);
const big = withProd.map((r, i) => ({ r, d: diffs[i] })).filter((x) => x.d > 15).slice(0, 5);
if (big.length) {
  console.log(`  乖離が大きい例(>15点):`);
  for (const b of big) console.log(`    本番=${b.r.prodForm}  再導出=${b.r.reForm}  差=${b.d}`);
}
