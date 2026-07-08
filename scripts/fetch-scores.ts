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
  fetchRaceEntry,
  fetchHorseResults,
  fetchJockeyStats,
  fetchTrainingScores,
} from "../lib/scraper";
import type { JockeyStats } from "../lib/scorer";
import {
  calcFormScore,
  calcPedigreeScore,
  calcJockeyScore,
  CURRENT_MODEL_VERSION,
  type HorseScores,
} from "../lib/scorer";
import type { RacesCache } from "./fetch-races";

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

// ── 既存スコア読み込み（累積 upsert 用）──────────────────────────────────────
// fetch-scores は latestDates のレースだけ再計算するため、既存スコアを土台に
// 読み込んでから今回分を上書き（upsert）する。これで過去週（v1 含む）の
// スコアを破壊せず、モデルバージョンをまたいで履歴が残る。

function loadExistingScores(outPath: string): Record<number, HorseScores> {
  const result: Record<number, HorseScores> = {};
  if (!existsSync(outPath)) return result;
  try {
    const raw = JSON.parse(readFileSync(outPath, "utf-8")) as { scores?: Record<string, HorseScores> };
    for (const [k, v] of Object.entries(raw.scores ?? {})) result[Number(k)] = v;
  } catch {
    // 壊れたキャッシュは無視
  }
  return result;
}

// ── メイン ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== VALUE HORSE score fetcher (netkeiba) ===");

  const racesCache = loadRacesCache();
  const usingCache = racesCache !== null;
  console.log(usingCache ? "データソース: races-cache.json" : "データソース: mockData（フォールバック）");

  const outPath = join(process.cwd(), "lib", "scores-cache.json");
  const computedAt = new Date().toISOString();

  // 既存スコアを土台に読み込み、今回算出分だけを upsert する（累積）
  const scores: Record<number, HorseScores> = loadExistingScores(outPath);
  const existingCount = Object.keys(scores).length;
  console.log(`既存スコア: ${existingCount} 頭（今回算出分を upsert）`);
  // netkeiba 騎手ID → JockeyStats（同一レース内・レース間で使い回す）
  const jockeyCache = new Map<string, JockeyStats | null>();

  async function getJockeyScore(jockeyId: string, jockeyName: string): Promise<number | null> {
    if (!jockeyId) return null;
    if (!jockeyCache.has(jockeyId)) {
      jockeyCache.set(jockeyId, await fetchJockeyStats(jockeyId));
    }
    const jStats = jockeyCache.get(jockeyId) ?? null;
    if (!jStats) return null;
    const score = calcJockeyScore(jStats);
    if (score == null) return null;
    const wr = ((jStats.wins / jStats.rides) * 100).toFixed(1);
    console.log(`     騎手 ${jockeyName}(${jockeyId}) ${jStats.wins}勝/${jStats.rides}戦 (勝率${wr}%) → jockeyScore=${score}`);
    return score;
  }

  // ── races-cache.json がある場合 ───────────────────────────────────────────
  if (usingCache && racesCache) {
    // latestDates のレースのみ対象（累積キャッシュでも今週分だけスコア取得）
    const latestDates = racesCache.latestDates ?? racesCache.dates.slice(-2);
    const targetRaces = racesCache.races.filter((r) => latestDates.includes(r.date));
    console.log(`対象レース数: ${targetRaces.length} (latestDates: ${latestDates.join(", ")})`);

    for (const race of targetRaces) {
      console.log(`\n━━ Race ${race.id}: ${race.raceName} (${race.venue} ${race.surface}${race.distance}m) ━━`);

      // 追い切り評価: レース単位で一括取得（馬IDキー）
      console.log(`  追い切り取得中...`);
      const trainingMap = await fetchTrainingScores(race.netKeibaRaceId);
      console.log(`  追い切り評価取得: ${trainingMap.size}頭`);

      for (const horse of race.horses) {
        const jockeyName = horse.jockey ?? "";
        console.log(`\n  [${horse.horseNumber}] ${horse.horse} / ${jockeyName}`);

        // 馬近走成績: netKeibaHorseId を直接使用
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

        // 騎手成績: 出馬表から直接取得した netkeiba 騎手ID を使用（名前照合は行わない）
        const jockeyScore = await getJockeyScore(horse.jockeyId ?? "", jockeyName);

        // 追い切り評価: netKeibaHorseId で照合。取得不能は null（欠損）
        const trainingScore = trainingMap.get(horse.netKeibaHorseId) ?? null;
        const trainingSrc = trainingMap.has(horse.netKeibaHorseId) ? "取得" : "欠損(null)";
        console.log(`     ✓ form=${formScore} pedigree=${pedigreeScore} jockey=${jockeyScore} training=${trainingScore}(${trainingSrc})`);
        scores[horse.id] = { formScore, pedigreeScore, jockeyScore, trainingScore, modelVersion: CURRENT_MODEL_VERSION, computedAt };
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

      // 出馬表を実際に取得し、馬ID・騎手ID・追い切り評価を名前照合で引き当てる
      const entry = await fetchRaceEntry(cond.netKeibaRaceId);
      const entryByName = new Map((entry?.horses ?? []).map((h) => [h.horse, h]));
      console.log(`   出馬表取得: ${entryByName.size}頭`);

      const trainingMap = await fetchTrainingScores(cond.netKeibaRaceId);
      console.log(`   追い切り評価取得: ${trainingMap.size}頭`);

      for (const horse of raceHorses) {
        const jockeyName = (horse as { jockey?: string }).jockey ?? "";
        console.log(`\n  [${horse.horseNumber ?? horse.id}] ${horse.horse} / ${jockeyName}`);

        const matched = entryByName.get(horse.horse);

        let formScore = DEFAULT_SCORE;
        let pedigreeScore = DEFAULT_SCORE;
        if (matched?.netKeibaHorseId) {
          const results = await fetchHorseResults(matched.netKeibaHorseId);
          if (results.length > 0) {
            formScore = calcFormScore(results);
            pedigreeScore = calcPedigreeScore(results, cond.surface, cond.distance);
            const matchedCount = results.filter(
              (r) => r.surface === cond.surface && Math.abs(r.distance - cond.distance) <= 200
            ).length;
            console.log(`     近走 ${results.length}走 (同条件 ${matchedCount}走) → form=${formScore}, pedigree=${pedigreeScore}`);
          }
        }

        // 騎手成績: 出馬表側の実データを優先し、mockData の名前は表示用のみに使う
        const jockeyId = matched?.jockeyId ?? "";
        const jockeyScore = await getJockeyScore(jockeyId, matched?.jockey ?? jockeyName);

        const trainingScore = matched?.netKeibaHorseId
          ? (trainingMap.get(matched.netKeibaHorseId) ?? null)
          : null;

        scores[horse.id] = { formScore, pedigreeScore, jockeyScore, trainingScore, modelVersion: CURRENT_MODEL_VERSION, computedAt };
      }
    }
  }

  // ── 出力 ─────────────────────────────────────────────────────────────────
  const output = {
    fetchedAt: computedAt,
    source: "netkeiba db.netkeiba.com / race.sp.netkeiba.com",
    scores,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n✓ 書き出し完了: ${outPath}`);
  console.log(`  累積馬数: ${Object.keys(scores).length}（新規/更新を含む）`);
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
