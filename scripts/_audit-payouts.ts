/**
 * payouts-cache.json の健全性監査（一時スクリプト）。
 *
 * 払戻データを results-cache.json の着順と突き合わせ、パーサーが正しい馬番を
 * 拾えているかを独立系統で検証する。
 *   - 単勝の馬番   == 1着馬番
 *   - 複勝の馬番集合 == 上位3頭（少頭数なら2頭）の馬番集合
 *   - ワイドの組   == 上位3頭から作れる3ペア
 *   - 馬連の組     == {1着, 2着}
 *   - 馬単の組     == [1着, 2着]（順序込み）
 * 同着レースは組数が変わるため、件数不一致は「同着候補」として個別に出す。
 *
 *   npx tsx scripts/_audit-payouts.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PayoutsCache } from "./fetch-payouts";
import type { ResultsCache } from "./fetch-results";

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), "lib", name), "utf-8")) as T;
}

const pay = load<PayoutsCache>("payouts-cache.json");
const res = load<ResultsCache>("results-cache.json");
const byId = new Map(res.results.map((r) => [r.netKeibaRaceId, r]));

const key = (ns: number[]) => [...ns].sort((a, b) => a - b).join("-");

let checked = 0;
const issues: string[] = [];
const deadHeat: string[] = [];
const counts = { tan: 0, fuku: 0, wide: 0, umaren: 0, umatan: 0 };
const fukuDist = new Map<number, number>();
const wideDist = new Map<number, number>();
let noResult = 0;

for (const p of pay.payouts) {
  if (p.tan?.length) counts.tan++;
  if (p.fuku?.length) counts.fuku++;
  if (p.wide?.length) counts.wide++;
  if (p.umaren?.length) counts.umaren++;
  if (p.umatan?.length) counts.umatan++;
  fukuDist.set(p.fuku?.length ?? 0, (fukuDist.get(p.fuku?.length ?? 0) ?? 0) + 1);
  wideDist.set(p.wide?.length ?? 0, (wideDist.get(p.wide?.length ?? 0) ?? 0) + 1);

  const r = byId.get(p.netKeibaRaceId);
  if (!r || r.finishers.length === 0) {
    noResult++;
    continue;
  }
  checked++;
  const tag = `${p.netKeibaRaceId} ${p.date} ${p.venue}${p.raceNumber ?? "?"}R`;
  const ordered = [...r.finishers].sort((a, b) => a.position - b.position);
  const top3 = ordered.slice(0, 3).map((f) => f.horseNumber);
  const [w1, w2] = [ordered[0]?.horseNumber, ordered[1]?.horseNumber];

  // 単勝
  if (p.tan.length === 1 && p.tan[0].horse !== w1) {
    issues.push(`${tag} 単勝馬番不一致: 払戻=${p.tan[0].horse} 着順=${w1}`);
  } else if (p.tan.length > 1) {
    deadHeat.push(`${tag} 単勝${p.tan.length}件（1着同着）`);
  }

  // 複勝: 3件なら上位3頭と一致するはず
  if (p.fuku.length === 3) {
    const got = key(p.fuku.map((f) => f.horse));
    if (got !== key(top3)) issues.push(`${tag} 複勝馬番不一致: 払戻=${got} 着順=${key(top3)}`);
  } else {
    deadHeat.push(`${tag} 複勝${p.fuku.length}件`);
  }

  // ワイド: 3件なら上位3頭の3ペアと一致するはず
  if (p.wide.length === 3) {
    const pairs = new Set<string>();
    for (let i = 0; i < top3.length; i++)
      for (let j = i + 1; j < top3.length; j++) pairs.add(key([top3[i], top3[j]]));
    const got = p.wide.map((w) => key(w.combo)).sort().join(" ");
    const exp = Array.from(pairs).sort().join(" ");
    if (got !== exp) issues.push(`${tag} ワイド組不一致: 払戻=${got} 着順=${exp}`);
  } else {
    deadHeat.push(`${tag} ワイド${p.wide.length}件`);
  }

  // 馬連 / 馬単
  if (p.umaren.length === 1 && key(p.umaren[0].combo) !== key([w1, w2])) {
    issues.push(`${tag} 馬連組不一致: 払戻=${key(p.umaren[0].combo)} 着順=${key([w1, w2])}`);
  }
  if (p.umatan.length === 1) {
    const got = p.umatan[0].combo.join("→");
    if (got !== `${w1}→${w2}`) issues.push(`${tag} 馬単組不一致: 払戻=${got} 着順=${w1}→${w2}`);
  }

  // 払戻額の常識チェック（複勝100円未満・ワイドが複勝より安い等は異常）
  for (const f of p.fuku) if (f.payout < 100) issues.push(`${tag} 複勝払戻が100円未満: ${f.payout}`);
  for (const w of p.wide) if (w.payout < 100) issues.push(`${tag} ワイド払戻が100円未満: ${w.payout}`);
}

console.log(`=== payouts-cache 監査 ===`);
console.log(`総レース数: ${pay.payouts.length}  / 着順突合できた: ${checked}  (結果なし: ${noResult})`);
console.log(`\n券種別カバレッジ（1件以上ある レース数）:`);
for (const [k, v] of Object.entries(counts)) {
  console.log(`  ${k.padEnd(7)} ${v} / ${pay.payouts.length}  (${((v / pay.payouts.length) * 100).toFixed(1)}%)`);
}
console.log(`\n複勝の点数分布: ${Array.from(fukuDist).sort().map(([k, v]) => `${k}点=${v}R`).join("  ")}`);
console.log(`ワイドの点数分布: ${Array.from(wideDist).sort().map(([k, v]) => `${k}点=${v}R`).join("  ")}`);

console.log(`\n着順と食い違う異常: ${issues.length} 件`);
for (const s of issues.slice(0, 20)) console.log(`  ! ${s}`);
if (issues.length > 20) console.log(`  ... 他 ${issues.length - 20} 件`);

console.log(`\n点数が標準と異なるレース（同着など要確認）: ${deadHeat.length} 件`);
for (const s of deadHeat.slice(0, 15)) console.log(`  - ${s}`);
if (deadHeat.length > 15) console.log(`  ... 他 ${deadHeat.length - 15} 件`);
