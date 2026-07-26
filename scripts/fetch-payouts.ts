/**
 * results-cache.json で結果確定済みのレースについて、馬連・馬単の確定払戻を
 * netkeiba から取得し、lib/payouts-cache.json に累積保存する。
 *
 * 単勝vsボックス買いのバックテスト用に一度だけ使うデータ取得スクリプト。
 * results-cache.json / race-data.yml の自動更新パイプラインとは独立しており、
 * 既存の本番キャッシュ・スキーマには一切手を加えない。
 *
 * 使い方:
 *   npx tsx scripts/fetch-payouts.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fetchRacePayouts, type RacePayouts } from "../lib/scraper";
import type { ResultsCache } from "./fetch-results";

export type PayoutEntry = {
  raceId: number;
  netKeibaRaceId: string;
  date: string;
  venue: string;
  raceNumber: number;
} & RacePayouts;

export type PayoutsCache = {
  fetchedAt: string;
  payouts: PayoutEntry[];
};

const outPath = join(process.cwd(), "lib", "payouts-cache.json");

function loadResultsCache(): ResultsCache {
  const p = join(process.cwd(), "lib", "results-cache.json");
  if (!existsSync(p)) {
    console.error("results-cache.json が見つかりません。");
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, "utf-8")) as ResultsCache;
}

function loadExisting(): Map<string, PayoutEntry> {
  const map = new Map<string, PayoutEntry>();
  if (!existsSync(outPath)) return map;
  try {
    const raw = JSON.parse(readFileSync(outPath, "utf-8")) as PayoutsCache;
    for (const e of raw.payouts ?? []) map.set(e.netKeibaRaceId, e);
  } catch {
    // 壊れたキャッシュは無視
  }
  return map;
}

function save(map: Map<string, PayoutEntry>) {
  const payouts = Array.from(map.values()).sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const v = a.venue.localeCompare(b.venue);
    if (v !== 0) return v;
    return a.raceNumber - b.raceNumber;
  });
  writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), payouts }, null, 2), "utf-8");
}

async function main() {
  console.log("=== payout fetcher (umaren/umatan) ===");
  const resultsCache = loadResultsCache();
  const finished = resultsCache.results.filter((r) => r.finishers.length > 0);
  console.log(`結果確定済み: ${finished.length} レース`);

  const existing = loadExisting();
  console.log(`既存払戻データ: ${existing.size} レース`);

  const targets = finished.filter((r) => !existing.has(r.netKeibaRaceId));
  console.log(`今回取得対象: ${targets.length} レース\n`);

  let done = 0;
  for (const r of targets) {
    process.stdout.write(`  [${r.netKeibaRaceId}] ${r.date} ${r.venue}${r.raceNumber}R ${r.raceName} ...`);
    const payouts = await fetchRacePayouts(r.netKeibaRaceId);
    existing.set(r.netKeibaRaceId, {
      raceId: r.raceId,
      netKeibaRaceId: r.netKeibaRaceId,
      date: r.date,
      venue: r.venue,
      raceNumber: r.raceNumber,
      umaren: payouts.umaren,
      umatan: payouts.umatan,
    });
    done++;
    const ok = payouts.umaren.length > 0 || payouts.umatan.length > 0;
    console.log(ok ? ` ✓ 馬連${payouts.umaren.length}件 馬単${payouts.umatan.length}件` : " ✗ 取得失敗");

    // 15件ごとに中間保存（長時間実行中の中断に備える）
    if (done % 15 === 0) save(existing);
  }

  save(existing);
  console.log(`\n✓ 書き出し完了: ${outPath}`);
  console.log(`  合計: ${existing.size} レース（今回新規: ${done} レース）`);
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
