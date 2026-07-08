/**
 * 既存 scores-cache.json の全スコアに modelVersion="v1" を一括付与する
 * 一回限りのマイグレーション。
 *
 * be7add6（training/jockey 実データ化）以前に算出された既存スコアは、
 * jockeyScore・trainingScore がデフォルト値(65)固定の旧モデル(v1)である。
 * これらを v1 として明示的にタグ付けし、以降 fetch-scores が書く v2 と
 * バックテスト等で分離集計できるようにする。
 *
 * - 既に modelVersion を持つエントリは変更しない（冪等）
 * - computedAt はファイルの fetchedAt を流用
 *
 * 使い方:
 *   npx tsx scripts/tag-scores-v1.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { HorseScores } from "../lib/scorer";

type ScoresFile = {
  fetchedAt?: string;
  source?: string;
  scores?: Record<string, HorseScores>;
};

function main() {
  const p = join(process.cwd(), "lib", "scores-cache.json");
  if (!existsSync(p)) {
    console.error("scores-cache.json が見つかりません:", p);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(p, "utf-8")) as ScoresFile;
  const scores = raw.scores ?? {};
  const computedAt = raw.fetchedAt ?? new Date().toISOString();

  let tagged = 0;
  let skipped = 0;
  for (const entry of Object.values(scores)) {
    if (entry.modelVersion) {
      skipped++;
      continue;
    }
    entry.modelVersion = "v1";
    entry.computedAt = entry.computedAt ?? computedAt;
    tagged++;
  }

  writeFileSync(p, JSON.stringify(raw, null, 2), "utf-8");
  console.log(`✓ v1 タグ付け完了: ${p}`);
  console.log(`  新規タグ付け: ${tagged} 頭 / 既タグ済みスキップ: ${skipped} 頭`);
}

main();
