/**
 * 券種変更検証(②): 単勝ベースの選定ロジック（sim-thresholds.ts の buildRaces）を
 * そのまま流用し、決済に使う払戻だけを 単勝/複勝/ワイド で切り替えて ROI を比較する。
 *
 * 選定馬（候補馬フィルタ: ev>EV_MIN && edge>edgeMin && odds<=oddsMax）は3券種で共通。
 *   - 単勝: 選定馬1頭ごとに単勝1点。
 *   - 複勝: 選定馬1頭ごとに複勝1点。
 *   - ワイド: 選定馬が同一レースでn頭選ばれた場合、その全ペア(nC2通り)を1点ずつ購入。
 *            n<=1のレースはワイド購入対象外（自然に除外）。
 * 複勝・ワイドが発売されていないレース（出走頭数が少ない等）は、その券種のみ購入対象から除外。
 *
 * 対象レースは lib/payouts-cache.json に確定払戻がある408レースのうち、
 * buildRaces() が TARGET_VERSION=v1 として復元できたものに限る（単勝・複勝・ワイドの
 * 実払戻データが揃っている範囲でのみ、3券種を公平に比較するため）。
 *
 * ROIはレース単位ブートストラップ(既定2000回)で95%信頼区間を算出する。
 * 的中(件数=勝ち馬券の本数)が20件未満の閾値組み合わせは候補から除外し、参考値として記録する。
 *
 * 実行: npx tsx scripts/sim-thresholds-place-wide.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildRaces, EV_MIN, EDGE_MINS, ODDS_MAXS, type RaceCand } from "./sim-thresholds";
import type { PayoutsCache, PayoutEntry } from "./fetch-payouts";

const TARGET_VERSION = "v1" as const;
const MIN_HITS = 20; // これ未満は候補から除外し、参考値として扱う
const BOOTSTRAP_ITERS = 2000;
const BOOTSTRAP_SEED = 20260802; // 再現性のため固定

type BetType = "tan" | "fuku" | "wide";
const BET_TYPES: BetType[] = ["tan", "fuku", "wide"];

function loadPayouts(): PayoutsCache {
  const p = join(process.cwd(), "lib", "payouts-cache.json");
  if (!existsSync(p)) throw new Error("payouts-cache.json が見つかりません");
  return JSON.parse(readFileSync(p, "utf-8")) as PayoutsCache;
}

type MatchedRace = { race: RaceCand; payout: PayoutEntry };

function buildMatchedRaces(): MatchedRace[] {
  const all = buildRaces().filter((r) => r.modelVersion === TARGET_VERSION);
  const payouts = loadPayouts().payouts;
  const payoutById = new Map(payouts.map((p) => [p.netKeibaRaceId, p]));

  const matched: MatchedRace[] = [];
  for (const race of all) {
    const payout = payoutById.get(race.netKeibaRaceId);
    if (payout) matched.push({ race, payout });
  }
  return matched;
}

// ── 1レース分の「選定馬フィルタ→券種別 賭け点数/回収」を計算 ──────────────────
type RaceContribution = { invested: number; returned: number; hits: number };

function contributionFor(
  m: MatchedRace,
  betType: BetType,
  edgeMin: number,
  oddsMax: number
): RaceContribution {
  const picked = m.race.horses.filter(
    (h) => h.ev > EV_MIN && h.edge > edgeMin && h.odds <= oddsMax
  );
  if (picked.length === 0) return { invested: 0, returned: 0, hits: 0 };

  let invested = 0;
  let returned = 0;
  let hits = 0;

  if (betType === "tan") {
    for (const h of picked) {
      invested += 1;
      const p = m.payout.tan.find((t) => t.horse === h.horseNumber);
      if (p) {
        returned += p.payout / 100;
        hits += 1;
      }
    }
  } else if (betType === "fuku") {
    if (m.payout.fuku.length === 0) return { invested: 0, returned: 0, hits: 0 }; // 複勝不発売
    for (const h of picked) {
      invested += 1;
      const p = m.payout.fuku.find((f) => f.horse === h.horseNumber);
      if (p) {
        returned += p.payout / 100;
        hits += 1;
      }
    }
  } else {
    if (m.payout.wide.length === 0) return { invested: 0, returned: 0, hits: 0 }; // ワイド不発売
    if (picked.length < 2) return { invested: 0, returned: 0, hits: 0 }; // 1頭以下はペア組めず対象外
    for (let i = 0; i < picked.length; i++) {
      for (let j = i + 1; j < picked.length; j++) {
        const a = picked[i].horseNumber;
        const b = picked[j].horseNumber;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        invested += 1;
        const p = m.payout.wide.find((w) => w.combo[0] === lo && w.combo[1] === hi);
        if (p) {
          returned += p.payout / 100;
          hits += 1;
        }
      }
    }
  }
  return { invested, returned, hits };
}

// ── レース単位ブートストラップ ──────────────────────────────────────────────
function mulberry32(seed: number) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bootstrapRoiCI(
  invested: number[],
  returned: number[],
  iterations: number,
  seed: number
): { lo: number; hi: number } {
  const n = invested.length;
  if (n === 0) return { lo: NaN, hi: NaN };
  const rand = mulberry32(seed);
  const rois: number[] = new Array(iterations);
  for (let b = 0; b < iterations; b++) {
    let inv = 0;
    let ret = 0;
    for (let i = 0; i < n; i++) {
      const idx = (rand() * n) | 0;
      inv += invested[idx];
      ret += returned[idx];
    }
    rois[b] = inv > 0 ? ((ret - inv) / inv) * 100 : 0;
  }
  rois.sort((a, b) => a - b);
  const loIdx = Math.floor(iterations * 0.025);
  const hiIdx = Math.min(Math.ceil(iterations * 0.975) - 1, iterations - 1);
  return { lo: rois[loIdx], hi: rois[hiIdx] };
}

type ComboResult = {
  betType: BetType;
  edgeMin: number;
  oddsMax: number;
  targetRaces: number;
  bets: number;
  hits: number;
  roi: number;
  ci: { lo: number; hi: number };
  isCandidate: boolean; // hits >= MIN_HITS
};

function evaluate(matched: MatchedRace[], betType: BetType, edgeMin: number, oddsMax: number): ComboResult {
  const invested: number[] = [];
  const returned: number[] = [];
  let targetRaces = 0;
  let bets = 0;
  let hits = 0;

  for (const m of matched) {
    const c = contributionFor(m, betType, edgeMin, oddsMax);
    invested.push(c.invested);
    returned.push(c.returned);
    if (c.invested > 0) targetRaces++;
    bets += c.invested;
    hits += c.hits;
  }

  const totalInvested = invested.reduce((a, b) => a + b, 0);
  const totalReturned = returned.reduce((a, b) => a + b, 0);
  const roi = totalInvested > 0 ? ((totalReturned - totalInvested) / totalInvested) * 100 : 0;
  const ci = bootstrapRoiCI(invested, returned, BOOTSTRAP_ITERS, BOOTSTRAP_SEED);

  return {
    betType,
    edgeMin,
    oddsMax,
    targetRaces,
    bets,
    hits,
    roi,
    ci,
    isCandidate: hits >= MIN_HITS,
  };
}

function fmtPct(n: number): string {
  if (Number.isNaN(n)) return "  n/a";
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}

function main() {
  const matched = buildMatchedRaces();
  console.log(`\n=== 券種別ROI検証(単勝/複勝/ワイド, 選定ロジック共通, version=${TARGET_VERSION}) ===`);
  console.log(`対象: 払戻データ確定済み ${matched.length}R（payouts-cache ∩ ${TARGET_VERSION}）`);
  console.log(`ブートストラップ: レース単位リサンプル ${BOOTSTRAP_ITERS}回, 95%CI, 的中${MIN_HITS}件未満は参考値\n`);

  const allResults: ComboResult[] = [];
  for (const betType of BET_TYPES) {
    for (const edgeMin of EDGE_MINS) {
      for (const oddsMax of ODDS_MAXS) {
        allResults.push(evaluate(matched, betType, edgeMin, oddsMax));
      }
    }
  }

  const pad = (s: string, n: number) => s.padStart(n);
  const label: Record<BetType, string> = { tan: "単勝", fuku: "複勝", wide: "ワイド" };

  for (const betType of BET_TYPES) {
    console.log(`\n--- ${label[betType]} ---`);
    console.log(
      "EDGE_MIN | ODDS_MAX |  対象R |  点数 | 的中 |    ROI |        95%CI       | 判定"
    );
    console.log("-".repeat(84));
    for (const r of allResults.filter((r) => r.betType === betType)) {
      const ciStr = Number.isNaN(r.ci.lo) ? "n/a" : `[${fmtPct(r.ci.lo)}, ${fmtPct(r.ci.hi)}]`;
      console.log(
        `${pad(r.edgeMin.toFixed(2), 8)} | ${pad(String(r.oddsMax), 8)} | ${pad(String(r.targetRaces), 5)} | ${pad(String(r.bets), 5)} | ${pad(String(r.hits), 4)} | ${pad(fmtPct(r.roi), 6)} | ${pad(ciStr, 19)} | ${r.isCandidate ? "候補" : "参考(的中不足)"}`
      );
    }
  }

  console.log(`\n--- 候補(的中${MIN_HITS}件以上)のみ: 券種横断比較 ---`);
  console.log("EDGE_MIN | ODDS_MAX | 券種   |  対象R |  点数 | 的中 |    ROI |        95%CI");
  console.log("-".repeat(84));
  for (const edgeMin of EDGE_MINS) {
    for (const oddsMax of ODDS_MAXS) {
      const rows = allResults.filter(
        (r) => r.edgeMin === edgeMin && r.oddsMax === oddsMax && r.isCandidate
      );
      if (rows.length === 0) continue;
      for (const r of rows) {
        const ciStr = Number.isNaN(r.ci.lo) ? "n/a" : `[${fmtPct(r.ci.lo)}, ${fmtPct(r.ci.hi)}]`;
        console.log(
          `${pad(r.edgeMin.toFixed(2), 8)} | ${pad(String(r.oddsMax), 8)} | ${pad(label[r.betType], 6)} | ${pad(String(r.targetRaces), 5)} | ${pad(String(r.bets), 5)} | ${pad(String(r.hits), 4)} | ${pad(fmtPct(r.roi), 6)} | ${ciStr}`
        );
      }
      console.log("-".repeat(84));
    }
  }
}

main();
