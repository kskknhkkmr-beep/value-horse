/**
 * ④ バックフィル — 導出フェーズ（オフライン・ネットワーク不使用）
 *
 * backfill-fetch.ts が集めた生データから、**レース日を cutoff にして**
 * 本番と同じスキーマのキャッシュ4点を書き出す。
 *
 *   {dir}/races-cache.json    … RacesCache
 *   {dir}/results-cache.json  … ResultsCache
 *   {dir}/payouts-cache.json  … PayoutsCache
 *   {dir}/scores-cache.json   … HorseScores（modelVersion="v3"）
 *
 * 本番と同一スキーマにするのが要点で、既存の分析スクリプトを
 * 読み込み先の差し替えだけでそのまま流用できる。
 *
 * リーク対策（docs/backfill-leak-design.md §3）:
 *   formScore/pedigreeScore … 馬の全戦績から「レース日より前」の行のみ
 *   jockeyScore             … 年度別成績から「年度 < レース年」の行のみ
 *
 * 使い方:
 *   npx tsx scripts/backfill-derive.ts --dir=lib/backfill
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  calcFormScore,
  calcPedigreeScore,
  calcJockeyScore,
  resolveJockeyStats,
  type HorseScores,
  type RaceResult,
} from "../lib/scorer";
import type { DbRacePage } from "../lib/scraper";
import type { RacesCache, CachedRace, CachedHorse } from "./fetch-races";
import type { ResultsCache, RaceResultEntry } from "./fetch-results";
import type { PayoutsCache, PayoutEntry } from "./fetch-payouts";
import type { JockeyYearlyCache } from "./fetch-jockey-yearly";

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const DIR = arg("dir") ?? "lib/backfill";
const dirPath = join(process.cwd(), DIR);

function loadLocal<T>(file: string): T {
  const p = join(dirPath, file);
  if (!existsSync(p)) throw new Error(`${p} が見つかりません（先に backfill-fetch.ts を実行）`);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

function save(file: string, data: unknown) {
  writeFileSync(join(dirPath, file), JSON.stringify(data), "utf-8");
}

/** fetch-races.ts と同じ ID 採番（race_id 下8桁）。同じレースは常に同じ ID になる */
function stableRaceId(netKeibaRaceId: string): number {
  return parseInt(netKeibaRaceId.slice(4), 10);
}

type HorsesStore = { horses: Record<string, { rows: RaceResult[]; fetchedAt: string }> };

