/**
 * 一時分析: 複勝ROIが単勝ROIよりはっきり良い理由を構造面から確認する。v1/v2両方で実施。
 * - 選定馬(EDGE_MIN=0.02,ODDS_MAX=50)の的中率・払戻構造を単勝/複勝で比較
 * - 「賭け馬をモデル選定せず全馬に1点ずつ賭けた場合」のベースラインROIを
 *   単勝/複勝それぞれで算出し、選定なしでも券種間でROI水準に差があるか確認
 * - 選定馬の平均オッズが全馬平均よりロングショット寄りかどうかも確認
 *
 * 実行: npx tsx scripts/_analyze-fuku-structure.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRaces, EV_MIN, type RaceCand } from "./sim-thresholds";
import type { ModelVersion } from "@/lib/scorer";
import type { PayoutsCache, PayoutEntry } from "./fetch-payouts";

const EDGE_MIN = 0.02;
const ODDS_MAX = 50;
const buckets: [number, number][] = [[1, 3], [3, 6], [6, 10], [10, 20], [20, 50], [50, 9999]];

function loadPayouts(): PayoutsCache {
  const p = join(process.cwd(), "lib", "payouts-cache.json");
  return JSON.parse(readFileSync(p, "utf-8")) as PayoutsCache;
}

type M = { race: RaceCand; payout: PayoutEntry };

function runForVersion(version: ModelVersion, payoutById: Map<string, PayoutEntry>, allVersions: RaceCand[]) {
  const matched: M[] = [];
  for (const race of allVersions) {
    if (race.modelVersion !== version) continue;
    const payout = payoutById.get(race.netKeibaRaceId);
    if (payout) matched.push({ race, payout });
  }

  console.log(`\n${"=".repeat(78)}\nversion=${version}  対象: ${matched.length}R\n${"=".repeat(78)}`);

  // ── ① 選定馬(EDGE_MIN=0.02,ODDS_MAX=50) 単勝/複勝 の的中率・払戻構造 ──
  let pickedCount = 0;
  let pickedOddsSum = 0;
  let tanHits = 0, tanReturnSum = 0;
  let fukuHits = 0, fukuReturnSum = 0, fukuEligibleBets = 0;

  for (const m of matched) {
    const picked = m.race.horses.filter((h) => h.ev > EV_MIN && h.edge > EDGE_MIN && h.odds <= ODDS_MAX);
    for (const h of picked) {
      pickedCount++;
      pickedOddsSum += h.odds;
      const tp = m.payout.tan.find((t) => t.horse === h.horseNumber);
      if (tp) { tanHits++; tanReturnSum += tp.payout / 100; }
      if (m.payout.fuku.length > 0) {
        fukuEligibleBets++;
        const fp = m.payout.fuku.find((f) => f.horse === h.horseNumber);
        if (fp) { fukuHits++; fukuReturnSum += fp.payout / 100; }
      }
    }
  }

  console.log("--- ① 選定馬(EDGE_MIN=0.02, ODDS_MAX=50) ---");
  console.log(`選定点数: ${pickedCount}  平均オッズ: ${(pickedOddsSum / pickedCount).toFixed(2)}倍`);
  console.log(
    `単勝: 的中${tanHits}/${pickedCount} (${((tanHits / pickedCount) * 100).toFixed(1)}%)  ` +
    `的中時平均払戻倍率: ${(tanHits > 0 ? tanReturnSum / tanHits : 0).toFixed(2)}倍  ` +
    `ROI=${(((tanReturnSum - pickedCount) / pickedCount) * 100).toFixed(1)}%`
  );
  console.log(
    `複勝: 的中${fukuHits}/${fukuEligibleBets} (${((fukuHits / fukuEligibleBets) * 100).toFixed(1)}%)  ` +
    `的中時平均払戻倍率: ${(fukuHits > 0 ? fukuReturnSum / fukuHits : 0).toFixed(2)}倍  ` +
    `ROI=${(((fukuReturnSum - fukuEligibleBets) / fukuEligibleBets) * 100).toFixed(1)}%`
  );

  // ── ② 選定なし・全馬ベースライン(1点ずつ機械的に賭けた場合) ──
  let allCount = 0;
  let baseTanHits = 0, baseTanReturnSum = 0;
  let baseFukuHits = 0, baseFukuReturnSum = 0, baseFukuEligible = 0;

  for (const m of matched) {
    for (const h of m.race.horses) {
      allCount++;
      const tp = m.payout.tan.find((t) => t.horse === h.horseNumber);
      if (tp) { baseTanHits++; baseTanReturnSum += tp.payout / 100; }
      if (m.payout.fuku.length > 0) {
        baseFukuEligible++;
        const fp = m.payout.fuku.find((f) => f.horse === h.horseNumber);
        if (fp) { baseFukuHits++; baseFukuReturnSum += fp.payout / 100; }
      }
    }
  }

  console.log("\n--- ② ベースライン(モデル選定なし・全馬に機械的に1点) ---");
  console.log(`全馬点数: ${allCount}`);
  console.log(
    `単勝: 的中率${((baseTanHits / allCount) * 100).toFixed(2)}%  ` +
    `ROI=${(((baseTanReturnSum - allCount) / allCount) * 100).toFixed(1)}%`
  );
  console.log(
    `複勝: 的中率${((baseFukuHits / baseFukuEligible) * 100).toFixed(2)}%  ` +
    `ROI=${(((baseFukuReturnSum - baseFukuEligible) / baseFukuEligible) * 100).toFixed(1)}%`
  );

  // ── ③ オッズ帯別の 勝率 vs 複勝率(全馬) ──
  console.log("\n--- ③ オッズ帯別 勝率 vs 複勝率(全馬・選定なし) ---");
  console.log("オッズ帯      |  頭数 |  勝率 | 複勝率 | 複勝/勝率倍率");
  console.log("-".repeat(70));
  for (const [lo, hi] of buckets) {
    let n = 0, win = 0, place = 0, placeEligible = 0;
    for (const m of matched) {
      for (const h of m.race.horses) {
        if (h.odds < lo || h.odds >= hi) continue;
        n++;
        const tp = m.payout.tan.find((t) => t.horse === h.horseNumber);
        if (tp) win++;
        if (m.payout.fuku.length > 0) {
          placeEligible++;
          const fp = m.payout.fuku.find((f) => f.horse === h.horseNumber);
          if (fp) place++;
        }
      }
    }
    const winRate = n > 0 ? (win / n) * 100 : 0;
    const placeRate = placeEligible > 0 ? (place / placeEligible) * 100 : 0;
    const ratio = winRate > 0 ? placeRate / winRate : NaN;
    console.log(
      `${String(lo).padStart(3)}-${String(hi).padEnd(4)}倍 | ${String(n).padStart(5)} | ${winRate.toFixed(1).padStart(5)}% | ${placeRate.toFixed(1).padStart(5)}% | ${Number.isNaN(ratio) ? "n/a" : ratio.toFixed(2) + "x"}`
    );
  }

  // ── ④ 選定馬 vs 全馬 のオッズ帯分布比較 ──
  console.log("\n--- ④ 選定馬のオッズ帯分布 vs 全馬 ---");
  console.log("オッズ帯      | 全馬構成比 | 選定馬構成比");
  console.log("-".repeat(50));
  for (const [lo, hi] of buckets) {
    let nAll = 0, nPicked = 0;
    for (const m of matched) {
      const picked = m.race.horses.filter((h) => h.ev > EV_MIN && h.edge > EDGE_MIN && h.odds <= ODDS_MAX);
      for (const h of m.race.horses) if (h.odds >= lo && h.odds < hi) nAll++;
      for (const h of picked) if (h.odds >= lo && h.odds < hi) nPicked++;
    }
    console.log(
      `${String(lo).padStart(3)}-${String(hi).padEnd(4)}倍 | ${((nAll / allCount) * 100).toFixed(1).padStart(8)}% | ${(pickedCount > 0 ? (nPicked / pickedCount) * 100 : 0).toFixed(1).padStart(8)}%`
    );
  }
}

const allVersions = buildRaces();
const payoutById = new Map(loadPayouts().payouts.map((p) => [p.netKeibaRaceId, p]));

console.log(`buildRaces()全体: v1=${allVersions.filter((r) => r.modelVersion === "v1").length}R, v2=${allVersions.filter((r) => r.modelVersion === "v2").length}R`);

runForVersion("v1", payoutById, allVersions);
runForVersion("v2", payoutById, allVersions);
