/**
 * 騎手の年度別成績テーブルを **集約せず全行のまま** 取得し、
 * lib/jockey-yearly-cache.json に保存する。
 *
 * 設計: docs/backfill-leak-design.md §3-2
 *   取得はエンティティ（騎手）単位で1回だけ。レース年を cutoff にした
 *   per-race の切り出しは resolveJockeyStats でオフラインに行う。
 *   → MIN_RIDES や「前年のみ vs 過去全年」の比較を再スクレイピング無しで試せる。
 *
 * 完了年度の行は不変なので、再取得は年跨ぎと新規騎手の追加時のみでよい。
 *
 * 使い方:
 *   npx tsx scripts/fetch-jockey-yearly.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fetchJockeyYearlyTable } from "../lib/scraper";
import type { JockeyYearRow } from "../lib/scorer";
import type { RacesCache } from "./fetch-races";

export type JockeyYearlyEntry = {
  name: string;
  rows: JockeyYearRow[];
  fetchedAt: string;
};

export type JockeyYearlyCache = {
  fetchedAt: string;
  source: string;
  jockeys: Record<string, JockeyYearlyEntry>;
};

const OUT_PATH = join(process.cwd(), "lib", "jockey-yearly-cache.json");

function loadRacesCache(): RacesCache {
  const p = join(process.cwd(), "lib", "races-cache.json");
  if (!existsSync(p)) throw new Error("lib/races-cache.json が見つかりません");
  return JSON.parse(readFileSync(p, "utf-8")) as RacesCache;
}

function loadExisting(): JockeyYearlyCache {
  if (!existsSync(OUT_PATH)) {
    return { fetchedAt: "", source: "db.netkeiba.com/jockey/result/", jockeys: {} };
  }
  try {
    return JSON.parse(readFileSync(OUT_PATH, "utf-8")) as JockeyYearlyCache;
  } catch {
    return { fetchedAt: "", source: "db.netkeiba.com/jockey/result/", jockeys: {} };
  }
}

function save(cache: JockeyYearlyCache) {
  cache.fetchedAt = new Date().toISOString();
  writeFileSync(OUT_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

async function main() {
  console.log("=== 騎手 年度別成績（生データ）取得 ===");

  const races = loadRacesCache();
  const jockeys = new Map<string, string>();
  for (const r of races.races) {
    for (const h of r.horses) if (h.jockeyId) jockeys.set(h.jockeyId, h.jockey ?? "");
  }

  const cache = loadExisting();
  // 取得済み（rows あり）はスキップ。失敗して null 相当になった分は再試行する。
  const todo = [...jockeys].filter(([id]) => !cache.jockeys[id]?.rows?.length);

  console.log(`騎手 ${jockeys.size} 名 / 未取得 ${todo.length} 名`);
  console.log(`推定所要: 約 ${Math.ceil((todo.length * 1.3) / 60)} 分\n`);

  let done = 0;
  let failed = 0;
  for (const [id, name] of todo) {
    const rows = await fetchJockeyYearlyTable(id);
    done++;
    if (!rows) {
      failed++;
      console.warn(`  ✗ ${name}(${id}) 取得失敗`);
    } else {
      const years = rows.filter((r) => /^\d{4}$/.test(r.label)).map((r) => r.label);
      cache.jockeys[id] = { name, rows, fetchedAt: new Date().toISOString() };
      console.log(`  [${done}/${todo.length}] ${name}(${id}) ${rows.length}行 (${years[years.length - 1]}〜${years[0]})`);
    }
    // 中断耐性: エンティティ単位で逐次チェックポイント（docs §5-1）
    if (done % 10 === 0) save(cache);
  }
  save(cache);

  const total = Object.keys(cache.jockeys).length;
  console.log(`\n✓ 完了: ${total}/${jockeys.size} 名 → lib/jockey-yearly-cache.json`);
  if (failed > 0) console.log(`  （今回失敗 ${failed} 名 — 再実行で未取得分のみ取り直します）`);
}

main().catch((e) => {
  console.error("\n[ERROR]", e);
  process.exit(1);
});
