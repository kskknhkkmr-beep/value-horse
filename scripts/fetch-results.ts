/**
 * races-cache.json に記録されたレースの確定着順を取得して
 * lib/results-cache.json に書き出す。
 *
 * 使い方:
 *   npm run fetch-results
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fetchRaceResult, type RaceFinishResult } from "../lib/scraper";
import type { RacesCache } from "./fetch-races";

export type RaceResultEntry = {
  raceId: number;
  netKeibaRaceId: string;
  raceName: string;
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

async function main() {
  console.log("=== VALUE HORSE result fetcher ===");

  const racesCache = loadRacesCache();
  if (!racesCache) {
    console.error("races-cache.json が見つかりません。先に npm run fetch-races を実行してください。");
    process.exit(1);
  }

  // 出走登録済みで entriesPending でないレースのみ対象
  const targets = racesCache.races.filter((r) => !r.entriesPending && r.horses.length > 0);
  console.log(`対象レース数: ${targets.length} / ${racesCache.races.length}`);

  const results: RaceResultEntry[] = [];

  for (const race of targets) {
    process.stdout.write(`  [${race.id}] ${race.raceName} (${race.netKeibaRaceId}) ...`);
    const finishers = await fetchRaceResult(race.netKeibaRaceId);

    if (finishers.length === 0) {
      console.log(" 結果未確定 or 取得失敗");
    } else {
      console.log(` ✓ ${finishers.length}頭 (1着: ${finishers[0]?.horse ?? "?"})`);
    }

    results.push({
      raceId: race.id,
      netKeibaRaceId: race.netKeibaRaceId,
      raceName: race.raceName,
      date: race.date,
      venue: race.venue,
      finishers,
    });
  }

  const output: ResultsCache = {
    fetchedAt: new Date().toISOString(),
    results,
  };

  const outPath = join(process.cwd(), "lib", "results-cache.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n✓ 書き出し完了: ${outPath}`);
  console.log(`  結果取得済み: ${results.filter((r) => r.finishers.length > 0).length}レース`);
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
