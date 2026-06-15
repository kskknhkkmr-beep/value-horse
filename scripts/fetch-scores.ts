/**
 * netkeiba から馬の近走成績・騎手成績を取得してスコアを計算し、
 * lib/scores-cache.json に書き出す。
 *
 * レース・馬データの優先順位:
 *   1. lib/races-cache.json（fetch-races で生成）
 *   2. lib/mockData.ts（フォールバック）
 *
 * 使い方:
 *   npm run fetch-scores
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { horses as mockHorses, races as mockRaces } from "../lib/mockData";
import {
  fetchHorseIdMap,
  fetchHorseResults,
  fetchJockeyStats,
  JOCKEY_IDS,
} from "../lib/scraper";
import {
  calcFormScore,
  calcPedigreeScore,
  calcJockeyScore,
  type HorseScores,
} from "../lib/scorer";
import type { RacesCache, CachedRace, CachedHorse } from "./fetch-races";

// ── mockData 用レース条件（races-cache がない場合のフォールバック）────────────
const MOCK_RACE_CONDITIONS: Record<number, { netKeibaRaceId: string; surface: "芝" | "ダ" | "障"; distance: number }> = {
  1: { netKeibaRaceId: "202605030311", surface: "芝", distance: 1800 },
  2: { netKeibaRaceId: "202606030311", surface: "芝", distance: 1200 },
  3: { netKeibaRaceId: "202609030411", surface: "芝", distance: 2200 },
};

const DEFAULT_SCORE = 65;

// ── races-cache 読み込み ──────────────────────────────────────────────────────

function loadRacesCache(): RacesCache | null {
  try {
    const p = join(process.cwd(), "lib", "races-cache.json");
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf-8")) as RacesCache;
    return raw.races?.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

// ── メイン ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== VALUE HORSE score fetcher (netkeiba) ===");

  const racesCache = loadRacesCache();
  const usingCache = racesCache !== null;
  console.log(usingCache ? "データソース: races-cache.json" : "データソース: mockData（フォールバック）");

  const scores: Record<number, HorseScores> = {};
  const jockeyCache = new Map<string, { wins: number; rides: number; places: number } | null>();

  // ── races-cache.json がある場合 ───────────────────────────────────────────
  if (usingCache && racesCache) {
    console.log(`対象レース数: ${racesCache.races.length}`);

    for (const race of racesCache.races) {
      console.log(`\n━━ Race ${race.id}: ${race.raceName} (${race.venue} ${race.surface}${race.distance}m) ━━`);

      for (const horse of race.horses) {
        const jockeyName = horse.jockey ?? "";
        console.log(`\n  [${horse.horseNumber}] ${horse.horse} / ${jockeyName}`);

        // 馬近走成績: netKeibaHorseId を直接使用（fetchHorseIdMap 不要）
        let formScore = DEFAULT_SCORE;
        let pedigreeScore = DEFAULT_SCORE;

        if (horse.netKeibaHorseId) {
          const results = await fetchHorseResults(horse.netKeibaHorseId);
          if (results.length > 0) {
            formScore = calcFormScore(results);
            pedigreeScore = calcPedigreeScore(results, race.surface, race.distance);
            const matched = results.filter(
              (r) => r.surface === race.surface && Math.abs(r.distance - race.distance) <= 200
            ).length;
            console.log(`     近走 ${results.length}走 (同条件 ${matched}走) → form=${formScore}, pedigree=${pedigreeScore}`);
          } else {
            console.log(`     近走データなし → デフォルト(${DEFAULT_SCORE})`);
          }
        }

        // 騎手成績
        let jockeyScore = DEFAULT_SCORE;
        if (jockeyName && !jockeyCache.has(jockeyName)) {
          const jId = JOCKEY_IDS[jockeyName];
          if (jId) {
            jockeyCache.set(jockeyName, await fetchJockeyStats(jId));
          } else {
            console.log(`     騎手ID未登録: "${jockeyName}"`);
            jockeyCache.set(jockeyName, null);
          }
        }
        const jStats = jockeyName ? (jockeyCache.get(jockeyName) ?? null) : null;
        if (jStats) {
          jockeyScore = calcJockeyScore(jStats);
          const wr = ((jStats.wins / jStats.rides) * 100).toFixed(1);
          console.log(`     騎手 ${jStats.wins}勝/${jStats.rides}戦 (勝率${wr}%) → jockeyScore=${jockeyScore}`);
        }

        console.log(`     ✓ form=${formScore} pedigree=${pedigreeScore} jockey=${jockeyScore} training=${DEFAULT_SCORE}`);
        scores[horse.id] = { formScore, pedigreeScore, jockeyScore, trainingScore: DEFAULT_SCORE };
      }
    }
  } else {
    // ── mockData フォールバック ─────────────────────────────────────────────
    console.log(`対象レース数: ${mockRaces.length}`);

    for (const race of mockRaces) {
      const cond = MOCK_RACE_CONDITIONS[race.id];
      if (!cond) { console.warn(`\nレース ${race.id} の条件未定義 — スキップ`); continue; }

      const raceHorses = mockHorses.filter((h) => h.raceId === race.id);
      console.log(`\n━━ Race ${race.id}: ${race.raceName} (${race.venue} ${cond.surface}${cond.distance}m) ━━`);

      const horseIdMap = await fetchHorseIdMap(cond.netKeibaRaceId);
      console.log(`   馬ID取得: ${horseIdMap.size}頭`);

      for (const horse of raceHorses) {
        const jockeyName = (horse as { jockey?: string }).jockey ?? "";
        console.log(`\n  [${horse.horseNumber ?? horse.id}] ${horse.horse} / ${jockeyName}`);

        let formScore = DEFAULT_SCORE;
        let pedigreeScore = DEFAULT_SCORE;
        const horseId = horseIdMap.get(horse.horse);
        if (horseId) {
          const results = await fetchHorseResults(horseId);
          if (results.length > 0) {
            formScore = calcFormScore(results);
            pedigreeScore = calcPedigreeScore(results, cond.surface, cond.distance);
            const matched = results.filter(
              (r) => r.surface === cond.surface && Math.abs(r.distance - cond.distance) <= 200
            ).length;
            console.log(`     近走 ${results.length}走 (同条件 ${matched}走) → form=${formScore}, pedigree=${pedigreeScore}`);
          }
        }

        let jockeyScore = DEFAULT_SCORE;
        if (jockeyName && !jockeyCache.has(jockeyName)) {
          const jId = JOCKEY_IDS[jockeyName];
          jockeyCache.set(jockeyName, jId ? await fetchJockeyStats(jId) : null);
        }
        const jStats = jockeyName ? (jockeyCache.get(jockeyName) ?? null) : null;
        if (jStats) {
          jockeyScore = calcJockeyScore(jStats);
          console.log(`     騎手 ${jStats.wins}勝/${jStats.rides}戦 → jockeyScore=${jockeyScore}`);
        }

        scores[horse.id] = { formScore, pedigreeScore, jockeyScore, trainingScore: DEFAULT_SCORE };
      }
    }
  }

  // ── 出力 ─────────────────────────────────────────────────────────────────
  const output = {
    fetchedAt: new Date().toISOString(),
    source: "netkeiba db.netkeiba.com / race.sp.netkeiba.com",
    scores,
  };

  const outPath = join(process.cwd(), "lib", "scores-cache.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n✓ 書き出し完了: ${outPath}`);
  console.log(`  対象馬数: ${Object.keys(scores).length}`);
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
