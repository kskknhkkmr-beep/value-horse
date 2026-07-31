/**
 * results-cache.json で結果確定済みのレースについて、確定払戻
 * （単勝・複勝・ワイド・馬連・馬単）を netkeiba から取得し、
 * lib/payouts-cache.json に累積保存する。
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

  // 再取得が必要なもの:
  //  (a) 未取得
  //  (b) 旧スキーマ（tan/fuku/wide が無い＝馬連・馬単だけの世代）
  //  (c) 前回取得が失敗して払戻が空（一時的な取得失敗の取りこぼし回収）
  function needsFetch(id: string): boolean {
    const e = existing.get(id);
    if (!e) return true;
    if (!e.tan || !e.fuku || !e.wide) return true;
    return e.umaren.length === 0 && e.tan.length === 0;
  }

  const targets = finished.filter((r) => needsFetch(r.netKeibaRaceId));
  console.log(`今回取得対象: ${targets.length} レース\n`);

  let done = 0;
  let failed = 0;
  for (const r of targets) {
    process.stdout.write(`  [${r.netKeibaRaceId}] ${r.date} ${r.venue}${r.raceNumber}R ${r.raceName} ...`);
    const payouts = await fetchRacePayouts(r.netKeibaRaceId);
    const ok = payouts.tan.length > 0 || payouts.umaren.length > 0;
    if (ok) {
      existing.set(r.netKeibaRaceId, {
        raceId: r.raceId,
        netKeibaRaceId: r.netKeibaRaceId,
        date: r.date,
        venue: r.venue,
        raceNumber: r.raceNumber,
        tan: payouts.tan,
        fuku: payouts.fuku,
        wide: payouts.wide,
        umaren: payouts.umaren,
        umatan: payouts.umatan,
      });
      console.log(
        ` ✓ 単${payouts.tan.length} 複${payouts.fuku.length} ワ${payouts.wide.length}` +
          ` 馬連${payouts.umaren.length} 馬単${payouts.umatan.length}`
      );
    } else {
      // 失敗時は既存エントリを上書きしない（部分データで潰さない）
      failed++;
      console.log(" ✗ 取得失敗");
    }
    done++;

    // 15件ごとに中間保存（長時間実行中の中断に備える）
    if (done % 15 === 0) save(existing);
  }

  save(existing);
  console.log(`\n✓ 書き出し完了: ${outPath}`);
  console.log(`  合計: ${existing.size} レース（今回取得: ${done} 件 / うち失敗 ${failed} 件）`);
  if (failed > 0) {
    console.log("  ※ 失敗分はもう一度同じコマンドを実行すれば再試行されます。");
  }
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
