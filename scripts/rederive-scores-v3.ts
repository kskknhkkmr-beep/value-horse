/**
 * v2 スコアの jockeyScore を「年度 < レース年」ルールで再導出し、
 * lib/scores-cache-v3.json に書き出す（設計: docs/backfill-leak-design.md §4）。
 *
 * ・スクレイピングは行わない。lib/jockey-yearly-cache.json の生データから
 *   レース年を cutoff にオフラインで導出するだけ。
 * ・formScore / pedigreeScore は v2 の値をそのまま引き継ぐ（馬側は毎週ライブで
 *   算出済み＝レース前時点の情報しか含まないため、リークは jockeyScore に固有）。
 * ・modelVersion==="v1" のエントリはそのままコピーする。v1 は jockeyScore が
 *   デフォルト固定だった世代であり、ここで実データを注入すると別モデルになって
 *   v2 vs v3 の比較が交絡するため、あえて触らない。
 * ・本番が読む lib/scores-cache.json は一切変更しない。
 *
 * 使い方:
 *   npx tsx scripts/rederive-scores-v3.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { calcJockeyScore, resolveJockeyStats, type HorseScores } from "../lib/scorer";
import type { RacesCache } from "./fetch-races";
import type { JockeyYearlyCache } from "./fetch-jockey-yearly";

type ScoresFile = { fetchedAt?: string; source?: string; scores?: Record<string, HorseScores> };

function loadJSON<T>(filename: string): T {
  const p = join(process.cwd(), "lib", filename);
  if (!existsSync(p)) throw new Error(`lib/${filename} が見つかりません`);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

function main() {
  console.log("=== v3 再導出（jockeyScore のリーク除去）===\n");

  const races = loadJSON<RacesCache>("races-cache.json");
  const scoresFile = loadJSON<ScoresFile>("scores-cache.json");
  const jockeyCache = loadJSON<JockeyYearlyCache>("jockey-yearly-cache.json");

  const src = scoresFile.scores ?? {};

  // 馬ID → { jockeyId, raceYear }
  const horseMeta = new Map<number, { jockeyId: string; jockeyName: string; year: number }>();
  for (const race of races.races) {
    const year = Number(race.date.slice(0, 4));
    if (!Number.isFinite(year)) continue;
    for (const h of race.horses) {
      if (h.jockeyId) horseMeta.set(h.id, { jockeyId: h.jockeyId, jockeyName: h.jockey ?? "", year });
    }
  }

  const out: Record<string, HorseScores> = {};
  const computedAt = new Date().toISOString();

  let v1Copied = 0;
  let converted = 0;
  let noMeta = 0;
  let noJockeyRows = 0;
  const nullJockeys = new Map<string, string>();   // 年度<Y の行が無い＝当年デビュー
  const missingJockeys = new Map<string, string>(); // 年度別キャッシュ未取得
  let scoreDelta: number[] = [];

  for (const [key, s] of Object.entries(src)) {
    const version = s.modelVersion ?? "v1";
    if (version !== "v2") {
      out[key] = s;
      v1Copied++;
      continue;
    }

    const meta = horseMeta.get(Number(key));
    if (!meta) {
      // races-cache に紐付かない（騎手IDが取れない）馬はそのまま残す
      out[key] = s;
      noMeta++;
      continue;
    }

    const entry = jockeyCache.jockeys[meta.jockeyId];
    if (!entry?.rows?.length) {
      missingJockeys.set(meta.jockeyId, meta.jockeyName);
      out[key] = { ...s, jockeyScore: null, jockeyStats: null, modelVersion: "v3", computedAt };
      noJockeyRows++;
      continue;
    }

    const stats = resolveJockeyStats(entry.rows, meta.year);
    const score = stats ? calcJockeyScore(stats) : null;
    if (!stats) nullJockeys.set(meta.jockeyId, meta.jockeyName);

    if (score != null && s.jockeyScore != null) scoreDelta.push(score - s.jockeyScore);

    out[key] = {
      ...s,
      jockeyScore: score,
      jockeyStats: stats,
      modelVersion: "v3",
      computedAt,
    };
    converted++;
  }

  const outPath = join(process.cwd(), "lib", "scores-cache-v3.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        fetchedAt: computedAt,
        source: "rederived from scores-cache.json + jockey-yearly-cache.json (year < raceYear cutoff)",
        scores: out,
      },
      null,
      2
    ),
    "utf-8"
  );

  // ── レポート ────────────────────────────────────────────────────────────
  console.log(`入力: scores-cache.json ${Object.keys(src).length} 頭`);
  console.log(`  v2 → v3 再導出:        ${converted} 頭`);
  console.log(`  v1 そのままコピー:      ${v1Copied} 頭`);
  console.log(`  races-cache 未紐付け:   ${noMeta} 頭（据え置き）`);
  console.log(`  騎手キャッシュ欠落:     ${noJockeyRows} 頭 → jockeyScore=null`);

  console.log(`\njockeyScore=null になった騎手（年度<レース年 の行が無い＝当年デビュー）: ${nullJockeys.size} 名`);
  for (const [id, name] of nullJockeys) console.log(`  - ${name}(${id})`);
  if (missingJockeys.size > 0) {
    console.log(`\n年度別キャッシュに無い騎手: ${missingJockeys.size} 名（fetch-jockey-yearly.ts を再実行してください）`);
    for (const [id, name] of missingJockeys) console.log(`  - ${name}(${id})`);
  }

  if (scoreDelta.length > 0) {
    scoreDelta.sort((a, b) => a - b);
    const mean = scoreDelta.reduce((a, b) => a + b, 0) / scoreDelta.length;
    const p = (q: number) => scoreDelta[Math.floor(q * (scoreDelta.length - 1))];
    console.log(`\njockeyScore の変化（v3 − v2、両方が非nullの ${scoreDelta.length} 頭）:`);
    console.log(`  平均 ${mean.toFixed(2)} / 中央 ${p(0.5)} / p10 ${p(0.1)} / p90 ${p(0.9)} / 最小 ${scoreDelta[0]} / 最大 ${scoreDelta[scoreDelta.length - 1]}`);
  }

  console.log(`\n✓ 書き出し: ${outPath}`);
}

main();
