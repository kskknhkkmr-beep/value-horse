/**
 * netkeiba から馬の近走成績・騎手成績を取得してスコアを計算し、
 * lib/scores-cache.json に書き出す。
 *
 * 使い方:
 *   npm run fetch-scores
 *
 * 出力: lib/scores-cache.json
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { horses, races } from "../lib/mockData";
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

// レースごとの設定
const RACE_CONDITIONS: Record<
  number,
  { netKeibaRaceId: string; surface: "芝" | "ダ" | "障"; distance: number }
> = {
  1: { netKeibaRaceId: "202605030311", surface: "芝", distance: 1800 }, // ジューンS 東京 芝1800m
  2: { netKeibaRaceId: "202606030311", surface: "芝", distance: 1200 }, // 函館スプリントS 函館 芝1200m
  3: { netKeibaRaceId: "202609030411", surface: "芝", distance: 2200 }, // 宝塚記念 阪神 芝2200m
};

const DEFAULT_SCORE = 65;

// ─── メイン ────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== VALUE HORSE score fetcher (netkeiba) ===");
  console.log(`対象レース数: ${races.length}`);

  const scores: Record<number, HorseScores> = {};
  const jockeyCache = new Map<string, { wins: number; rides: number; places: number } | null>();

  for (const race of races) {
    const cond = RACE_CONDITIONS[race.id];
    if (!cond) {
      console.warn(`\nレース ${race.id} の条件未定義 — スキップ`);
      continue;
    }

    const raceHorses = horses.filter((h) => h.raceId === race.id);
    console.log(
      `\n━━ Race ${race.id}: ${race.raceName} (${race.venue} ${cond.surface}${cond.distance}m) ━━`
    );

    // ── 1. SP出馬表から馬名→ID マップを取得 ──
    console.log(`   SP出馬表から馬IDを取得中... (${cond.netKeibaRaceId})`);
    const horseIdMap = await fetchHorseIdMap(cond.netKeibaRaceId);
    console.log(`   馬ID取得: ${horseIdMap.size}頭`);
    if (horseIdMap.size > 0) {
      for (const [name, id] of horseIdMap) {
        console.log(`     ${name} → ${id}`);
      }
    }

    // ── 2. 各馬の処理 ──
    for (const horse of raceHorses) {
      const jockeyName = (horse as { jockey?: string }).jockey ?? "";
      console.log(`\n  [${horse.horseNumber ?? horse.id}] ${horse.horse} / ${jockeyName}`);

      // 馬近走成績
      let formScore = DEFAULT_SCORE;
      let pedigreeScore = DEFAULT_SCORE;

      const horseId = horseIdMap.get(horse.horse);
      if (horseId) {
        console.log(`     馬ID: ${horseId}`);
        const results = await fetchHorseResults(horseId);
        if (results.length > 0) {
          formScore = calcFormScore(results);
          pedigreeScore = calcPedigreeScore(results, cond.surface, cond.distance);
          const matchedCount = results.filter(
            (r) => r.surface === cond.surface && Math.abs(r.distance - cond.distance) <= 200
          ).length;
          console.log(
            `     近走 ${results.length}走 (同条件 ${matchedCount}走)` +
            ` → form=${formScore}, pedigree=${pedigreeScore}`
          );
        } else {
          console.log(`     近走データなし → デフォルト(${DEFAULT_SCORE})`);
        }
      } else {
        console.log(`     馬ID未取得 → デフォルト(${DEFAULT_SCORE})`);
      }

      // 騎手成績（キャッシュ）
      let jockeyScore = DEFAULT_SCORE;
      if (jockeyName && !jockeyCache.has(jockeyName)) {
        const jId = JOCKEY_IDS[jockeyName];
        if (jId) {
          const stats = await fetchJockeyStats(jId);
          jockeyCache.set(jockeyName, stats);
        } else {
          console.log(`     騎手ID未登録: "${jockeyName}"`);
          jockeyCache.set(jockeyName, null);
        }
      }
      const jStats = jockeyName ? (jockeyCache.get(jockeyName) ?? null) : null;
      if (jStats) {
        jockeyScore = calcJockeyScore(jStats);
        const wr = ((jStats.wins / jStats.rides) * 100).toFixed(1);
        const pr = ((jStats.places / jStats.rides) * 100).toFixed(1);
        console.log(
          `     騎手 ${jStats.wins}勝/${jStats.rides}戦 (勝率${wr}% 連対率${pr}%)` +
          ` → jockeyScore=${jockeyScore}`
        );
      } else if (jockeyName) {
        console.log(`     騎手統計取得失敗 → デフォルト(${DEFAULT_SCORE})`);
      }

      console.log(
        `     ✓ form=${formScore} pedigree=${pedigreeScore} jockey=${jockeyScore} training=${DEFAULT_SCORE}`
      );

      scores[horse.id] = {
        formScore,
        pedigreeScore,
        jockeyScore,
        trainingScore: DEFAULT_SCORE,
      };
    }
  }

  // ── 出力 ──
  const output = {
    fetchedAt: new Date().toISOString(),
    source: "netkeiba db.netkeiba.com / race.sp.netkeiba.com",
    raceConditions: RACE_CONDITIONS,
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
