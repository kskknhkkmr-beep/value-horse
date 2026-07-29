/**
 * 一回限りの移行スクリプト（是正案②）。
 *
 * lib/scores-cache.json の v2 エントリについて、以前 clamp(40〜95) されていた
 * jockeyScore を、生スタッツ（wins/rides/places）から再計算した unclamped 値へ
 * 置き換え、その生スタッツを jockeyStats として一緒に保存する。
 * 再スクレイピングはせず、既に取得済みの scripts/_cache/jockey_raw.json
 * （lib/races-cache.json の horseId→jockeyId マップと突き合わせ）を使う。
 *
 * 併せて、除去済みの trainingScore キーを全エントリ（v1含む）から削除する。
 *
 * jockeyId が races-cache から引けない、または jockey_raw.json に該当が無い
 * 場合は jockeyScore を変更しない（jockeyStats も付与しない）。
 *
 * 使い方: npx tsx scripts/_migrate-jockey-unclamp.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { calcJockeyScore } from "../lib/scorer";
import type { HorseScores, JockeyStats } from "../lib/scorer";
import type { RacesCache } from "./fetch-races";

function loadJSON<T>(f: string): T {
  const p = join(process.cwd(), "lib", f);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

function main() {
  const racesCache = loadJSON<RacesCache>("races-cache.json");
  const scoresPath = join(process.cwd(), "lib", "scores-cache.json");
  const scoresFile = JSON.parse(readFileSync(scoresPath, "utf-8")) as {
    fetchedAt?: string;
    source?: string;
    scores: Record<string, HorseScores & { trainingScore?: number | null }>;
  };

  const rawPath = join(process.cwd(), "scripts", "_cache", "jockey_raw.json");
  if (!existsSync(rawPath)) {
    console.error("scripts/_cache/jockey_raw.json が見つかりません。scripts/_fetch-jockey-raw.ts を先に実行してください。");
    process.exit(1);
  }
  const jockeyRaw = JSON.parse(readFileSync(rawPath, "utf-8")) as Record<string, (JockeyStats & { name: string }) | null>;

  // horseId → jockeyId（races-cache 全体から。累積キャッシュなので過去分も含む）
  const jockeyIdByHorseId = new Map<number, string>();
  for (const race of racesCache.races) {
    if (!race.horses) continue;
    for (const h of race.horses) {
      if (h.jockeyId) jockeyIdByHorseId.set(h.id, h.jockeyId);
    }
  }

  let v2Total = 0, updated = 0, noJockeyId = 0, noRawStats = 0;
  let trainingStripped = 0;

  for (const [idStr, entry] of Object.entries(scoresFile.scores)) {
    const id = Number(idStr);

    // ① trainingScore 除去（v1/v2 問わず全件）
    if ("trainingScore" in entry) {
      delete entry.trainingScore;
      trainingStripped++;
    }

    if (entry.modelVersion !== "v2") continue;
    v2Total++;

    const jockeyId = jockeyIdByHorseId.get(id);
    if (!jockeyId) { noJockeyId++; continue; }

    const stats = jockeyRaw[jockeyId];
    if (!stats) { noRawStats++; continue; }

    const newScore = calcJockeyScore(stats);
    entry.jockeyScore = newScore;
    entry.jockeyStats = { wins: stats.wins, rides: stats.rides, places: stats.places };
    updated++;
  }

  writeFileSync(scoresPath, JSON.stringify(scoresFile, null, 2), "utf-8");

  console.log(`✓ 移行完了: ${scoresPath}`);
  console.log(`  trainingScore キー削除: ${trainingStripped} 件`);
  console.log(`  v2エントリ: ${v2Total} 件`);
  console.log(`    jockeyScore再計算+jockeyStats付与: ${updated} 件`);
  console.log(`    jockeyId不明のためスキップ: ${noJockeyId} 件`);
  console.log(`    jockey_raw.jsonに該当なしのためスキップ: ${noRawStats} 件`);
}

main();
