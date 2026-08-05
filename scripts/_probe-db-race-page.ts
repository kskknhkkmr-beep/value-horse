/**
 * 調査: db.netkeiba.com/race/{12桁ID}/ の1ページから
 * 「馬ID・騎手ID・馬番・馬名・着順・確定単勝オッズ・レース条件・払戻」が
 * すべて取れるかを確認する（設計 docs/backfill-leak-design.md §5 の未確認事項）。
 *
 * 取れるなら、レースあたりのリクエストが 3枚(出馬表+オッズ+結果) → 1枚 に減る。
 */
import { writeFileSync } from "node:fs";

const PC_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ja,en-US;q=0.9",
};

async function fetchEuc(url: string): Promise<string> {
  const res = await fetch(url, { headers: PC_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  const latin = new TextDecoder("latin1").decode(buf.slice(0, 1000));
  const enc = latin.toLowerCase().includes("euc") ? "euc-jp" : "utf-8";
  return new TextDecoder(enc).decode(buf);
}

const RACE_ID = process.argv[2] ?? "202605020611";

async function main() {
  const url = `https://db.netkeiba.com/race/${RACE_ID}/`;
  console.log(`GET ${url}\n`);
  const html = await fetchEuc(url);
  writeFileSync("scripts/_cache/db_race_page.html", html, "utf-8");
  console.log(`HTML 長さ: ${html.length} バイト → scripts/_cache/db_race_page.html\n`);

  // ── レース見出し（条件） ──
  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, "").trim();
  console.log(`レース名: ${title}`);
  const cond = html.match(/(芝|ダート|障)\s*(左|右|直線)?\s*(\d{3,4})m/);
  console.log(`条件マッチ: ${cond ? cond[0] : "(なし)"}`);
  const dateM = html.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  console.log(`日付: ${dateM ? dateM[0] : "(なし)"}`);

  // ── ID リンクの数 ──
  const horseIds = new Set([...html.matchAll(/\/horse\/(\d{10})\//g)].map((m) => m[1]));
  const jockeyIds = new Set([...html.matchAll(/\/jockey\/(?:result\/)?(?:recent\/)?(\d{5})\//g)].map((m) => m[1]));
  console.log(`\n馬IDリンク: ${horseIds.size} 件`);
  console.log(`騎手IDリンク: ${jockeyIds.size} 件`);

  // ── 結果テーブルの1行を分解して列構成を見る ──
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  let shown = 0;
  for (const r of rows) {
    const cells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length < 10) continue;
    const plain = cells.map((c) => c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (!/^\d+$/.test(plain[0])) continue; // 着順行のみ
    const hId = r[1].match(/\/horse\/(\d{10})\//)?.[1] ?? "-";
    const jId = r[1].match(/\/jockey\/(?:result\/)?(?:recent\/)?(\d{5})\//)?.[1] ?? "-";
    console.log(`\n--- 着順行 ${shown + 1} (列数 ${cells.length}) ---`);
    console.log(`  horseId=${hId} jockeyId=${jId}`);
    plain.forEach((v, i) => console.log(`   [${i}] ${v.slice(0, 24)}`));
    if (++shown >= 2) break;
  }

  // ── 払戻テーブルの有無 ──
  console.log(`\npay_table_01 の有無: ${html.includes("pay_table_01") ? "あり" : "なし"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
