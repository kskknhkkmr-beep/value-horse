/**
 * 一時プローブ: 騎手の年度別成績テーブルが更新停止して見える原因を切り分ける。
 * (a) CDN/HTTPキャッシュ由来か → キャッシュバスター付きで再取得して比較
 * (b) netkeiba側の集計ラグか   → 騎手個別ページの直近騎乗履歴と突き合わせ
 *
 * 実行: npx tsx scripts/_probe-jockey-staleness.ts
 */
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

async function fetchEuc(url: string, noCache = false): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      ...(noCache ? { "Cache-Control": "no-cache", Pragma: "no-cache" } : {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  console.log(`    HTTP ${res.status}  age=${res.headers.get("age") ?? "-"}  cache=${res.headers.get("x-cache") ?? "-"}  date=${res.headers.get("date") ?? "-"}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("euc-jp").decode(buf);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function yearRow(html: string, year: string): string[] | null {
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(m[1])) !== null) cells.push(stripTags(cm[1]));
    if (cells[0] === year && cells.length >= 6) return cells;
  }
  return null;
}

async function main() {
  const jockeyId = "01091";
  const base = `https://db.netkeiba.com/jockey/result/${jockeyId}/`;

  console.log("① 通常取得");
  const h1 = await fetchEuc(base);
  console.log("   2026行:", yearRow(h1, "2026")?.slice(0, 6).join(" | "));

  await sleep(1500);
  console.log("\n② キャッシュバスター + no-cache ヘッダ");
  const h2 = await fetchEuc(`${base}?_=${Date.now()}`, true);
  console.log("   2026行:", yearRow(h2, "2026")?.slice(0, 6).join(" | "));

  // 騎手トップページ(直近騎乗が載る)で最新騎乗日を確認
  await sleep(1500);
  console.log("\n③ 騎手トップページの直近騎乗日");
  const h3 = await fetchEuc(`https://db.netkeiba.com/jockey/${jockeyId}/`);
  const dates = [...h3.matchAll(/(\d{4})\/(\d{2})\/(\d{2})/g)].map((m) => m[0]);
  const uniq = [...new Set(dates)].sort().reverse().slice(0, 8);
  console.log("   ページ内の日付(新しい順):", uniq.join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); });
