/**
 * netkeiba SP から週末の出馬表を取得して lib/races-cache.json に書き出す。
 *
 * 使い方:
 *   npm run fetch-races              # 次の土日を自動検出
 *   npm run fetch-races 20260620     # 日付指定（YYYYMMDD）
 *   npm run fetch-races 20260620 20260621
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchRaceIdsByDate, fetchRaceEntry } from "../lib/scraper";

// ── 型定義 ────────────────────────────────────────────────────────────────────

export type CachedHorse = {
  id: number;
  raceId: number;
  frameNumber: number;
  horseNumber: number;
  horse: string;
  netKeibaHorseId: string;
  jockey: string;
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
  dates: string[];
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

// ── メイン ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dates = args.length > 0 ? args : thisWeekend();

  console.log("=== VALUE HORSE race fetcher ===");
  console.log(`対象日: ${dates.map(toISODate).join(", ")}`);

  const races: CachedRace[] = [];

  for (const yyyymmdd of dates) {
    const isoDate = toISODate(yyyymmdd);
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

      const raceSeq = races.length + 1;
      const race: CachedRace = {
        id: raceSeq,
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
          id: raceSeq * 1000 + (i + 1),
          raceId: raceSeq,
          frameNumber: h.frameNumber,
          horseNumber: h.horseNumber,
          horse: h.horse,
          netKeibaHorseId: h.netKeibaHorseId,
          jockey: h.jockey,
          odds: h.odds,
        })),
      };

      const status = info.entriesPending ? "エントリー未発表" : `${race.horses.length}頭`;
      console.log(
        ` ✓ ${race.raceName} ${info.surface || "?"}${info.distance || "?"}m ` +
        `${status} ${info.postTime ?? "時刻不明"}`
      );
      races.push(race);
    }
  }

  // 日付 → 発走時刻でソートして ID を振り直し
  races.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const va = a.venue; const vb = b.venue;
    if (va !== vb) return va.localeCompare(vb);
    return a.raceNumber - b.raceNumber;
  });
  races.forEach((r, i) => {
    r.id = i + 1;
    r.horses.forEach((h, j) => {
      h.id = (i + 1) * 1000 + j + 1;
      h.raceId = i + 1;
    });
  });

  const output: RacesCache = {
    fetchedAt: new Date().toISOString(),
    dates,
    races,
  };

  const outPath = join(process.cwd(), "lib", "races-cache.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

  const totalHorses = races.reduce((s, r) => s + r.horses.length, 0);
  console.log(`\n✓ 書き出し完了: ${outPath}`);
  console.log(`  レース数: ${races.length}　馬数: ${totalHorses}`);
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
