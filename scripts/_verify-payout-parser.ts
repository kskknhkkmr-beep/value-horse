/**
 * 拡張した払戻パーサーを実レース2件で検証する一時スクリプト。
 * 期待値は scripts/_probe-payout-html.ts で目視確認した生HTMLに基づく。
 *
 *   npx tsx scripts/_verify-payout-parser.ts
 */

import { fetchRacePayouts } from "../lib/scraper";

type Expected = {
  id: string;
  tan: Array<[number, number]>;
  fuku: Array<[number, number]>;
  wide: Array<[number[], number]>;
  umaren: Array<[number[], number]>;
  umatan: Array<[number[], number]>;
};

const CASES: Expected[] = [
  {
    // 2026-06-20 阪神 / 枠連あり・フルセット
    id: "202609030501",
    tan: [[8, 390]],
    fuku: [[8, 140], [4, 110], [7, 140]],
    wide: [[[4, 8], 240], [[7, 8], 360], [[4, 7], 260]],
    umaren: [[[4, 8], 650]],
    umatan: [[[8, 4], 1320]],
  },
  {
    // 2026-07-25 札幌 / 枠連なし・前回取得が空だったレース
    id: "202601010101",
    tan: [[7, 380]],
    fuku: [[7, 120], [5, 110], [3, 110]],
    wide: [[[5, 7], 250], [[3, 7], 210], [[3, 5], 230]],
    umaren: [[[5, 7], 520]],
    umatan: [[[7, 5], 1140]],
  },
];

let ng = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`    ✓ ${label}`);
  } else {
    ng++;
    console.log(`    ✗ ${label}\n        期待: ${e}\n        実際: ${a}`);
  }
}

async function main() {
  for (const c of CASES) {
    console.log(`\n=== ${c.id} ===`);
    const p = await fetchRacePayouts(c.id);
    check("単勝", p.tan, c.tan.map(([horse, payout]) => ({ horse, payout })));
    check("複勝", p.fuku, c.fuku.map(([horse, payout]) => ({ horse, payout })));
    check("ワイド", p.wide, c.wide.map(([combo, payout]) => ({ combo, payout })));
    check("馬連", p.umaren, c.umaren.map(([combo, payout]) => ({ combo, payout })));
    check("馬単", p.umatan, c.umatan.map(([combo, payout]) => ({ combo, payout })));
  }
  console.log(ng === 0 ? "\n✓ 全項目一致" : `\n✗ ${ng} 項目が不一致`);
  process.exit(ng === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
