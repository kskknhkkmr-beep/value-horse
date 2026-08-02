/**
 * 一時プローブ: 騎手成績ページの年度別テーブル構造と、
 * 「そのレース時点で確定していた年度別成績」を取れるかを確認する。
 *
 * 実行: npx tsx scripts/_probe-jockey-yearly.ts
 */
import { writeFileSync } from "node:fs";

const SP = process.env.SCRATCHPAD ?? ".";

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

async function fetchEuc(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("euc-jp").decode(buf);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const jockeyId = "01091"; // 丹内
  const url = `https://db.netkeiba.com/jockey/result/${jockeyId}/`;
  console.log(`fetching ${url}`);
  const html = await fetchEuc(url);
  writeFileSync(`${SP}/jockey_result.html`, html, "utf-8");
  console.log(`saved html: ${html.length} bytes`);

  // 年度別テーブルの行を列ごとにダンプ
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  let printed = 0;
  while ((m = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(m[1])) !== null) cells.push(stripTags(cm[1]));
    if (cells.length < 6) continue;
    if (!/^(累計|\d{4})$/.test(cells[0])) continue;
    console.log(`[${cells[0]}] cols=${cells.length} :: ${cells.slice(0, 8).join(" | ")}`);
    printed++;
    if (printed > 15) break;
  }

  // 年度指定URLが存在するか確認
  await sleep(1500);
  const yearUrl = `https://db.netkeiba.com/jockey/result/${jockeyId}/2025/`;
  console.log(`\nfetching ${yearUrl}`);
  try {
    const yhtml = await fetchEuc(yearUrl);
    console.log(`year-specific page: ${yhtml.length} bytes`);
    writeFileSync(`${SP}/jockey_result_2025.html`, yhtml, "utf-8");
    // 月別・レース別の行があるか
    const hasMonth = /月/.test(yhtml);
    console.log(`contains 月: ${hasMonth}`);
  } catch (e) {
    console.log(`year-specific page failed: ${(e as Error).message}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