function main() {
  console.log(`=== ④ バックフィル導出 (dir=${DIR}) ===\n`);

  const racesStore = loadLocal<{ races: Record<string, DbRacePage> }>("races.json");
  const horsesStore = loadLocal<HorsesStore>("horses.json");
  const jockeyCache = JSON.parse(
    readFileSync(join(process.cwd(), "lib", "jockey-yearly-cache.json"), "utf-8")
  ) as JockeyYearlyCache;

  const pages = Object.values(racesStore.races).sort((a, b) =>
    a.date === b.date ? a.netKeibaRaceId.localeCompare(b.netKeibaRaceId) : a.date.localeCompare(b.date)
  );

  const cachedRaces: CachedRace[] = [];
  const results: RaceResultEntry[] = [];
  const payouts: PayoutEntry[] = [];
  const scores: Record<number, HorseScores> = {};
  const computedAt = new Date().toISOString();

  let skippedNoHorseData = 0;
  let debutHorses = 0;      // cutoff 後に過去走が1走も無い（新馬）→ formScore はデフォルト65
  let nullJockey = 0;
  const missingHorseIds = new Set<string>();

  for (const page of pages) {
    const rid = stableRaceId(page.netKeibaRaceId);
    const raceYear = Number(page.date.slice(0, 4));
    // 馬の戦績は "YYYY/MM/DD" 形式。レース日を同形式にしてから「厳密に前」で切る
    const cutoff = page.date.replace(/-/g, "/");

    const horses: CachedHorse[] = [];

    page.horses.forEach((h, i) => {
      const horseId = rid * 100 + i + 1;

      horses.push({
        id: horseId,
        raceId: rid,
        frameNumber: h.frameNumber,
        horseNumber: h.horseNumber,
        horse: h.horse,
        netKeibaHorseId: h.horseId,
        jockey: h.jockey,
        jockeyId: h.jockeyId,
        odds: h.odds,
      });

      // ── formScore / pedigreeScore: レース日より前の走りのみ ──
      const entry = horsesStore.horses[h.horseId];
      if (!entry) {
        missingHorseIds.add(h.horseId);
        skippedNoHorseData++;
        return; // スコア無し = 分析側で欠損として扱われる
      }
      // cutoff で切ったうえで **直近10走に絞る**。本番の fetchHorseResults が
      // slice(0,10) している以上、ここで全戦績を渡すと pedigreeScore の母集団が
      // 本番と変わってしまう（リーク除去とは別の特徴量定義の変更になる）。
      // 生データは全戦績を持ったまま、切り出しだけ本番に合わせる。
      const past = entry.rows.filter((r) => r.date < cutoff).slice(0, 10);
      if (past.length === 0) debutHorses++;

      const formScore = calcFormScore(past);
      const pedigreeScore = calcPedigreeScore(past, page.surface, page.distance);

      // ── jockeyScore: 年度 < レース年 の行のみ ──
      const jRows = h.jockeyId ? jockeyCache.jockeys[h.jockeyId]?.rows : undefined;
      const jockeyStats = jRows ? resolveJockeyStats(jRows, raceYear) : null;
      const jockeyScore = jockeyStats ? calcJockeyScore(jockeyStats) : null;
      if (jockeyScore == null) nullJockey++;

      scores[horseId] = {
        formScore,
        pedigreeScore,
        jockeyScore,
        jockeyStats,
        modelVersion: "v3",
        computedAt,
      };
    });

    cachedRaces.push({
      id: rid,
      date: page.date,
      venue: page.venue,
      raceNumber: page.raceNumber,
      raceName: page.raceName || `${page.venue}${page.raceNumber}R`,
      postTime: "",
      surface: page.surface,
      distance: page.distance,
      netKeibaRaceId: page.netKeibaRaceId,
      entriesPending: false,
      grade: null, // 出馬表ページ由来の情報。バックフィルでは取得していない
      horses,
    });

    results.push({
      raceId: rid,
      netKeibaRaceId: page.netKeibaRaceId,
      raceName: page.raceName,
      raceNumber: page.raceNumber,
      date: page.date,
      venue: page.venue,
      finishers: page.horses
        .filter((h) => h.position >= 1)
        .sort((a, b) => a.position - b.position)
        .map((h) => ({
          position: h.position,
          horseNumber: h.horseNumber,
          horse: h.horse,
          odds: h.odds,
        })),
    });

    payouts.push({
      raceId: rid,
      netKeibaRaceId: page.netKeibaRaceId,
      date: page.date,
      venue: page.venue,
      raceNumber: page.raceNumber,
      ...page.payouts,
    });
  }

  const dates = [...new Set(cachedRaces.map((r) => r.date))].sort();

  save("races-cache.json", {
    fetchedAt: computedAt,
    dates,
    latestDates: dates.slice(-2),
    races: cachedRaces,
  } satisfies RacesCache);
  save("results-cache.json", { fetchedAt: computedAt, results } satisfies ResultsCache);
  save("payouts-cache.json", { fetchedAt: computedAt, payouts } satisfies PayoutsCache);
  save("scores-cache.json", {
    fetchedAt: computedAt,
    source: "backfill (leak-free: horse results < race date, jockey year < race year)",
    scores,
  });

  // ── レポート ──────────────────────────────────────────────────────────────
  const runners = cachedRaces.reduce((s, r) => s + r.horses.length, 0);
  console.log(`レース: ${cachedRaces.length}R（${dates[0]} 〜 ${dates[dates.length - 1]}, ${dates.length}開催日）`);
  console.log(`延べ出走: ${runners}頭 / スコア算出: ${Object.keys(scores).length}頭`);
  console.log(`確定払戻あり: ${payouts.filter((p) => p.tan.length > 0).length}R`);
  console.log(`\ncutoff 適用後に過去走ゼロ（新馬等・formScore=65）: ${debutHorses}頭`);
  console.log(`jockeyScore=null（当年デビュー騎手等）: ${nullJockey}頭`);
  if (skippedNoHorseData > 0) {
    console.log(`\n⚠ 馬の戦績が未取得のためスコア無し: ${skippedNoHorseData}頭（ユニーク ${missingHorseIds.size}頭）`);
    console.log(`  backfill-fetch.ts --phase=C を再実行すると解消します`);
  }
  console.log(`\n✓ 書き出し: ${DIR}/{races,results,payouts,scores}-cache.json`);
}

main();
