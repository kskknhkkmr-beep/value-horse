/**
 * netkeiba SP から週末の出馬表を取得して lib/races-cache.json に累積追記する。
 *
 * - 既存データは netKeibaRaceId でキーを建て、upsert する
 * - race.id は netKeibaRaceId 下 8 桁を安定 ID として使用（週をまたいでも不変）
 * - latestDates: 今回取得した日付一覧（API・スコア取得のスコープ絞り込みに使用）
 * - 直近 RETENTION_MONTHS ヶ月より古いデータは自動削除
 *
 * 使い方:
 *   npm run fetch-races              # 次の土日を自動検出
 *   npm run fetch-races 20260620     # 日付指定（YYYYMMDD）
 *   npm run fetch-races 20260620 20260621
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchRaceIdsByDate, fetchRaceEntry, fetchWinOdds } from "../lib/scraper";

const RETENTION_MONTHS = 3;

// ── 型定義 ────────────────────────────────────────────────────────────────────

export type CachedHorse = {
  id: number;
  raceId: number;
  frameNumber: number;
  horseNumber: number;
  horse: string;
  netKeibaHorseId: string;
  jockey: string;
  jockeyId: string;
  odds: number | null;
};

export type CachedRace = {
  id: number;
  date: string;
  venue: string;
  raceNumber: number;
  raceName: string;
  postTime: string;
  surface: "芝" | "ダ" | "障";
  distance: number;
  netKeibaRaceId: string;
  entriesPending: boolean;
  horses: CachedHorse[];
};

export type RacesCache = {
  fetchedAt: string;
  dates: string[];        // キャッシュ内の全日付（累積）
  latestDates: string[];  // 直近に取得した日付（= 今週末）
  races: CachedRace[];
};

// ── ユーティリティ ────────────────────────────────────────────────────────────

function toISODate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** 今週末（土・日）の YYYYMMDD を返す。土日の場合は当日を含む今週末。 */
function thisWeekend(): string[] {
  const today = new Date();
  const day = today.getDay(); // 0=日, 6=土
  let sat: Date;
  if (day === 6) {
    sat = today;
  } else if (day === 0) {
    sat = new Date(today.getTime() - 86400000);
  } else {
    const d = new Date(today);
    d.setDate(d.getDate() + (6 - day));
    sat = d;
  }
  const sun = new Date(sat.getTime() + 86400000);
  return [sat, sun].map((d) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
  );
}

/**
 * netKeibaRaceId の下 8 桁を整数に変換して安定 ID を生成。
 * 例: "202610020201" → parseInt("10020201") = 10020201
 * 同じ race は常に同じ ID になるため、週をまたいでも衝突しない。
 */
function stableRaceId(netKeibaRaceId: string): number {
  return parseInt(netKeibaRaceId.slice(4), 10);
}

function retentionCutoff(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - RETENTION_MONTHS);
  return d.toISOString().slice(0, 10);
}

function loadExistingRaces(outPath: string): Map<string, CachedRace> {
  const map = new Map<string, CachedRace>();
  if (!existsSync(outPath)) return map;
  try {
    const raw = JSON.parse(readFileSync(outPath, "utf-8")) as RacesCache;
    for (const race of raw.races ?? []) {
      map.set(race.netKeibaRaceId, race);
    }
  } catch {
    // 壊れたキャッシュは無視
  }
  return map;
}

// ── メイン ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dates = args.length > 0 ? args : thisWeekend();

  console.log("=== VALUE HORSE race fetcher ===");
  console.log(`対象日: ${dates.map(toISODate).join(", ")}`);

  const outPath = join(process.cwd(), "lib", "races-cache.json");
  const raceMap = loadExistingRaces(outPath);
  console.log(`既存データ: ${raceMap.size} レース`);

  const fetchedDates: string[] = [];

  for (const yyyymmdd of dates) {
    const isoDate = toISODate(yyyymmdd);
    fetchedDates.push(isoDate);
    console.log(`\n━━ ${isoDate} ━━`);

    const raceIds = await fetchRaceIdsByDate(yyyymmdd);
    console.log(`  race_id 取得: ${raceIds.length}件`);

    for (const raceId of raceIds) {
      process.stdout.write(`  [${raceId}] ...`);
      const info = await fetchRaceEntry(raceId);

      if (!info) {
        console.log(" スキップ（ページ無効）");
        continue;
      }

      const winOddsMap = info.entriesPending ? new Map<number, number>() : await fetchWinOdds(raceId);
      const rid = stableRaceId(raceId);

      const race: CachedRace = {
        id: rid,
        date: isoDate,
        venue: info.venue,
        raceNumber: info.raceNumber,
        raceName: info.raceName || `${info.venue}${info.raceNumber}R`,
        postTime: info.postTime ?? "",
        surface: info.surface,
        distance: info.distance,
        netKeibaRaceId: raceId,
        entriesPending: info.entriesPending,
        horses: info.horses.map((h, i) => ({
          id: rid * 100 + i + 1,
          raceId: rid,
          frameNumber: h.frameNumber,
          horseNumber: h.horseNumber,
          horse: h.horse,
          netKeibaHorseId: h.netKeibaHorseId,
          jockey: h.jockey,
          jockeyId: h.jockeyId,
          odds: winOddsMap.get(h.horseNumber) ?? null,
        })),
      };

      const oddsCount = race.horses.filter((h) => h.odds !== null).length;
      const status = info.entriesPending ? "エントリー未発表" : `${race.horses.length}頭`;
      console.log(
        ` ✓ ${race.raceName} ${info.surface || "?"}${info.distance || "?"}m ` +
        `${status} ${info.postTime ?? "時刻不明"} (オッズ${oddsCount}頭)`
      );
      raceMap.set(raceId, race);
    }
  }

  // 保持期限より古いエントリを除外
  const cutoff = retentionCutoff();
  let pruned = 0;
  for (const [id, race] of raceMap) {
    if (race.date < cutoff) {
      raceMap.delete(id);
      pruned++;
    }
  }
  if (pruned > 0) console.log(`\n保持期限切れ削除: ${pruned} レース（${cutoff} より前）`);

  // date → venue → raceNumber でソート
  const merged = Array.from(raceMap.values()).sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const v = a.venue.localeCompare(b.venue);
    if (v !== 0) return v;
    return a.raceNumber - b.raceNumber;
  });

  const allDates = [...new Set(merged.map((r) => r.date))].sort();

  const output: RacesCache = {
    fetchedAt: new Date().toISOString(),
    dates: allDates,
    latestDates: fetchedDates.sort(),
    races: merged,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

  const totalHorses = merged.reduce((s, r) => s + r.horses.length, 0);
  console.log(`\n✓ 書き出し完了: ${outPath}`);
  console.log(`  累積: ${merged.length} レース / 今回取得: ${fetchedDates.join(", ")} / 馬数: ${totalHorses}`);
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
