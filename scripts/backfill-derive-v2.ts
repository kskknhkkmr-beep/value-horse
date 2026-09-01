/**
 * ④ A/B検証専用: バックフィルデータに対する「リークあり(v2相当)」スコアの再導出。
 *
 * backfill-derive.ts が書き出す scores-cache.json は常に v3（jockeyScore を
 * 「年度 < レース年」の行のみから算出、リーク無し）。本番の v2 は当年行を
 * 含む最新年度行をそのまま使う（is leaky = レース時点でまだ起きていない
 * 当年後半の騎乗結果が混入し得る）ため、そのままでは v2/v3 の A/B ができない。
 *
 * ここでは resolveJockeyStats に raceYear+1 を渡すことで cutoff を1年ゆるめ、
 * 「年度 <= レース年」の行（＝当年行を含む）を許すリーク版を再現する。
 * これは docs/backfill-leak-design.md の v2/v3 比較で使ったのと同じ手法
 * （cutoff ルールだけを変えて同一の生データから作り分ける）。
 * formScore/pedigreeScore は元々レース日 cutoff 済みでリークが無いため v2/v3 で共通。
 *
 * races-cache/results-cache/payouts-cache は backfill-derive.ts の出力をそのまま使う
 * （スコア以外はバージョン間で不変）。
 *
 * 実行: npx tsx scripts/backfill-derive-v2.ts --dir=lib/backfill
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { calcFormScore, calcPedigreeScore, calcJockeyScore, resolveJockeyStats, type HorseScores, type RaceResult } from "../lib/scorer";
import type { DbRacePage } from "../lib/scraper";
import type { JockeyYearlyCache } from "./fetch-jockey-yearly";

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const DIR = arg("dir") ?? "lib/backfill";
const dirPath = join(process.cwd(), DIR);

function loadLocal<T>(file: string): T {
  const p = join(dirPath, file);
  if (!existsSync(p)) throw new Error(`${p} が見つかりません（先に backfill-fetch.ts / backfill-derive.ts を実行）`);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

function stableRaceId(netKeibaRaceId: string): number {
  return parseInt(netKeibaRaceId.slice(4), 10);
}

type HorsesStore = { horses: Record<string, { rows: RaceResult[]; fetchedAt: string }> };

function main() {
  console.log(`=== ④ バックフィル導出（v2相当・リークあり再現, dir=${DIR}) ===\n`);

  const racesStore = loadLocal<{ races: Record<string, DbRacePage> }>("races.json");
  const horsesStore = loadLocal<HorsesStore>("horses.json");
  const jockeyCache = JSON.parse(
    readFileSync(join(process.cwd(), "lib", "jockey-yearly-cache.json"), "utf-8")
  ) as JockeyYearlyCache;

  const pages = Object.values(racesStore.races);

  const scores: Record<number, HorseScores> = {};
  const computedAt = new Date().toISOString();
  let nullJockey = 0;
  let changedVsLeakFree = 0;
  let comparedCount = 0;

  for (const page of pages) {
    const rid = stableRaceId(page.netKeibaRaceId);
    const raceYear = Number(page.date.slice(0, 4));
    const cutoff = page.date.replace(/-/g, "/");

    page.horses.forEach((h, i) => {
      const horseId = rid * 100 + i + 1;
      const entry = horsesStore.horses[h.horseId];
      if (!entry) return; // スコア無し(取得失敗)は v3 と同様に欠損のまま

      const past = entry.rows.filter((r) => r.date < cutoff).slice(0, 10);
      const formScore = calcFormScore(past);
      const pedigreeScore = calcPedigreeScore(past, page.surface, page.distance);

      // ── リーク版: 「年度 <= レース年」を許す（raceYear+1 を渡して cutoff を1年ゆるめる） ──
      const jRows = h.jockeyId ? jockeyCache.jockeys[h.jockeyId]?.rows : undefined;
      const leakyStats = jRows ? resolveJockeyStats(jRows, raceYear + 1) : null;
      const leakyScore = leakyStats ? calcJockeyScore(leakyStats) : null;
      if (leakyScore == null) nullJockey++;

      // 参考: leak-free版との差分件数（デバッグ用ログ）
      const freeStats = jRows ? resolveJockeyStats(jRows, raceYear) : null;
      const freeScore = freeStats ? calcJockeyScore(freeStats) : null;
      if (freeScore != null && leakyScore != null) {
        comparedCount++;
        if (freeScore !== leakyScore) changedVsLeakFree++;
      }

      scores[horseId] = {
        formScore,
        pedigreeScore,
        jockeyScore: leakyScore,
        jockeyStats: leakyStats,
        modelVersion: "v2",
        computedAt,
      };
    });
  }

  writeFileSync(
    join(dirPath, "scores-cache-v2.json"),
    JSON.stringify({
      fetchedAt: computedAt,
      source: "backfill (leaky reconstruction: jockey year <= race year, for v2/v3 A/B only)",
      scores,
    }),
    "utf-8"
  );

  console.log(`スコア算出: ${Object.keys(scores).length}頭`);
  console.log(`jockeyScore=null: ${nullJockey}頭`);
  console.log(`leak-free(v3)版と比較して jockeyScore が変化: ${changedVsLeakFree}/${comparedCount}頭`);
  console.log(`\n✓ 書き出し: ${DIR}/scores-cache-v2.json`);
}

main();
