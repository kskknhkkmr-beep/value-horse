/**
 * 調査2の実証: 候補特徴量に本当に予測力があるかを実データで検証する。
 *
 * サンプルレースの出走馬について db.netkeiba の過去成績を取得し、
 * 「対象レース日より前」の情報だけから候補特徴量を作って単変量AUCを測る。
 * （リーク防止: 対象レース当日以降の行は必ず除外）
 *
 * 出力は scratchpad の JSON に保存し、別スクリプトで分析する。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RacesCache } from "./fetch-races";
import type { ResultsCache } from "./fetch-results";

const SP = "scripts/_cache";
const TARGET_RACES = 45; // スクレイピング時間とサンプル数のバランス

function loadJSON<T>(f: string): T | null {
  const p = join(process.cwd(), "lib", f);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}
const racesCache = loadJSON<RacesCache>("races-cache.json")!;
const resultsCache = loadJSON<ResultsCache>("results-cache.json")!;

const PC_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ja,en-US;q=0.9",
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function fetchEuc(url: string): Promise<string> {
  const res = await fetch(url, { headers: PC_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const latin = new TextDecoder("latin1").decode(buf.slice(0, 1000));
  const enc = latin.toLowerCase().includes("euc") ? "euc-jp" : "utf-8";
  return new TextDecoder(enc).decode(buf);
}

/** 過去成績1行 */
type PastRow = {
  date: string; // YYYY/MM/DD
  fieldSize: number; position: number;
  odds: number | null; popularity: number | null;
  jockey: string; weightCarried: number | null;
  track: string; // 馬場 良/稍/重/不良
  margin: number | null; // 着差
  corner: string; // 通過
  last3f: number | null; // 上り
  bodyWeight: number | null; bodyWeightDiff: number | null;
  raceName: string; surface: string; distance: number;
};

function parsePast(html: string): PastRow[] {
  const rows: PastRow[] = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => strip(x[1]));
    if (tds.length < 29) continue;
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(tds[0])) continue;
    const num = (s: string) => { const v = parseFloat((s || "").replace(/[^\d.\-]/g, "")); return isNaN(v) ? null : v; };
    const cm = (tds[14] || "").match(/^([芝ダ障])(\d+)/);
    const bw = (tds[28] || "").match(/^(\d+)\(([-+]?\d+)\)/);
    rows.push({
      date: tds[0],
      fieldSize: num(tds[6]) ?? 0,
      position: num(tds[11]) ?? 0,
      odds: num(tds[9]),
      popularity: num(tds[10]),
      jockey: tds[12] || "",
      weightCarried: num(tds[13]),
      track: tds[16] || "",
      margin: num(tds[19]),
      corner: tds[25] || "",
      last3f: num(tds[27]),
      bodyWeight: bw ? parseInt(bw[1], 10) : null,
      bodyWeightDiff: bw ? parseInt(bw[2], 10) : null,
      raceName: tds[4] || "",
      surface: cm ? cm[1] : "",
      distance: cm ? parseInt(cm[2], 10) : 0,
    });
  }
  return rows;
}

type Sample = {
  netId: string; date: string; horseId: string; horseName: string;
  odds: number; won: boolean;
  surface: string; distance: number;
  past: PastRow[];
};

async function main() {
  // 対象レース選定: races-cache にあり結果もあるレースから新しい順
  const candidates = racesCache.races
    .filter((r) => !r.entriesPending && r.horses.length > 0)
    .map((r) => ({ r, res: resultsCache.results.find((x) => x.netKeibaRaceId === r.netKeibaRaceId) }))
    .filter((x): x is { r: typeof x.r; res: NonNullable<typeof x.res> } => !!x.res && x.res.finishers.length > 0)
    .sort((a, b) => b.r.date.localeCompare(a.r.date))
    .slice(0, TARGET_RACES);

  console.log(`対象レース: ${candidates.length}`);
  const totalHorses = candidates.reduce((s, c) => s + c.r.horses.filter((h) => h.netKeibaHorseId).length, 0);
  console.log(`取得対象馬: ${totalHorses} 頭（推定所要 ${Math.round((totalHorses * 1.3) / 60)} 分）\n`);

  const samples: Sample[] = [];
  let done = 0;
  for (const { r, res } of candidates) {
    const winner = res.finishers.find((f) => f.position === 1);
    const oddsMap = new Map<string, number>();
    for (const f of res.finishers) if (f.odds != null && f.odds > 0) oddsMap.set(f.horse, f.odds);

    for (const h of r.horses) {
      if (!h.netKeibaHorseId) continue;
      const odds = h.odds ?? oddsMap.get(h.horse) ?? null;
      if (odds == null || odds <= 0) continue;
      await sleep(1300);
      let past: PastRow[] = [];
      try {
        past = parsePast(await fetchEuc(`https://db.netkeiba.com/horse/result/${h.netKeibaHorseId}/`));
      } catch (e) {
        console.log(`  ! ${h.horse} 取得失敗: ${(e as Error).message}`);
      }
      // リーク防止: 対象レース日以降を除外
      const cutoff = r.date.replace(/-/g, "/");
      past = past.filter((p) => p.date < cutoff);

      samples.push({
        netId: r.netKeibaRaceId, date: r.date,
        horseId: h.netKeibaHorseId, horseName: h.horse,
        odds,
        won: winner != null && (winner.horse === h.horse || winner.horseNumber === h.horseNumber),
        surface: r.surface, distance: r.distance,
        past,
      });
      done++;
      if (done % 25 === 0) {
        console.log(`  ${done}/${totalHorses} 完了`);
        writeFileSync(`${SP}/newfeat_samples.json`, JSON.stringify(samples), "utf-8");
      }
    }
  }
  writeFileSync(`${SP}/newfeat_samples.json`, JSON.stringify(samples), "utf-8");
  console.log(`\n✓ 完了: ${samples.length} 頭 → ${SP}/newfeat_samples.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
