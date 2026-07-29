/**
 * Phase 0 棚卸し: races-cache.json の git 履歴から「同一レースの時間帯別オッズ」が
 * どれだけ復元できるかを定量化する（読み取り専用・本番非改変）。
 *
 * races-cache.json は上書き方式で horse.odds は単一値のため、時系列はコミット
 * 履歴からしか復元できない。各コミットの blob を展開し、
 *   (コミット時刻UTC, netKeibaRaceId, horseNumber, odds)
 * を集めて、レースごとに「発走前の異なる時刻のスナップショットが何本あるか」を数える。
 *
 * 出力: scripts/_cache/odds_history.json（復元できた時系列そのもの）
 *       + 標準出力にサマリ
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { RacesCache } from "./fetch-races";

const SP = "scripts/_cache";

type Snapshot = { sha: string; committedAt: string; label: string };
type OddsPoint = { at: string; odds: number };
/** netKeibaRaceId -> horseNumber -> 時系列 */
type RaceSeries = {
  netKeibaRaceId: string;
  date: string;
  venue: string;
  raceNumber: number;
  postTime: string;
  postAtUTC: string;
  byHorse: Record<number, OddsPoint[]>;
};

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });
}

/** JST の date(YYYY-MM-DD) + postTime(HH:MM) を UTC の Date にする */
function postToUTC(date: string, postTime: string): Date | null {
  if (!postTime || !/^\d{1,2}:\d{2}$/.test(postTime)) return null;
  const [h, m] = postTime.split(":").map(Number);
  // JST = UTC+9
  return new Date(`${date}T00:00:00Z`).getTime() + (h * 60 + m - 9 * 60) * 60000
    ? new Date(new Date(`${date}T00:00:00Z`).getTime() + (h * 60 + m - 9 * 60) * 60000)
    : null;
}

function main() {
  const log = sh(`git log --format="%H|%aI|%s" -- lib/races-cache.json`).trim().split("\n");
  const snapshots: Snapshot[] = log.map((line) => {
    const [sha, committedAt, ...rest] = line.split("|");
    return { sha, committedAt, label: rest.join("|") };
  });
  console.log(`races-cache.json を含むコミット: ${snapshots.length} 本`);
  console.log(`  期間: ${snapshots[snapshots.length - 1]?.committedAt.slice(0, 16)} 〜 ${snapshots[0]?.committedAt.slice(0, 16)} (UTC)\n`);

  const series = new Map<string, RaceSeries>();

  for (const snap of snapshots) {
    let cache: RacesCache;
    try {
      cache = JSON.parse(sh(`git show ${snap.sha}:lib/races-cache.json`)) as RacesCache;
    } catch {
      console.log(`  ! ${snap.sha.slice(0, 7)} 読み込み失敗 — スキップ`);
      continue;
    }
    for (const race of cache.races ?? []) {
      if (!race.horses?.length) continue;
      const postAt = postToUTC(race.date, race.postTime);
      if (!postAt) continue;
      // 発走後のスナップショットは「確定オッズ」であり事前情報ではないので除外
      if (new Date(snap.committedAt) > postAt) continue;

      let s = series.get(race.netKeibaRaceId);
      if (!s) {
        s = {
          netKeibaRaceId: race.netKeibaRaceId,
          date: race.date, venue: race.venue, raceNumber: race.raceNumber,
          postTime: race.postTime, postAtUTC: postAt.toISOString(),
          byHorse: {},
        };
        series.set(race.netKeibaRaceId, s);
      }
      for (const h of race.horses) {
        if (h.odds == null || h.odds <= 0) continue;
        const arr = (s.byHorse[h.horseNumber] ??= []);
        // 同一時刻の重複は入れない
        if (!arr.some((p) => p.at === snap.committedAt)) arr.push({ at: snap.committedAt, odds: h.odds });
      }
    }
  }

  // ── 集計 ──
  const all = [...series.values()];
  // 各レースの「異なる時刻のスナップショット本数」= どれかの馬が持つ最大点数
  const withCounts = all.map((s) => {
    const times = new Set<string>();
    for (const arr of Object.values(s.byHorse)) for (const p of arr) times.add(p.at);
    // オッズが実際に動いた（値が変わった）スナップショットが2本以上あるか
    let movedHorses = 0;
    for (const arr of Object.values(s.byHorse)) {
      const uniq = new Set(arr.map((p) => p.odds));
      if (uniq.size >= 2) movedHorses++;
    }
    return { s, snapshots: times.size, movedHorses, horses: Object.keys(s.byHorse).length };
  });

  const dist = new Map<number, number>();
  for (const w of withCounts) dist.set(w.snapshots, (dist.get(w.snapshots) ?? 0) + 1);

  console.log("════ 発走前スナップショット本数の分布（レース単位）════");
  for (const [n, c] of [...dist.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${n} 本: ${c} レース`);
  }
  const usable = withCounts.filter((w) => w.snapshots >= 2);
  const withMovement = withCounts.filter((w) => w.movedHorses > 0);
  console.log(`\n  発走前スナップショット ≥2本のレース: ${usable.length} / ${all.length}`);
  console.log(`  オッズが実際に変動した馬を含むレース: ${withMovement.length} / ${all.length}`);

  if (usable.length) {
    console.log("\n════ 復元できた時系列の例（最大5レース）════");
    for (const w of usable.slice(0, 5)) {
      const times = new Set<string>();
      for (const arr of Object.values(w.s.byHorse)) for (const p of arr) times.add(p.at);
      const sorted = [...times].sort();
      console.log(`  ${w.s.date} ${w.s.venue}${w.s.raceNumber}R (発走 ${w.s.postTime} JST) — ${w.snapshots}本, 変動馬${w.movedHorses}/${w.horses}頭`);
      for (const t of sorted) {
        const lead = new Date(w.s.postAtUTC).getTime() - new Date(t).getTime();
        console.log(`      ${t.slice(0, 16)}Z  (発走 ${Math.round(lead / 60000)} 分前)`);
      }
    }
  }

  const out = { probedAt: new Date().toISOString(), races: all };
  writeFileSync(`${SP}/odds_history.json`, JSON.stringify(out), "utf-8");
  console.log(`\n✓ 復元データ書き出し: ${SP}/odds_history.json (${all.length} レース)`);
}

main();
