/**
 * Phase 0 棚卸しの続き: 復元した odds 時系列の「実際に使える量」と、
 * レース条件メタデータの保有状況を確認する（読み取り専用）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RacesCache } from "./fetch-races";
import type { ResultsCache } from "./fetch-results";
import type { HorseScores } from "../lib/scorer";

const SP = "scripts/_cache";

function loadLib<T>(f: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), "lib", f), "utf-8")) as T;
}

const racesCache = loadLib<RacesCache>("races-cache.json");
const resultsCache = loadLib<ResultsCache>("results-cache.json");
const scoresRaw = loadLib<{ scores?: Record<string, HorseScores> }>("scores-cache.json");
const scores: Record<number, HorseScores> = {};
for (const [k, v] of Object.entries(scoresRaw.scores ?? {})) scores[Number(k)] = v;

type OddsPoint = { at: string; odds: number };
type RaceSeries = {
  netKeibaRaceId: string; date: string; venue: string; raceNumber: number;
  postTime: string; postAtUTC: string; byHorse: Record<number, OddsPoint[]>;
};
const hist = JSON.parse(readFileSync(`${SP}/odds_history.json`, "utf-8")) as { races: RaceSeries[] };

const resultById = new Map(resultsCache.results.map((r) => [r.netKeibaRaceId, r]));
const raceById = new Map(racesCache.races.map((r) => [r.netKeibaRaceId, r]));

// レースの modelVersion 判定（backtest/route.ts と同じ規則）
function versionOf(netId: string): "v1" | "v2" {
  const race = raceById.get(netId);
  if (!race?.horses?.length) return "v1";
  return race.horses.some((h) => scores[h.id]?.modelVersion === "v2") ? "v2" : "v1";
}

console.log("════ ① オッズ時系列: 実際に検証に使える量 ════");
console.log("（early=最古スナップ, late=発走に最も近いスナップ。両方あって初めて変化率が作れる）\n");

type Row = { netId: string; snaps: number; leadLastMin: number; leadFirstMin: number; hasResult: boolean; version: "v1" | "v2" };
const rows: Row[] = [];
for (const s of hist.races) {
  const times = new Set<string>();
  for (const arr of Object.values(s.byHorse)) for (const p of arr) times.add(p.at);
  if (times.size === 0) continue;
  const sorted = [...times].sort();
  const post = new Date(s.postAtUTC).getTime();
  rows.push({
    netId: s.netKeibaRaceId,
    snaps: times.size,
    leadFirstMin: Math.round((post - new Date(sorted[0]).getTime()) / 60000),
    leadLastMin: Math.round((post - new Date(sorted[sorted.length - 1]).getTime()) / 60000),
    hasResult: (resultById.get(s.netKeibaRaceId)?.finishers.length ?? 0) > 0,
    version: versionOf(s.netKeibaRaceId),
  });
}

const usable = rows.filter((r) => r.snaps >= 2 && r.hasResult);
console.log(`スナップ≥2本 かつ 結果あり: ${usable.length} レース`);
for (const v of ["v2", "v1"] as const) {
  const sub = usable.filter((r) => r.version === v);
  const horses = sub.reduce((s, r) => s + (raceById.get(r.netId)?.horses.length ?? 0), 0);
  console.log(`  ${v}: ${sub.length} レース / 約${horses}頭`);
}

console.log("\n  最終スナップの発走までのリード時間（締切直前オッズとしての質）:");
const buckets: Array<[string, (m: number) => boolean]> = [
  ["  〜30分前", (m) => m <= 30],
  [" 31〜60分前", (m) => m > 30 && m <= 60],
  [" 61〜120分前", (m) => m > 60 && m <= 120],
  ["121〜240分前", (m) => m > 120 && m <= 240],
  ["241分前〜", (m) => m > 240],
];
for (const [label, f] of buckets) {
  const n = usable.filter((r) => f(r.leadLastMin)).length;
  console.log(`    ${label}: ${n} レース`);
}

console.log("\n════ ③ レース条件メタデータの保有状況 ════");
const sampleRace = racesCache.races.find((r) => r.horses?.length);
console.log(`  races-cache のレースフィールド: ${Object.keys(sampleRace ?? {}).filter((k) => k !== "horses").join(", ")}`);
console.log(`  results-cache のレースフィールド: ${Object.keys(resultsCache.results[0] ?? {}).filter((k) => k !== "finishers").join(", ")}`);
console.log(`  finisher フィールド: ${Object.keys(resultsCache.results[0]?.finishers[0] ?? {}).join(", ")}`);

// raceName からクラスを機械的に導けるか
function classOf(name: string): string {
  if (/新馬/.test(name)) return "新馬";
  if (/未勝利/.test(name)) return "未勝利";
  if (/1勝クラス/.test(name)) return "1勝クラス";
  if (/2勝クラス/.test(name)) return "2勝クラス";
  if (/3勝クラス/.test(name)) return "3勝クラス";
  if (/(OP|オープン)/.test(name)) return "OP";
  return "特別/重賞(名前のみ)";
}
const classDist = new Map<string, number>();
for (const r of racesCache.races) classDist.set(classOf(r.raceName), (classDist.get(classOf(r.raceName)) ?? 0) + 1);
console.log("\n  raceName から導けるクラス分布:");
for (const [k, n] of [...classDist.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(20)}: ${n}`);

const surfaces = new Map<string, number>();
for (const r of racesCache.races) surfaces.set(r.surface, (surfaces.get(r.surface) ?? 0) + 1);
console.log(`\n  surface: ${[...surfaces.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
const fieldSizes = racesCache.races.filter((r) => r.horses?.length).map((r) => r.horses.length);
fieldSizes.sort((a, b) => a - b);
console.log(`  頭数: min=${fieldSizes[0]} 中央値=${fieldSizes[Math.floor(fieldSizes.length / 2)]} max=${fieldSizes[fieldSizes.length - 1]}`);
console.log(`  馬場状態(良/稍/重/不良): races-cache・results-cache とも ${"track" in (sampleRace ?? {}) ? "保有" : "未保有"}`);

console.log("\n════ ② 払戻データの保有状況 ════");
const payouts = existsSync(join(process.cwd(), "lib", "payouts-cache.json"))
  ? loadLib<{ payouts: Array<Record<string, unknown>> }>("payouts-cache.json")
  : null;
if (payouts) {
  const keys = new Set<string>();
  for (const p of payouts.payouts) for (const k of Object.keys(p)) keys.add(k);
  console.log(`  payouts-cache: ${payouts.payouts.length} レース`);
  console.log(`  保有券種フィールド: ${[...keys].join(", ")}`);
  console.log(`  → 複勝(fukusho)・ワイド(wide): ${keys.has("fukusho") || keys.has("wide") ? "あり" : "なし"}`);
}

console.log("\n════ ④ 過去レース一括取得の規模感 ════");
const dates = [...new Set(racesCache.races.map((r) => r.date))].sort();
console.log(`  現在保有: ${racesCache.races.length} レース / ${dates.length} 開催日 (${dates[0]} 〜 ${dates[dates.length - 1]})`);
console.log(`  結果確定済み: ${resultsCache.results.filter((r) => r.finishers.length > 0).length} レース`);
const perDay = racesCache.races.length / dates.length;
console.log(`  1開催日あたり平均 ${perDay.toFixed(1)} レース`);
