import type { RaceResult, JockeyStats } from "./scorer";

const PC_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ja,en-US;q=0.9",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
};

const SP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Accept-Language": "ja,en-US;q=0.9",
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
};

// netkeiba DB は EUC-JP
async function fetchEuc(url: string): Promise<string> {
  const res = await fetch(url, { headers: PC_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  // charset=euc-jp / charset= の両方に対応
  const latin = new TextDecoder("latin1").decode(buf.slice(0, 1000));
  const enc = latin.toLowerCase().includes("euc") ? "euc-jp" : "utf-8";
  return new TextDecoder(enc).decode(buf);
}

// SP サイトは UTF-8
async function fetchUtf8(url: string): Promise<string> {
  const res = await fetch(url, { headers: SP_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function toInt(s: string): number {
  return parseInt(s.replace(/[^\d]/g, ""), 10);
}

// ─── 出馬表から馬名→IDマップを取得 ──────────────────────────────────────────

/**
 * SP 出馬表ページから「馬名 → netkeiba 馬 ID」のマップを返す。
 * URL: https://race.sp.netkeiba.com/race/shutuba.html?race_id=[raceId]
 */
export async function fetchHorseIdMap(netKeibaRaceId: string): Promise<Map<string, string>> {
  await sleep(1200);
  const url = `https://race.sp.netkeiba.com/race/shutuba.html?race_id=${netKeibaRaceId}`;
  try {
    const html = await fetchUtf8(url);
    const map = new Map<string, string>();
    // パターン: id="db_2021105661"><span>レガーロデルシエロのデータベース</span>
    const re = /id="db_(\d+)"[^>]*><span>([^の]+)のデータベース<\/span>/g;
    for (const m of html.matchAll(re)) {
      map.set(m[2].trim(), m[1]);
    }
    return map;
  } catch (e) {
    console.warn(`  [scraper] fetchHorseIdMap failed (${netKeibaRaceId}):`, (e as Error).message);
    return new Map();
  }
}

// ─── 馬近走成績 ───────────────────────────────────────────────────────────────

/**
 * 馬の近走成績ページから RaceResult[] を返す。
 * URL: https://db.netkeiba.com/horse/result/[horseId]/
 *
 * テーブル列（EUC-JP ページ・0 始まり）:
 *   0:日付 1:開催 2:天気 3:R 4:レース名 5:映像
 *   6:頭数 7:枠番 8:馬番 9:単勝 10:人気
 *   11:着順 12:騎手 13:斤量 14:コース(芝1800/ダ1600) ...
 */
export async function fetchHorseResults(horseId: string): Promise<RaceResult[]> {
  await sleep(1200);
  const url = `https://db.netkeiba.com/horse/result/${horseId}/`;
  try {
    const html = await fetchEuc(url);
    return parseRaceResultTable(html, { fieldSizeCol: 6, positionCol: 11, courseCol: 14 });
  } catch (e) {
    console.warn(`  [scraper] fetchHorseResults failed (${horseId}):`, (e as Error).message);
    return [];
  }
}

// ─── 騎手近走成績 → JockeyStats ──────────────────────────────────────────────

// 各騎手の netkeiba 5桁 ID（JRA騎手コード）
export const JOCKEY_IDS: Record<string, string> = {
  "C.ルメール": "05339",
  "D.レーン": "05386",
  "M.ディー": "05576",
  "戸崎圭太": "01088",
  "武豊": "01019",
  "川田将雅": "01098",
  "横山武史": "01170",
  "坂井瑠星": "01167",
  "岩田望来": "01165",
  "北村友一": "01107",
  "松山弘平": "01145",
  "横山典弘": "01033",
  "西村淳也": "01148",
  "幸英明": "01073",
  "古川吉洋": "01085",
  "大野拓弥": "01074",
  "三浦皇成": "01096",
  "原優介": "01138",
  "石川裕紀人": "01115",
  "津村明秀": "01077",
  "菊沢一樹": "01106",
  "F.ゴンサルベス": "05357",
  "亀田温心": "01168",
  "丸田恭介": "01083",
};

/**
 * 騎手の近走成績（直近約100走）から勝利数・連対数・騎乗数を集計して返す。
 * URL: https://db.netkeiba.com/jockey/result/recent/[jockeyId]/
 *
 * テーブル列（EUC-JP ページ・0 始まり）:
 *   0:日付 1:開催 2:天気 3:R 4:レース名 5:映像
 *   6:頭数 7:枠番 8:馬番 9:単勝 10:人気
 *   11:着順 12:馬名 13:騎手 14:斤量 15:距離 ...
 */
export async function fetchJockeyStats(jockeyId: string): Promise<JockeyStats | null> {
  await sleep(1200);
  const url = `https://db.netkeiba.com/jockey/result/recent/${jockeyId}/`;
  try {
    const html = await fetchEuc(url);
    return parseJockeyRaceRows(html);
  } catch (e) {
    console.warn(`  [scraper] fetchJockeyStats failed (${jockeyId}):`, (e as Error).message);
    return null;
  }
}

// ─── 内部パーサー ────────────────────────────────────────────────────────────

function parseRaceResultTable(
  html: string,
  cols: { fieldSizeCol: number; positionCol: number; courseCol: number }
): RaceResult[] {
  const results: RaceResult[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;

  while ((m = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(m[1])) !== null) {
      cells.push(stripTags(cm[1]));
    }
    if (cells.length <= cols.courseCol) continue;

    // 日付で行かどうかを判定（YYYY/MM/DD 形式）
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(cells[0])) continue;

    const fieldSize = toInt(cells[cols.fieldSizeCol]);
    const pos = toInt(cells[cols.positionCol]);
    const course = cells[cols.courseCol]; // "芝1800" / "ダ1600" / "障2000"

    if (isNaN(pos) || pos <= 0 || isNaN(fieldSize) || fieldSize < 2) continue;

    const courseM = course.match(/^([芝ダ障])(\d+)/);
    if (!courseM) continue;

    const surface = (courseM[1] === "芝" ? "芝" : courseM[1] === "障" ? "障" : "ダ") as
      | "芝"
      | "ダ"
      | "障";
    const distance = toInt(courseM[2]);
    if (isNaN(distance)) continue;

    results.push({ date: cells[0], surface, distance, position: pos, fieldSize });
  }

  return results.slice(0, 10); // 直近10走まで
}

function parseJockeyRaceRows(html: string): JockeyStats | null {
  let wins = 0;
  let places = 0;
  let rides = 0;

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;

  while ((m = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(m[1])) !== null) {
      cells.push(stripTags(cm[1]));
    }
    if (cells.length < 12) continue;

    // 日付チェック
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(cells[0])) continue;

    // 列 11: 着順
    const pos = toInt(cells[11]);
    if (isNaN(pos) || pos <= 0) continue; // 中止・除外は除く

    rides++;
    if (pos === 1) wins++;
    if (pos <= 2) places++;
  }

  return rides > 0 ? { wins, rides, places } : null;
}
