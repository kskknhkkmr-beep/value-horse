/**
 * races-cache.json に記録されたレースの確定着順を取得して
 * lib/results-cache.json に追記（累積）する。
 *
 * - 既存データは netKeibaRaceId でキーを建て、upsert する
 * - 新規取得で finishers が空のとき、既存に結果があれば既存を保持
 * - 直近 RETENTION_MONTHS ヶ月より古いデータは自動削除
 *
 * 使い方:
 *   npm run fetch-results
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fetchRaceResult, type RaceFinishResult } from "../lib/scraper";
import type { RacesCache } from "./fetch-races";

const RETENTION_MONTHS = 3;

export type RaceResultEntry = {
  raceId: number;
  netKeibaRaceId: string;
  raceName: string;
  raceNumber: number;
  date: string;
  venue: string;
  finishers: RaceFinishResult[];
};

export type ResultsCache = {
  fetchedAt: string;
  results: RaceResultEntry[];
};

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

function loadExistingResults(outPath: string): Map<string, RaceResultEntry> {
  const map = new Map<string, RaceResultEntry>();
  if (!existsSync(outPath)) return map;
  try {
    const existing = JSON.parse(readFileSync(outPath, "utf-8")) as ResultsCache;
    for (const entry of existing.results ?? []) {
      map.set(entry.netKeibaRaceId, entry);
    }
  } catch {
    // 壊れたキャッシュは無視して空 Map を返す
  }
  return map;
}

/** 保持期限の日付文字列 (YYYY-MM-DD) を返す */
function retentionCutoff(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - RETENTION_MONTHS);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log("=== VALUE HORSE result fetcher ===");

  const racesCache = loadRacesCache();
  if (!racesCache) {
    console.error("races-cache.json が見つかりません。先に npm run fetch-races を実行してください。");
    process.exit(1);
  }

  const outPath = join(process.cwd(), "lib", "results-cache.json");

  // 既存データを Map に読み込む
  const resultMap = loadExistingResults(outPath);
  console.log(`既存データ: ${resultMap.size} レース`);

  const today = new Date().toISOString().slice(0, 10);

  // 取得対象:
  //   - 今日のレース → 常に再取得（レース途中でも随時更新）
  //   - 過去のレース → results-cache に結果未登録のもののみ
  //   - 未来のレース → スキップ
  const targets = racesCache.races.filter((r) => {
    if (r.entriesPending || r.horses.length === 0) return false;
    if (r.date > today) return false; // 未来のレースはスキップ
    if (r.date === today) return true; // 今日は常に取得
    const existing = resultMap.get(r.netKeibaRaceId);
    return !existing || existing.finishers.length === 0; // 過去は未取得のみ
  });
  console.log(`今回取得対象: ${targets.length} / ${racesCache.races.length} レース`);

  let fetchedCount = 0;
  let skippedCount = 0;

  for (const race of targets) {
    process.stdout.write(`  [${race.id}] ${race.raceName} (${race.netKeibaRaceId}) ...`);
    const finishers = await fetchRaceResult(race.netKeibaRaceId);

    const existing = resultMap.get(race.netKeibaRaceId);

    if (finishers.length > 0) {
      // 新規取得成功 → upsert
      resultMap.set(race.netKeibaRaceId, {
        raceId: race.id,
        netKeibaRaceId: race.netKeibaRaceId,
        raceName: race.raceName,
        raceNumber: race.raceNumber,
        date: race.date,
        venue: race.venue,
        finishers,
      });
      fetchedCount++;
      console.log(` ✓ ${finishers.length}頭 (1着: ${finishers[0]?.horse ?? "?"})`);
    } else if (existing && existing.finishers.length > 0) {
      // 新規取得失敗 & 既存に結果あり → 既存を保持
      skippedCount++;
      console.log(` 未確定（既存データ保持: ${existing.finishers.length}頭）`);
    } else {
      // 新規取得失敗 & 既存も空 → 空エントリを書く（未確定）
      resultMap.set(race.netKeibaRaceId, {
        raceId: race.id,
        netKeibaRaceId: race.netKeibaRaceId,
        raceName: race.raceName,
        raceNumber: race.raceNumber,
        date: race.date,
        venue: race.venue,
        finishers: [],
      });
      console.log(" 結果未確定");
    }
  }

  // 保持期限より古いエントリを除外
  const cutoff = retentionCutoff();
  let pruned = 0;
  for (const [id, entry] of resultMap) {
    if (entry.date < cutoff) {
      resultMap.delete(id);
      pruned++;
    }
  }
  if (pruned > 0) console.log(`\n保持期限切れ削除: ${pruned} レース（${cutoff} より前）`);

  // date → venue → raceNumber でソートして書き出し
  const merged = Array.from(resultMap.values()).sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const v = a.venue.localeCompare(b.venue);
    if (v !== 0) return v;
    return a.raceNumber - b.raceNumber;
  });

  const output: ResultsCache = {
    fetchedAt: new Date().toISOString(),
    results: merged,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

  const withResult = merged.filter((r) => r.finishers.length > 0).length;
  console.log(`\n✓ 書き出し完了: ${outPath}`);
  console.log(`  合計: ${merged.length} レース（うち結果確定 ${withResult} レース）`);
  console.log(`  今回新規取得: ${fetchedCount} レース / 既存保持: ${skippedCount} レース`);
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
