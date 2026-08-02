/**
 * ③ 勝てる戦場の特定: v2データを対象に、クラス/距離/馬場/頭数の軸でAUC・ROIを分解する。
 *
 * - 対象: buildRaces() で modelVersion="v2" かつ payouts-cache に確定払戻があるレース。
 *   障害レース(芝/ダート軸に馴染まない)は全体から除外。
 * - AUC: 各レースの全出走馬(選定フィルタ前)を対象に、モデル確率(probability)と
 *   市場確率(marketProb, オーバーラウンド除去済み)それぞれで「実際の勝ち馬のスコアが
 *   負け馬のスコアより高い確率」をペア単位で集計するプールドAUC(Mann-Whitney型)。
 *   複数レースにまたがる場合は勝ち馬×負け馬の全ペアをレース横断でプールする。
 * - ROI: sim-thresholds.ts と同じ選定基準(EV_MIN=0.10, EDGE_MIN=0.02, ODDS_MAX=50)で
 *   単勝・複勝を評価(②で確認済みの基準閾値をそのまま流用)。
 * - レース単位ブートストラップ(既定2000回)で両指標の95%CIを算出。
 *   AUCはセグメントのレース数、ROIは的中件数が20未満なら候補から除外し参考値として記録。
 *
 * クラス区分: raceName の文字列から新馬/未勝利/1勝クラス/2勝以上クラス(2勝・3勝クラス)を判定し、
 * それ以外(重賞・OP・条件特別など、命名だけでは級を判別できないもの)は「特別・OP・重賞」に一括。
 * 距離区分: 短距離<=1400m, マイル1401-1800m, 中距離1801-2200m, 長距離>2200m。
 * 頭数区分: 少頭数<=12頭, 多頭数>=13頭(中央値付近で概ね均等に分割)。
 *
 * 実行: npx tsx scripts/sim-thresholds-segments.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildRaces, EV_MIN, type RaceCand, type Candidate } from "./sim-thresholds";
import type { RacesCache, CachedRace } from "./fetch-races";
import type { PayoutsCache, PayoutEntry } from "./fetch-payouts";

const TARGET_VERSION = "v2" as const;
const EDGE_MIN = 0.02;
const ODDS_MAX = 50;
const MIN_N = 20; // AUC=レース数, ROI=的中件数 がこれ未満なら参考値
const BOOTSTRAP_ITERS = 2000;
const BOOTSTRAP_SEED = 20260802;

function loadJSON<T>(filename: string): T {
  const p = join(process.cwd(), "lib", filename);
  if (!existsSync(p)) throw new Error(`${filename} が見つかりません`);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

// ── セグメント分類 ──────────────────────────────────────────────────────
type RaceClass = "新馬" | "未勝利" | "1勝クラス" | "2勝以上クラス" | "特別・OP・重賞";
type DistanceBucket = "短距離(~1400)" | "マイル(1401~1800)" | "中距離(1801~2200)" | "長距離(2201~)";
type HeadcountBucket = "少頭数(~12)" | "多頭数(13~)";

function classifyRaceClass(raceName: string): RaceClass {
  if (raceName.includes("新馬")) return "新馬";
  if (raceName.includes("未勝利")) return "未勝利";
  if (raceName.includes("1勝クラス")) return "1勝クラス";
  if (raceName.includes("2勝クラス") || raceName.includes("3勝クラス")) return "2勝以上クラス";
  return "特別・OP・重賞";
}

function classifyDistance(distance: number): DistanceBucket {
  if (distance <= 1400) return "短距離(~1400)";
  if (distance <= 1800) return "マイル(1401~1800)";
  if (distance <= 2200) return "中距離(1801~2200)";
  return "長距離(2201~)";
}

function classifyHeadcount(n: number): HeadcountBucket {
  return n <= 12 ? "少頭数(~12)" : "多頭数(13~)";
}

type MatchedRace = {
  race: RaceCand;
  payout: PayoutEntry;
  meta: CachedRace;
  raceClass: RaceClass;
  distanceBucket: DistanceBucket;
  headcountBucket: HeadcountBucket;
  surface: "芝" | "ダ";
};

function buildMatchedRaces(): MatchedRace[] {
  const all = buildRaces().filter((r) => r.modelVersion === TARGET_VERSION);
  const payouts = loadJSON<PayoutsCache>("payouts-cache.json").payouts;
  const payoutById = new Map(payouts.map((p) => [p.netKeibaRaceId, p]));
  const racesMeta = loadJSON<RacesCache>("races-cache.json").races;
  const metaById = new Map(racesMeta.map((r) => [r.netKeibaRaceId, r]));

  const matched: MatchedRace[] = [];
  for (const race of all) {
    const payout = payoutById.get(race.netKeibaRaceId);
    const meta = metaById.get(race.netKeibaRaceId);
    if (!payout || !meta) continue;
    if (meta.surface !== "芝" && meta.surface !== "ダ") continue; // 障害を除外
    matched.push({
      race,
      payout,
      meta,
      raceClass: classifyRaceClass(meta.raceName),
      distanceBucket: classifyDistance(meta.distance),
      headcountBucket: classifyHeadcount(meta.horses.length),
      surface: meta.surface,
    });
  }
  return matched;
}

// ── AUC: レースごとの (勝ち馬concordant数, tie数, ペア総数) を集計 ────────────
type AucRaceStat = { concordant: number; tie: number; total: number };

function aucStatsForRace(horses: Candidate[], scoreOf: (h: Candidate) => number): AucRaceStat {
  const winners = horses.filter((h) => h.hit);
  const losers = horses.filter((h) => !h.hit);
  let concordant = 0;
  let tie = 0;
  let total = 0;
  for (const w of winners) {
    const ws = scoreOf(w);
    for (const l of losers) {
      const ls = scoreOf(l);
      total++;
      if (ws > ls) concordant++;
      else if (ws === ls) tie++;
    }
  }
  return { concordant, tie, total };
}

function pooledAuc(stats: AucRaceStat[]): number {
  let concordant = 0, tie = 0, total = 0;
  for (const s of stats) {
    concordant += s.concordant;
    tie += s.tie;
    total += s.total;
  }
  return total > 0 ? (concordant + 0.5 * tie) / total : NaN;
}

// ── ROI: sim-thresholds標準閾値での単勝/複勝寄与 ───────────────────────────
type BetType = "tan" | "fuku";
type RaceContribution = { invested: number; returned: number; hits: number };

function contributionFor(m: MatchedRace, betType: BetType): RaceContribution {
  const picked = m.race.horses.filter((h) => h.ev > EV_MIN && h.edge > EDGE_MIN && h.odds <= ODDS_MAX);
  if (picked.length === 0) return { invested: 0, returned: 0, hits: 0 };
  let invested = 0, returned = 0, hits = 0;
  if (betType === "tan") {
    for (const h of picked) {
      invested += 1;
      const p = m.payout.tan.find((t) => t.horse === h.horseNumber);
      if (p) { returned += p.payout / 100; hits += 1; }
    }
  } else {
    if (m.payout.fuku.length === 0) return { invested: 0, returned: 0, hits: 0 };
    for (const h of picked) {
      invested += 1;
      const p = m.payout.fuku.find((f) => f.horse === h.horseNumber);
      if (p) { returned += p.payout / 100; hits += 1; }
    }
  }
  return { invested, returned, hits };
}

// ── レース単位ブートストラップ(共通PRNG) ────────────────────────────────
function mulberry32(seed: number) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bootstrapCI<T>(
  items: T[],
  iterations: number,
  seed: number,
  statFn: (sample: T[]) => number
): { lo: number; hi: number } {
  const n = items.length;
  if (n === 0) return { lo: NaN, hi: NaN };
  const rand = mulberry32(seed);
  const values: number[] = new Array(iterations);
  const sampleBuf: T[] = new Array(n);
  for (let b = 0; b < iterations; b++) {
    for (let i = 0; i < n; i++) sampleBuf[i] = items[(rand() * n) | 0];
    values[b] = statFn(sampleBuf);
  }
  values.sort((a, b) => a - b);
  const loIdx = Math.floor(iterations * 0.025);
  const hiIdx = Math.min(Math.ceil(iterations * 0.975) - 1, iterations - 1);
  return { lo: values[loIdx], hi: values[hiIdx] };
}

function fmtPct(n: number): string {
  if (Number.isNaN(n)) return "n/a";
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}
function fmtAuc(n: number): string {
  return Number.isNaN(n) ? "n/a" : n.toFixed(3);
}

type SegmentResult = {
  label: string;
  raceCount: number;
  aucModel: number;
  aucModelCI: { lo: number; hi: number };
  aucMarket: number;
  aucMarketCI: { lo: number; hi: number };
  aucIsCandidate: boolean;
  tanRoi: number; tanRoiCI: { lo: number; hi: number }; tanHits: number; tanCandidate: boolean;
  fukuRoi: number; fukuRoiCI: { lo: number; hi: number }; fukuHits: number; fukuCandidate: boolean;
};

function evaluateSegment(label: string, races: MatchedRace[]): SegmentResult {
  const modelStats = races.map((m) => aucStatsForRace(m.race.horses, (h) => h.modelProb));
  const marketStats = races.map((m) => aucStatsForRace(m.race.horses, (h) => h.marketProb));

  const aucModel = pooledAuc(modelStats);
  const aucMarket = pooledAuc(marketStats);
  const aucModelCI = bootstrapCI(modelStats, BOOTSTRAP_ITERS, BOOTSTRAP_SEED, pooledAuc);
  const aucMarketCI = bootstrapCI(marketStats, BOOTSTRAP_ITERS, BOOTSTRAP_SEED + 1, pooledAuc);

  const tanContribs = races.map((m) => contributionFor(m, "tan"));
  const fukuContribs = races.map((m) => contributionFor(m, "fuku"));

  const roiOf = (arr: RaceContribution[]) => {
    const inv = arr.reduce((s, c) => s + c.invested, 0);
    const ret = arr.reduce((s, c) => s + c.returned, 0);
    return inv > 0 ? ((ret - inv) / inv) * 100 : NaN;
  };
  const roiCIOf = (arr: RaceContribution[], seed: number) =>
    bootstrapCI(arr, BOOTSTRAP_ITERS, seed, (sample) => {
      const inv = sample.reduce((s, c) => s + c.invested, 0);
      const ret = sample.reduce((s, c) => s + c.returned, 0);
      return inv > 0 ? ((ret - inv) / inv) * 100 : 0;
    });

  const tanHits = tanContribs.reduce((s, c) => s + c.hits, 0);
  const fukuHits = fukuContribs.reduce((s, c) => s + c.hits, 0);

  return {
    label,
    raceCount: races.length,
    aucModel,
    aucModelCI,
    aucMarket,
    aucMarketCI,
    aucIsCandidate: races.length >= MIN_N,
    tanRoi: roiOf(tanContribs),
    tanRoiCI: roiCIOf(tanContribs, BOOTSTRAP_SEED + 2),
    tanHits,
    tanCandidate: tanHits >= MIN_N,
    fukuRoi: roiOf(fukuContribs),
    fukuRoiCI: roiCIOf(fukuContribs, BOOTSTRAP_SEED + 3),
    fukuHits,
    fukuCandidate: fukuHits >= MIN_N,
  };
}

function printSegmentTable(title: string, results: SegmentResult[]) {
  console.log(`\n--- ${title} ---`);
  console.log(
    "セグメント              |  R数 | AUC(model)          | AUC(market)          | 差分   | 単勝ROI(的中)              | 複勝ROI(的中)"
  );
  console.log("-".repeat(150));
  for (const r of results) {
    const gap = r.aucModel - r.aucMarket;
    const aucFlag = r.aucIsCandidate ? "" : "*";
    const tanFlag = r.tanCandidate ? "" : "*";
    const fukuFlag = r.fukuCandidate ? "" : "*";
    console.log(
      `${r.label.padEnd(22)} | ${String(r.raceCount).padStart(4)} | ` +
      `${fmtAuc(r.aucModel)} [${fmtAuc(r.aucModelCI.lo)},${fmtAuc(r.aucModelCI.hi)}]${aucFlag} | ` +
      `${fmtAuc(r.aucMarket)} [${fmtAuc(r.aucMarketCI.lo)},${fmtAuc(r.aucMarketCI.hi)}] | ` +
      `${(gap >= 0 ? "+" : "") + gap.toFixed(3)} | ` +
      `${fmtPct(r.tanRoi).padStart(7)} [${fmtPct(r.tanRoiCI.lo)},${fmtPct(r.tanRoiCI.hi)}](${r.tanHits})${tanFlag} | ` +
      `${fmtPct(r.fukuRoi).padStart(7)} [${fmtPct(r.fukuRoiCI.lo)},${fmtPct(r.fukuRoiCI.hi)}](${r.fukuHits})${fukuFlag}`
    );
  }
  console.log("(* = 参考値。AUCはレース数20未満、ROIは的中件数20未満)");
}

function main() {
  const matched = buildMatchedRaces();
  console.log(`=== ③ 勝てる戦場の特定 (version=${TARGET_VERSION}) ===`);
  console.log(`対象: ${matched.length}R (障害除く, payouts-cache一致)`);
  console.log(`ROI選定基準: EV_MIN=${EV_MIN}, EDGE_MIN=${EDGE_MIN}, ODDS_MAX=${ODDS_MAX}（②検証と同一）`);
  console.log(`ブートストラップ: レース単位リサンプル${BOOTSTRAP_ITERS}回, 95%CI\n`);

  const overall = evaluateSegment("全体", matched);
  printSegmentTable("全体(基準)", [overall]);

  const classOrder: RaceClass[] = ["新馬", "未勝利", "1勝クラス", "2勝以上クラス", "特別・OP・重賞"];
  const classResults = classOrder
    .map((c) => ({ c, races: matched.filter((m) => m.raceClass === c) }))
    .filter((x) => x.races.length > 0)
    .map((x) => evaluateSegment(x.c, x.races));
  printSegmentTable("① クラス別", classResults);

  const distOrder: DistanceBucket[] = ["短距離(~1400)", "マイル(1401~1800)", "中距離(1801~2200)", "長距離(2201~)"];
  const distResults = distOrder
    .map((d) => matched.filter((m) => m.distanceBucket === d))
    .filter((races) => races.length > 0)
    .map((races) => evaluateSegment(races[0].distanceBucket, races));
  printSegmentTable("② 距離別", distResults);

  const surfaceResults = (["芝", "ダ"] as const)
    .map((s) => matched.filter((m) => m.surface === s))
    .filter((races) => races.length > 0)
    .map((races) => evaluateSegment(races[0].surface, races));
  printSegmentTable("③ 馬場別", surfaceResults);

  const hcOrder: HeadcountBucket[] = ["少頭数(~12)", "多頭数(13~)"];
  const hcResults = hcOrder
    .map((h) => matched.filter((m) => m.headcountBucket === h))
    .filter((races) => races.length > 0)
    .map((races) => evaluateSegment(races[0].headcountBucket, races));
  printSegmentTable("④ 頭数別", hcResults);

  // ── 追加: 芝 × 距離帯 クロス集計 ──
  const turf = matched.filter((m) => m.surface === "芝");
  const turfDistResults = distOrder
    .map((d) => turf.filter((m) => m.distanceBucket === d))
    .filter((races) => races.length > 0)
    .map((races) => evaluateSegment(races[0].distanceBucket, races));
  printSegmentTable("⑤ 芝 × 距離帯 クロス集計", turfDistResults);

  // ── 芝×短距離・マイル(~1800m)を合算して検出力を上げた場合 ──
  const turfUpTo1800 = turf.filter(
    (m) => m.distanceBucket === "短距離(~1400)" || m.distanceBucket === "マイル(1401~1800)"
  );
  const turfUpTo1800Result = evaluateSegment("芝×~1800m(合算)", turfUpTo1800);
  printSegmentTable("⑥ 芝×~1800m(短距離+マイル合算)", [turfUpTo1800Result]);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  main();
}
