/**
 * 診断専用（改善提案なし）: VALUE HORSE(モデル)は市場に対してどの場面で
 * どの方向へ誤差を出しているかを定量化する。6ヶ月バックフィル(lib/backfill,
 * v3=リーク除去)対象。ROIはPhase4まで見ない。
 *
 * Phase 1: 全レース数 / VH1位(=最終ブレンド確率最大)と市場1位(=最終オッズ最小)の一致率
 * Phase 2: disagreementレースだけを抽出し、市場1位の勝率・VH1位の勝率・差を
 *          レース単位ブートストラップ(disagreementレースを再標本化の単位とする)で算出
 * Phase 3: disagreementが人気帯/オッズ帯/頭数/芝ダート/距離/クラス(新馬・重賞等)の
 *          どこで起きているかを一覧化（勝率の良し悪しはまだ判断しない）
 * Phase 4: VH1位を単勝1万円ベットした場合のROI・円換算損益・最大ドローダウンを
 *          「全レース」「disagreementレースのみ」の2系統で算出
 *
 * 実行: npx tsx scripts/_diagnose-market-agreement.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildRaces } from "./sim-thresholds";
import type { Candidate } from "./sim-thresholds";
import type { RacesCache, CachedRace } from "./fetch-races";
import type { PayoutsCache } from "./fetch-payouts";

const CACHE_DIR = "lib/backfill";
const SCORES_FILE = "scores-cache.json"; // v3(リーク除去)
const TARGET_VERSION = "v3" as const;

function loadJSON<T>(filename: string): T {
  const p = join(process.cwd(), CACHE_DIR, filename);
  if (!existsSync(p)) throw new Error(`${filename} が見つかりません`);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

function top1By<T>(items: T[], scoreOf: (x: T) => number): T {
  return items.reduce((best, cur) => (scoreOf(cur) > scoreOf(best) ? cur : best));
}

// ── レース単位ブートストラップ(共通PRNG、既存分析スクリプトと同じ実装) ──
function mulberry32(seed: number) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentileCI(values: number[]): { lo: number; hi: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const loIdx = Math.floor(n * 0.025);
  const hiIdx = Math.min(Math.ceil(n * 0.975) - 1, n - 1);
  return { lo: sorted[loIdx], hi: sorted[hiIdx] };
}

type DisagreementRace = { netKeibaRaceId: string; marketHit: boolean; modelHit: boolean };

// ── Phase 3 セグメント分類(sim-thresholds-segments.tsと同一の区分基準) ──
type RaceClass = "新馬" | "未勝利" | "1勝クラス" | "2勝以上クラス" | "特別・OP・重賞";
function classifyRaceClass(raceName: string): RaceClass {
  if (raceName.includes("新馬")) return "新馬";
  if (raceName.includes("未勝利")) return "未勝利";
  if (raceName.includes("1勝クラス")) return "1勝クラス";
  if (raceName.includes("2勝クラス") || raceName.includes("3勝クラス")) return "2勝以上クラス";
  return "特別・OP・重賞";
}
type DistanceBucket = "短距離(~1400)" | "マイル(1401~1800)" | "中距離(1801~2200)" | "長距離(2201~)";
function classifyDistance(distance: number): DistanceBucket {
  if (distance <= 1400) return "短距離(~1400)";
  if (distance <= 1800) return "マイル(1401~1800)";
  if (distance <= 2200) return "中距離(1801~2200)";
  return "長距離(2201~)";
}
type HeadcountBucket = "少頭数(~12)" | "多頭数(13~)";
function classifyHeadcount(n: number): HeadcountBucket {
  return n <= 12 ? "少頭数(~12)" : "多頭数(13~)";
}
type OddsBucket = "~2.9" | "3~5.9" | "6~9.9" | "10~19.9" | "20~49.9" | "50~";
function classifyOdds(odds: number): OddsBucket {
  if (odds < 3) return "~2.9";
  if (odds < 6) return "3~5.9";
  if (odds < 10) return "6~9.9";
  if (odds < 20) return "10~19.9";
  if (odds < 50) return "20~49.9";
  return "50~";
}
type PopularityBucket = "2番人気" | "3~5番人気" | "6~9番人気" | "10番人気~";
function classifyPopularity(rank: number): PopularityBucket {
  if (rank === 2) return "2番人気";
  if (rank <= 5) return "3~5番人気";
  if (rank <= 9) return "6~9番人気";
  return "10番人気~";
}

type RaceRecord = {
  netKeibaRaceId: string;
  date: string;
  disagree: boolean;
  marketHit: boolean;
  modelHit: boolean;
  raceClass: RaceClass;
  distanceBucket: DistanceBucket;
  headcountBucket: HeadcountBucket;
  surface: "芝" | "ダ" | "障";
  // disagreementレースのみ意味を持つ(VHが選んだ馬の性質)
  modelPickOddsBucket?: OddsBucket;
  modelPickPopularityBucket?: PopularityBucket;
  // Phase 4用: VH1位に単勝1点賭けた場合の払戻倍率(的中時 payout/100、非的中0)
  modelPickTanReturnMul: number;
};

function main() {
  const all = buildRaces({ dir: CACHE_DIR, scoresFile: SCORES_FILE }).filter(
    (r) => r.modelVersion === TARGET_VERSION
  );
  const racesMeta = loadJSON<RacesCache>("races-cache.json").races;
  const metaById = new Map(racesMeta.map((r: CachedRace) => [r.netKeibaRaceId, r]));
  const payouts = loadJSON<PayoutsCache>("payouts-cache.json").payouts;
  const payoutById = new Map(payouts.map((p) => [p.netKeibaRaceId, p]));

  console.log("=== Phase 1: 市場との一致率(診断専用、改善提案なし) ===\n");
  console.log(`データ: lib/backfill (6ヶ月・v3=リーク除去)\n`);

  let usable = 0;
  let skippedTooFew = 0;
  let skippedNoMeta = 0;
  let agree = 0;
  let tieModel = 0; // モデル確率が2頭以上で完全同値のレース(参考記録)
  const disagreementRaces: DisagreementRace[] = [];
  const raceRecords: RaceRecord[] = [];

  for (const race of all) {
    if (race.horses.length < 2) {
      skippedTooFew++;
      continue;
    }
    const meta = metaById.get(race.netKeibaRaceId);
    if (!meta) {
      skippedNoMeta++;
      continue;
    }
    usable++;

    const modelTop = top1By(race.horses, (h: Candidate) => h.modelProb);
    const marketTop = top1By(race.horses, (h: Candidate) => h.marketProb); // = 最低オッズ

    const modelTopCount = race.horses.filter((h) => h.modelProb === modelTop.modelProb).length;
    if (modelTopCount > 1) tieModel++;

    const isDisagree = modelTop.horseNumber !== marketTop.horseNumber;

    const payout = payoutById.get(race.netKeibaRaceId);
    const tanPayout = payout?.tan.find((t) => t.horse === modelTop.horseNumber);
    const modelPickTanReturnMul = tanPayout ? tanPayout.payout / 100 : 0;

    const record: RaceRecord = {
      netKeibaRaceId: race.netKeibaRaceId,
      date: meta.date,
      disagree: isDisagree,
      marketHit: marketTop.hit,
      modelHit: modelTop.hit,
      raceClass: classifyRaceClass(meta.raceName),
      distanceBucket: classifyDistance(meta.distance),
      headcountBucket: classifyHeadcount(meta.horses.length),
      surface: meta.surface,
      modelPickTanReturnMul,
    };

    if (isDisagree) {
      // VHが選んだ馬の市場内での人気順位(オッズ昇順の何番目か)
      const sortedByOdds = [...race.horses].sort((a, b) => a.odds - b.odds);
      const rank = sortedByOdds.findIndex((h) => h.horseNumber === modelTop.horseNumber) + 1;
      record.modelPickOddsBucket = classifyOdds(modelTop.odds);
      record.modelPickPopularityBucket = classifyPopularity(rank);

      disagreementRaces.push({
        netKeibaRaceId: race.netKeibaRaceId,
        marketHit: marketTop.hit,
        modelHit: modelTop.hit,
      });
    } else {
      agree++;
    }
    raceRecords.push(record);
  }
  const disagree = disagreementRaces.length;

  console.log(`buildRaces()が返した全レース(v3): ${all.length}R`);
  console.log(`  うち出走2頭未満(1位比較不能・除外): ${skippedTooFew}R`);
  console.log(`  うちraces-cacheメタ情報無し(除外): ${skippedNoMeta}R`);
  console.log(`分析対象レース数: ${usable}R\n`);

  console.log(`VH1位 = 市場1位（一致）: ${agree}R (${((agree / usable) * 100).toFixed(1)}%)`);
  console.log(`VH1位 ≠ 市場1位（disagreement）: ${disagree}R (${((disagree / usable) * 100).toFixed(1)}%)`);
  if (tieModel > 0) {
    console.log(`\n(参考: モデル確率が複数頭で完全同値だったレース ${tieModel}R。reduce の実装上、配列の先頭側を1位として扱っている)`);
  }

  // ── Phase 2 ──────────────────────────────────────────────────────────
  console.log("\n\n=== Phase 2: disagreementレースの中身(診断専用) ===\n");
  console.log(`対象: disagreementレース ${disagree}R（Phase 1で市場1位≠VH1位だったレースのみ）\n`);

  const marketWins = disagreementRaces.filter((r) => r.marketHit).length;
  const modelWins = disagreementRaces.filter((r) => r.modelHit).length;
  const marketWinRate = (marketWins / disagree) * 100;
  const modelWinRate = (modelWins / disagree) * 100;
  const diff = modelWinRate - marketWinRate; // 正 = VHが市場より勝率が高い

  console.log(`市場1位の勝率:  ${marketWins}/${disagree} = ${marketWinRate.toFixed(1)}%`);
  console.log(`VH1位の勝率:    ${modelWins}/${disagree} = ${modelWinRate.toFixed(1)}%`);
  console.log(`差分(VH−市場):  ${diff >= 0 ? "+" : ""}${diff.toFixed(1)}pt\n`);

  // レース単位ブートストラップ: disagreementレースを再標本化の単位とする
  // （同一レース内の市場1位・VH1位は対になっているので、同じ添字で同時に再抽出する）
  const BOOTSTRAP_ITERS = 2000;
  const BOOTSTRAP_SEED = 20260902;
  const rand = mulberry32(BOOTSTRAP_SEED);
  const n = disagree;
  const marketRates: number[] = new Array(BOOTSTRAP_ITERS);
  const modelRates: number[] = new Array(BOOTSTRAP_ITERS);
  const diffs: number[] = new Array(BOOTSTRAP_ITERS);
  for (let b = 0; b < BOOTSTRAP_ITERS; b++) {
    let mWins = 0;
    let vWins = 0;
    for (let i = 0; i < n; i++) {
      const idx = (rand() * n) | 0;
      const r = disagreementRaces[idx];
      if (r.marketHit) mWins++;
      if (r.modelHit) vWins++;
    }
    const mRate = (mWins / n) * 100;
    const vRate = (vWins / n) * 100;
    marketRates[b] = mRate;
    modelRates[b] = vRate;
    diffs[b] = vRate - mRate;
  }

  const marketCI = percentileCI(marketRates);
  const modelCI = percentileCI(modelRates);
  const diffCI = percentileCI(diffs);

  console.log(`レース単位ブートストラップ(disagreementレース${n}件を再標本化単位、${BOOTSTRAP_ITERS}回、95%CI):`);
  console.log(`  市場1位勝率: ${marketWinRate.toFixed(1)}% [${marketCI.lo.toFixed(1)}%, ${marketCI.hi.toFixed(1)}%]`);
  console.log(`  VH1位勝率:   ${modelWinRate.toFixed(1)}% [${modelCI.lo.toFixed(1)}%, ${modelCI.hi.toFixed(1)}%]`);
  console.log(`  差分(VH−市場): ${diff >= 0 ? "+" : ""}${diff.toFixed(1)}pt [${diffCI.lo >= 0 ? "+" : ""}${diffCI.lo.toFixed(1)}pt, ${diffCI.hi >= 0 ? "+" : ""}${diffCI.hi.toFixed(1)}pt]`);

  const verdict =
    diffCI.hi < 0
      ? "市場が明確に優位（VHの1位評価はdisagreement時、市場の1位評価より当たらない）"
      : diffCI.lo > 0
        ? "VHが明確に優位（disagreement時、VHの1位評価は市場の1位評価より当たる）"
        : "CIが0を跨いでおり、どちらが優位とも言えない（有意差なし）";
  console.log(`\n判定: ${verdict}`);

  // ── Phase 3 ──────────────────────────────────────────────────────────
  console.log("\n\n=== Phase 3: disagreementがどこで起きているか(診断専用・良し悪しの判断はしない) ===\n");

  function disagreeRateTable<K extends string>(
    title: string,
    keyOf: (r: RaceRecord) => K,
    order?: K[]
  ) {
    const groups = new Map<K, { total: number; disagree: number }>();
    for (const r of raceRecords) {
      const k = keyOf(r);
      const g = groups.get(k) ?? { total: 0, disagree: 0 };
      g.total++;
      if (r.disagree) g.disagree++;
      groups.set(k, g);
    }
    const keys = order ?? [...groups.keys()];
    console.log(`--- ${title}（全レースに占めるdisagreement発生率） ---`);
    console.log("区分                    |  全体R |  disagreement | 発生率");
    console.log("-".repeat(64));
    for (const k of keys) {
      const g = groups.get(k);
      if (!g) continue;
      const rate = (g.disagree / g.total) * 100;
      console.log(`${String(k).padEnd(22)} | ${String(g.total).padStart(6)} | ${String(g.disagree).padStart(13)} | ${rate.toFixed(1)}%`);
    }
    console.log();
  }

  disagreeRateTable("① 芝ダート(障害含む)", (r) => r.surface, ["芝", "ダ", "障"]);
  disagreeRateTable("② 距離帯", (r) => r.distanceBucket, [
    "短距離(~1400)",
    "マイル(1401~1800)",
    "中距離(1801~2200)",
    "長距離(2201~)",
  ]);
  disagreeRateTable("③ 頭数帯", (r) => r.headcountBucket, ["少頭数(~12)", "多頭数(13~)"]);
  disagreeRateTable("④ クラス(新馬・重賞等)", (r) => r.raceClass, [
    "新馬",
    "未勝利",
    "1勝クラス",
    "2勝以上クラス",
    "特別・OP・重賞",
  ]);

  console.log(
    "(注: 「馬場状態」(良/稍重/重/不良)はこのバックフィルデータセットに含まれていないため分解不可。" +
    "上記①の芝/ダート/障害を「馬場」区分として扱った)\n"
  );

  // ── disagreementレース限定: VHが選んだ馬自体の性質分布 ──
  function distributionTable<K extends string>(
    title: string,
    keyOf: (r: RaceRecord) => K | undefined,
    order: K[]
  ) {
    const counts = new Map<K, number>();
    let total = 0;
    for (const r of raceRecords) {
      if (!r.disagree) continue;
      const k = keyOf(r);
      if (k === undefined) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      total++;
    }
    console.log(`--- ${title}（disagreementレース${total}件中の内訳。VHが市場1位の代わりに選んだ馬の性質） ---`);
    console.log("区分                    |  件数 |  構成比");
    console.log("-".repeat(48));
    for (const k of order) {
      const c = counts.get(k) ?? 0;
      console.log(`${String(k).padEnd(22)} | ${String(c).padStart(5)} | ${((c / total) * 100).toFixed(1)}%`);
    }
    console.log();
  }

  distributionTable("⑤ VHが選んだ馬の人気帯", (r) => r.modelPickPopularityBucket, [
    "2番人気",
    "3~5番人気",
    "6~9番人気",
    "10番人気~",
  ]);
  distributionTable("⑥ VHが選んだ馬のオッズ帯", (r) => r.modelPickOddsBucket, [
    "~2.9",
    "3~5.9",
    "6~9.9",
    "10~19.9",
    "20~49.9",
    "50~",
  ]);

  // ── Phase 4 ──────────────────────────────────────────────────────────
  console.log("\n\n=== Phase 4: VH1位・単勝1万円ベット時のROI・円換算・最大ドローダウン ===\n");
  console.log("(診断専用。以下の2系統のみ。他の切り口は追加しない)\n");

  const STAKE = 10_000; // 1レース1万円

  function runPseudoTrading(label: string, records: RaceRecord[]) {
    // 日付→netKeibaRaceId の順でチェックの通りに並べる(backfill-derive.tsと同じ順序基準)
    const sorted = [...records].sort((a, b) =>
      a.date === b.date ? a.netKeibaRaceId.localeCompare(b.netKeibaRaceId) : a.date.localeCompare(b.date)
    );

    const n = sorted.length;
    const totalStake = n * STAKE;
    let totalReturn = 0;
    let cumulative = 0; // 累積損益(円)
    let peak = 0;
    let peakDate = "開始前(0円)";
    let maxDrawdown = 0; // 最大下落額(円、常に0以下)
    let ddPeakDate = peakDate;
    let ddTroughDate = "";

    for (const r of sorted) {
      const ret = STAKE * r.modelPickTanReturnMul;
      totalReturn += ret;
      cumulative += ret - STAKE;
      if (cumulative > peak) {
        peak = cumulative;
        peakDate = r.date;
      }
      const drawdown = cumulative - peak;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
        ddPeakDate = peakDate;
        ddTroughDate = r.date;
      }
    }

    const totalLoss = totalStake - totalReturn; // 正 = 損失
    const roi = ((totalReturn - totalStake) / totalStake) * 100;

    console.log(`--- ${label} ---`);
    console.log(`対象レース数: ${n}R（期間: ${sorted[0]?.date ?? "-"} 〜 ${sorted[n - 1]?.date ?? "-"}）`);
    console.log(`総賭け金: ${totalStake.toLocaleString()}円`);
    console.log(`総払戻:   ${Math.round(totalReturn).toLocaleString()}円`);
    console.log(`損益:     ${Math.round(totalReturn - totalStake).toLocaleString()}円（${totalLoss > 0 ? "損失" : "利益"} ${Math.round(Math.abs(totalLoss)).toLocaleString()}円）`);
    console.log(`ROI:      ${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`);
    console.log(`最大ドローダウン: ${Math.round(maxDrawdown).toLocaleString()}円（${ddPeakDate || "-"}のピークから${ddTroughDate || "-"}にかけて）`);
    console.log();

    return { n, totalStake, totalReturn, roi, maxDrawdown };
  }

  runPseudoTrading("① 全レースでVH1位を単勝1万円ベット", raceRecords);
  runPseudoTrading("② disagreementレースのみ、VH1位を単勝1万円ベット", raceRecords.filter((r) => r.disagree));
}

main();
