/**
 * 一時分析: 芝×複勝がダート×複勝よりROIが良い理由を構造面から確認する(v2データ)。
 * AUCの差(-0.024 vs -0.022)ではほぼ説明がつかないため、選定馬のオッズ分布・edge分布・
 * オッズ帯別の複勝率/勝率倍率が芝/ダートで違うかを見る。
 *
 * 実行: npx tsx scripts/_analyze-turf-dirt-structure.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRaces, EV_MIN, type RaceCand, type Candidate } from "./sim-thresholds";
import type { RacesCache } from "./fetch-races";
import type { PayoutsCache, PayoutEntry } from "./fetch-payouts";

const EDGE_MIN = 0.02;
const ODDS_MAX = 50;
const buckets: [number, number][] = [[1, 3], [3, 6], [6, 10], [10, 20], [20, 50], [50, 9999]];

function loadJSON<T>(filename: string): T {
  const p = join(process.cwd(), "lib", filename);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

type M = { race: RaceCand; payout: PayoutEntry; surface: "芝" | "ダ" };

const all = buildRaces().filter((r) => r.modelVersion === "v2");
const payoutById = new Map(loadJSON<PayoutsCache>("payouts-cache.json").payouts.map((p) => [p.netKeibaRaceId, p]));
const metaById = new Map(loadJSON<RacesCache>("races-cache.json").races.map((r) => [r.netKeibaRaceId, r]));

const matched: M[] = [];
for (const race of all) {
  const payout = payoutById.get(race.netKeibaRaceId);
  const meta = metaById.get(race.netKeibaRaceId);
  if (!payout || !meta) continue;
  if (meta.surface !== "芝" && meta.surface !== "ダ") continue;
  matched.push({ race, payout, surface: meta.surface });
}

function analyzeSurface(surface: "芝" | "ダ") {
  const races = matched.filter((m) => m.surface === surface);
  console.log(`\n${"=".repeat(70)}\n${surface} (${races.length}R)\n${"=".repeat(70)}`);

  // ① 選定馬の的中率・払戻構造・edge分布
  let pickedCount = 0, pickedOddsSum = 0, pickedEdgeSum = 0;
  let tanHits = 0, tanReturnSum = 0;
  let fukuHits = 0, fukuReturnSum = 0, fukuEligible = 0;
  const pickedEdges: number[] = [];

  for (const m of races) {
    const picked = m.race.horses.filter((h) => h.ev > EV_MIN && h.edge > EDGE_MIN && h.odds <= ODDS_MAX);
    for (const h of picked) {
      pickedCount++;
      pickedOddsSum += h.odds;
      pickedEdgeSum += h.edge;
      pickedEdges.push(h.edge);
      const tp = m.payout.tan.find((t) => t.horse === h.horseNumber);
      if (tp) { tanHits++; tanReturnSum += tp.payout / 100; }
      if (m.payout.fuku.length > 0) {
        fukuEligible++;
        const fp = m.payout.fuku.find((f) => f.horse === h.horseNumber);
        if (fp) { fukuHits++; fukuReturnSum += fp.payout / 100; }
      }
    }
  }
  pickedEdges.sort((a, b) => a - b);
  const median = pickedEdges.length > 0 ? pickedEdges[Math.floor(pickedEdges.length / 2)] : NaN;

  console.log("--- ① 選定馬(EDGE_MIN=0.02, ODDS_MAX=50) ---");
  console.log(
    `選定点数: ${pickedCount}  平均オッズ: ${(pickedOddsSum / pickedCount).toFixed(2)}倍  ` +
    `平均edge: ${(pickedEdgeSum / pickedCount).toFixed(4)}  中央値edge: ${median.toFixed(4)}`
  );
  console.log(
    `単勝: 的中${tanHits}/${pickedCount} (${((tanHits / pickedCount) * 100).toFixed(1)}%)  ROI=${(((tanReturnSum - pickedCount) / pickedCount) * 100).toFixed(1)}%`
  );
  console.log(
    `複勝: 的中${fukuHits}/${fukuEligible} (${((fukuHits / fukuEligible) * 100).toFixed(1)}%)  ROI=${(((fukuReturnSum - fukuEligible) / fukuEligible) * 100).toFixed(1)}%`
  );

  // ② 選定なしベースライン
  let allCount = 0;
  let baseTanHits = 0, baseTanReturnSum = 0;
  let baseFukuHits = 0, baseFukuReturnSum = 0, baseFukuEligible = 0;
  for (const m of races) {
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
  console.log("\n--- ② ベースライン(選定なし・全馬1点) ---");
  console.log(
    `単勝ROI=${(((baseTanReturnSum - allCount) / allCount) * 100).toFixed(1)}%  ` +
    `複勝ROI=${(((baseFukuReturnSum - baseFukuEligible) / baseFukuEligible) * 100).toFixed(1)}%`
  );

  // ③ オッズ帯別 勝率 vs 複勝率(全馬)
  console.log("\n--- ③ オッズ帯別 勝率 vs 複勝率(全馬・選定なし) ---");
  console.log("オッズ帯      |  頭数 |  勝率 | 複勝率 | 複勝/勝率倍率");
  console.log("-".repeat(70));
  for (const [lo, hi] of buckets) {
    let n = 0, win = 0, place = 0, placeEligible = 0;
    for (const m of races) {
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

  // ④ 選定馬のオッズ帯分布
  console.log("\n--- ④ 選定馬のオッズ帯分布 ---");
  console.log("オッズ帯      | 全馬構成比 | 選定馬構成比");
  console.log("-".repeat(50));
  for (const [lo, hi] of buckets) {
    let nAll = 0, nPicked = 0;
    for (const m of races) {
      const picked = m.race.horses.filter((h) => h.ev > EV_MIN && h.edge > EDGE_MIN && h.odds <= ODDS_MAX);
      for (const h of m.race.horses) if (h.odds >= lo && h.odds < hi) nAll++;
      for (const h of picked) if (h.odds >= lo && h.odds < hi) nPicked++;
    }
    console.log(
      `${String(lo).padStart(3)}-${String(hi).padEnd(4)}倍 | ${((nAll / allCount) * 100).toFixed(1).padStart(8)}% | ${(pickedCount > 0 ? (nPicked / pickedCount) * 100 : 0).toFixed(1).padStart(8)}%`
    );
  }

  // ⑤ 選定率(全馬に対して何%が選定されるか)
  console.log(`\n--- ⑤ 選定率 ---`);
  console.log(`全馬${allCount}頭中 ${pickedCount}頭が選定 (${((pickedCount / allCount) * 100).toFixed(1)}%)`);
}

analyzeSurface("芝");
analyzeSurface("ダ");
