/**
 * netkeiba db のレース結果ページから払戻テーブル部分の生HTMLを吐き出して
 * 複勝・ワイドのマークアップを目視確認するための一時プローブ。
 *
 *   npx tsx scripts/_probe-payout-html.ts <netKeibaRaceId> [...]
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const PC_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ja,en-US;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
};

async function fetchEuc(url: string): Promise<{ status: number; html: string }> {
  const res = await fetch(url, { headers: PC_HEADERS });
  const buf = await res.arrayBuffer();
  const latin = new TextDecoder("latin1").decode(buf.slice(0, 1000));
  const enc = latin.toLowerCase().includes("euc") ? "euc-jp" : "utf-8";
  return { status: res.status, html: new TextDecoder(enc).decode(buf) };
}

async function main() {
  const ids = process.argv.slice(2);
  for (const id of ids) {
    const url = `https://db.netkeiba.com/race/${id}/`;
    const { status, html } = await fetchEuc(url);
    console.log(`\n===== ${id} (HTTP ${status}, ${html.length} bytes) =====`);

    const tables = html.match(/<table[^>]*class="pay_table_\d+"[\s\S]*?<\/table>/gi);
    if (!tables) {
      console.log("!! pay_table が見つからない");
      console.log("title:", (html.match(/<title>([\s\S]*?)<\/title>/i) ?? [])[1]?.trim());
      writeFileSync(join(process.cwd(), "scripts", "_cache", `_payhtml_${id}.html`), html, "utf-8");
      console.log(`   全HTMLを scripts/_cache/_payhtml_${id}.html に保存`);
      continue;
    }
    for (const t of tables) {
      console.log("---- table ----");
      console.log(t.replace(/\n\s*/g, "\n").trim());
    }
    // th の class 一覧
    const ths = Array.from(html.matchAll(/<th[^>]*class="([a-z_0-9]+)"[^>]*>([\s\S]*?)<\/th>/gi))
      .map((m) => `${m[1]}=${m[2].replace(/<[^>]*>/g, "").trim()}`);
    console.log("th classes:", Array.from(new Set(ths)).join(" | "));
    await new Promise((r) => setTimeout(r, 1500));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
