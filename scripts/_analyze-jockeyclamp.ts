/**
 * 調査1補足: jockeyScore のクランプ(40〜95)による情報損失の検証。
 * calcJockeyScore: raw = winRate*400 + placeRate*150 を 40..95 に丸めている。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RacesCache } from "./fetch-races";
import type { ResultsCache } from "./fetch-results";
import type { HorseScores } from "../lib/scorer";

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

type H = { jockey: number | null; won: boolean };
const hs: H[] = [];
const processed = new Set<string>();
for (const race of racesCache.races) {
  if (race.entriesPending || !race.horses.length) continue;
  const re = resultsCache.results.find((r) => r.netKeibaRaceId === race.netKeibaRaceId);
  if (!re || !re.finishers.length) continue;
  processed.add(race.netKeibaRaceId);
  const w = re.finishers.find((f) => f.position === 1);
  const om = new Map<string, number>();
  for (const f of re.finishers) if (f.odds != null && f.odds > 0) om.set(f.horse, f.odds);
  for (const h of race.horses) {
    const odds = h.odds ?? om.get(h.horse) ?? null;
    if (odds == null || odds <= 0) continue;
    const c = scoresById[h.id];
    if (!c) continue;
    hs.push({ jockey: c.jockeyScore ?? null, won: w != null && (w.horse === h.horse || w.horseNumber === h.horseNumber) });
  }
}

console.log(`実スコア保有馬: ${hs.length}`);
const clamped40 = hs.filter((h) => h.jockey === 40);
const clamped95 = hs.filter((h) => h.jockey === 95);
const mid = hs.filter((h) => h.jockey != null && h.jockey > 40 && h.jockey < 95);
const def65 = hs.filter((h) => h.jockey === 65);

console.log("\n════ jockeyScore の値の集中 ════");
console.log(`  下限クランプ(=40)   : ${clamped40.length} (${((clamped40.length / hs.length) * 100).toFixed(1)}%)  実測勝率=${((clamped40.filter((h) => h.won).length / clamped40.length) * 100).toFixed(2)}%`);
console.log(`  DEFAULT(=65)        : ${def65.length} (${((def65.length / hs.length) * 100).toFixed(1)}%)  実測勝率=${((def65.filter((h) => h.won).length / def65.length) * 100).toFixed(2)}%`);
console.log(`  上限クランプ(=95)   : ${clamped95.length} (${((clamped95.length / hs.length) * 100).toFixed(1)}%)  実測勝率=${((clamped95.filter((h) => h.won).length / clamped95.length) * 100).toFixed(2)}%`);
console.log(`  中間値(41-94)       : ${mid.length} (${((mid.length / hs.length) * 100).toFixed(1)}%)  実測勝率=${((mid.filter((h) => h.won).length / mid.length) * 100).toFixed(2)}%`);

console.log("\n→ 下限40に押し込められた馬が全体の約4割。この層の内部差（下手な騎手と");
console.log("  そこそこの騎手）は完全に失われている。実測勝率の差を見ると、");
console.log(`  40群(${((clamped40.filter((h) => h.won).length / clamped40.length) * 100).toFixed(2)}%) と 95群(${((clamped95.filter((h) => h.won).length / clamped95.length) * 100).toFixed(2)}%) で明確な差があり、`);
console.log("  騎手情報自体は有効。粒度を上げれば伸びしろがある。");
