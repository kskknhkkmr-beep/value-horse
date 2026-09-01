/**
 * 一時分析: 芝×マイル(1401~1800m)単勝ROI(+11.0%/v3, +17.1%/v2)が
 *   1) 上位1〜2点の高配当的中に依存した見せかけでないか
 *   2) v2/v3が実質同じ選定馬・同じ的中を見ているだけで独立確認になっていないか
 * を確認する。lib/backfill(6ヶ月・8,683頭)対象。
 *
 * 実行: npx tsx scripts/_analyze-turf-mile-tan.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildRaces, EV_MIN } from "./sim-thresholds";
import type { RacesCache, CachedRace } from "./fetch-races";
import type { PayoutsCache } from "./fetch-payouts";
import type { ModelVersion } from "@/lib/scorer";

const CACHE_DIR = "lib/backfill";
const EDGE_MIN = 0.02;
const ODDS_MAX = 50;

function loadJSON<T>(filename: string): T {
  const p = join(process.cwd(), CACHE_DIR, filename);
  if (!existsSync(p)) throw new Error(`${filename} が見つかりません`);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

type Bet = {
  raceId: string;
  horseNumber: number;
  odds: number;
  hit: boolean;
  returnMul: number; // 1点=1単位に対する払戻倍率(的中時 payout/100、非的中0)
};

function collectBets(scoresFile: string, version: ModelVersion): Bet[] {
  const racesMeta = loadJSON<RacesCache>("races-cache.json").races;
  const metaById = new Map(racesMeta.map((r: CachedRace) => [r.netKeibaRaceId, r]));
  const payouts = loadJSON<PayoutsCache>("payouts-cache.json").payouts;
  const payoutById = new Map(payouts.map((p) => [p.netKeibaRaceId, p]));

  const all = buildRaces({ dir: CACHE_DIR, scoresFile }).filter((r) => r.modelVersion === version);

  const bets: Bet[] = [];
  for (const race of all) {
    const meta = metaById.get(race.netKeibaRaceId);
    const payout = payoutById.get(race.netKeibaRaceId);
    if (!meta || !payout) continue;
    if (meta.surface !== "芝") continue;
    if (meta.distance < 1401 || meta.distance > 1800) continue;

    const picked = race.horses.filter((h) => h.ev > EV_MIN && h.edge > EDGE_MIN && h.odds <= ODDS_MAX);
    for (const h of picked) {
      const p = payout.tan.find((t) => t.horse === h.horseNumber);
      bets.push({
        raceId: race.netKeibaRaceId,
        horseNumber: h.horseNumber,
        odds: h.odds,
        hit: !!p,
        returnMul: p ? p.payout / 100 : 0,
      });
    }
  }
  return bets;
}

function roiOf(bets: Bet[]): { roi: number; n: number; hits: number; invested: number; returned: number } {
  const invested = bets.length;
  const returned = bets.reduce((s, b) => s + b.returnMul, 0);
  const hits = bets.filter((b) => b.hit).length;
  return { roi: invested > 0 ? ((returned - invested) / invested) * 100 : NaN, n: invested, hits, invested, returned };
}

function key(b: Bet): string {
  return `${b.raceId}#${b.horseNumber}`;
}

function main() {
  console.log("=== 芝×マイル(1401~1800m) 単勝: 高配当依存 & v2/v3独立性チェック ===\n");
  console.log(`選定基準: EV_MIN=${EV_MIN}, EDGE_MIN=${EDGE_MIN}, ODDS_MAX=${ODDS_MAX}\n`);

  const v3Bets = collectBets("scores-cache.json", "v3");
  const v2Bets = collectBets("scores-cache-v2.json", "v2");

  for (const [label, bets] of [
    ["v3(リーク除去)", v3Bets],
    ["v2(リークあり再現)", v2Bets],
  ] as const) {
    console.log(`--- ${label} ---`);
    const base = roiOf(bets);
    console.log(`全体: 点数=${base.n} 的中=${base.hits} ROI=${base.roi.toFixed(1)}% (投資${base.invested}/回収${base.returned.toFixed(1)})`);

    const hitsSorted = bets.filter((b) => b.hit).sort((a, b) => b.returnMul - a.returnMul);
    console.log(`的中一覧(払戻倍率降順、上位10件まで表示):`);
    for (const h of hitsSorted.slice(0, 10)) {
      console.log(`  ${h.raceId} 馬番${h.horseNumber} オッズ${h.odds.toFixed(1)}倍 払戻倍率${h.returnMul.toFixed(2)}`);
    }

    for (const topK of [1, 2, 3]) {
      if (hitsSorted.length < topK) continue;
      const dropIds = new Set(hitsSorted.slice(0, topK).map(key));
      const remaining = bets.filter((b) => !dropIds.has(key(b)));
      const r = roiOf(remaining);
      console.log(
        `上位${topK}件除外後: 点数=${r.n} 的中=${r.hits} ROI=${r.roi.toFixed(1)}% (投資${r.invested}/回収${r.returned.toFixed(1)})`
      );
    }
    console.log();
  }

  // ── v2/v3 独立性チェック ──────────────────────────────────────────
  console.log("--- v2 / v3 選定馬・的中の重複チェック ---");
  const v3Keys = new Set(v3Bets.map(key));
  const v2Keys = new Set(v2Bets.map(key));
  const unionKeys = new Set([...v3Keys, ...v2Keys]);
  const interKeys = new Set([...v3Keys].filter((k) => v2Keys.has(k)));
  console.log(
    `選定馬(レース×馬番): v3=${v3Keys.size}点 v2=${v2Keys.size}点 ` +
    `共通=${interKeys.size}点 和集合=${unionKeys.size}点 ` +
    `Jaccard=${((interKeys.size / unionKeys.size) * 100).toFixed(1)}%`
  );
  console.log(
    `v3のみ(v2では非選定)=${[...v3Keys].filter((k) => !v2Keys.has(k)).length}点 / ` +
    `v2のみ(v3では非選定)=${[...v2Keys].filter((k) => !v3Keys.has(k)).length}点`
  );

  const v3HitKeys = new Set(v3Bets.filter((b) => b.hit).map(key));
  const v2HitKeys = new Set(v2Bets.filter((b) => b.hit).map(key));
  const hitUnion = new Set([...v3HitKeys, ...v2HitKeys]);
  const hitInter = new Set([...v3HitKeys].filter((k) => v2HitKeys.has(k)));
  console.log(
    `\n的中馬(レース×馬番): v3=${v3HitKeys.size}件 v2=${v2HitKeys.size}件 ` +
    `共通=${hitInter.size}件 和集合=${hitUnion.size}件 ` +
    `Jaccard=${((hitInter.size / hitUnion.size) * 100).toFixed(1)}%`
  );
  console.log(`v3のみの的中=${[...v3HitKeys].filter((k) => !v2HitKeys.has(k)).length}件`);
  console.log(`v2のみの的中=${[...v2HitKeys].filter((k) => !v3HitKeys.has(k)).length}件`);
}

main();
