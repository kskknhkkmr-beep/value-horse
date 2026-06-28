/**
 * races-cache.json の本日レースの単勝オッズを更新する。
 * fetch-all より軽量で、発走前の直前オッズ取得（GitHub Actions）に使用する。
 *
 * 使い方:
 *   npm run fetch-odds
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchWinOdds } from "../lib/scraper";
import type { RacesCache } from "./fetch-races";

function jstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

async function main() {
  console.log("=== VALUE HORSE odds updater ===");

  const cachePath = join(process.cwd(), "lib", "races-cache.json");
  if (!existsSync(cachePath)) {
    console.log("races-cache.json が見つかりません。先に fetch-races を実行してください。");
    process.exit(0);
  }

  const cache = JSON.parse(readFileSync(cachePath, "utf-8")) as RacesCache;
  const now = jstNow();
  const today = now.toISOString().slice(0, 10);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();

  // 本日で発走 10 分以内（未発走 or 直前）のレースを対象にする
  const targets = cache.races.filter((r) => {
    if (r.date !== today) return false;
    if (!r.postTime) return true;
    const [h, m] = r.postTime.split(":").map(Number);
    return nowMin < h * 60 + m + 10;
  });

  const jstHH = String(now.getUTCHours()).padStart(2, "0");
  const jstMM = String(now.getUTCMinutes()).padStart(2, "0");
  console.log(`対象日: ${today} (JST) / 現在 ${jstHH}:${jstMM} JST`);
  console.log(`更新対象: ${targets.length} / ${cache.races.length} レース`);

  if (targets.length === 0) {
    console.log("本日の対象レースなし — 終了");
    return;
  }

  let totalUpdated = 0;
  for (const race of targets) {
    process.stdout.write(
      `  [${String(race.id).padStart(2)}] ${race.raceName} (${race.venue} ${race.postTime}) ... `
    );
    const oddsMap = await fetchWinOdds(race.netKeibaRaceId);
    if (oddsMap.size === 0) {
      console.log("オッズ未公開");
      continue;
    }
    let changed = 0;
    for (const h of race.horses) {
      const newOdds = oddsMap.get(h.horseNumber) ?? null;
      if (newOdds !== h.odds) {
        h.odds = newOdds;
        changed++;
      }
    }
    totalUpdated += changed;
    console.log(`✓ (${oddsMap.size}頭, 変更 ${changed}件)`);
  }

  cache.fetchedAt = new Date().toISOString();
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
  console.log(`\n✓ 完了: オッズ変更 ${totalUpdated}件`);
}

main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
