import type { RaceResult, JockeyStats } from "./scorer";

// ── 会場コード → 会場名 ───────────────────────────────────────────────────────
export const VENUE_MAP: Record<string, string> = {
  "01": "札幌", "02": "函館", "03": "福島", "04": "新潟", "05": "東京",
  "06": "中山", "07": "中京", "08": "京都", "09": "阪神", "10": "小倉",
};

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

// ─── 週末レース一覧取得 ───────────────────────────────────────────────────────

/** 指定日（YYYYMMDD）の race_id 一覧を返す */
export async function fetchRaceIdsByDate(yyyymmdd: string): Promise<string[]> {
  await sleep(1000);
  const url = `https://race.sp.netkeiba.com/top/race_list.html?kaisai_date=${yyyymmdd}`;
  try {
    const html = await fetchUtf8(url);
    const ids = new Set<string>();
    for (const m of html.matchAll(/race_id=(\d{12})/g)) {
      ids.add(m[1]);
    }
    return [...ids].sort();
  } catch (e) {
    console.warn(`  [scraper] fetchRaceIdsByDate failed (${yyyymmdd}):`, (e as Error).message);
    return [];
  }
}

// ─── 出馬表フル取得 ───────────────────────────────────────────────────────────

export type RaceEntryHorse = {
  frameNumber: number;
  horseNumber: number;
  horse: string;
  netKeibaHorseId: string;
  jockey: string;
  odds: number | null;
};

export type RaceEntryInfo = {
  raceName: string;
  postTime: string | null;
  surface: "芝" | "ダ" | "障";
  distance: number;
  venue: string;
  raceNumber: number;
  netKeibaRaceId: string;
  horses: RaceEntryHorse[];
};

/**
 * SP 出馬表ページから馬エントリーとレース情報を取得する。
 * 出馬表未発表など取得できない場合は null を返す。
 */
export async function fetchRaceEntry(netKeibaRaceId: string): Promise<RaceEntryInfo | null> {
  await sleep(800);
  const url = `https://race.sp.netkeiba.com/race/shutuba.html?race_id=${netKeibaRaceId}`;
  try {
    const html = await fetchUtf8(url);

    // race_id から venue / raceNumber を導出
    const venueCode = netKeibaRaceId.substring(4, 6);
    const raceNumber = parseInt(netKeibaRaceId.substring(10, 12), 10);
    const venue = VENUE_MAP[venueCode] ?? `会場${venueCode}`;

    // レース名（複数パターンで試行）
    let raceName = "";
    const raceNameCandidates = [
      html.match(/<h1[^>]*class="[^"]*RaceName[^"]*"[^>]*>([^<]+)<\/h1>/i),
      html.match(/<div[^>]*class="[^"]*RaceName[^"]*"[^>]*>([^<]+)<\/div>/i),
      html.match(/<span[^>]*class="[^"]*RaceName[^"]*"[^>]*>([^<]+)<\/span>/i),
      html.match(/<title>([^|<\n]+)/),
    ];
    for (const m of raceNameCandidates) {
      const v = m?.[1]?.trim().replace(/\s+/g, "");
      if (v && v.length > 0 && v.length < 40) { raceName = v; break; }
    }

    // 発走時刻
    const timeM = html.match(/(\d{2}:\d{2})発走/);
    const postTime = timeM ? timeM[1] : null;

    // 芝 / ダ / 距離
    let surface: "芝" | "ダ" | "障" = "芝";
    let distance = 0;
    const courseM = html.match(/([芝ダ障])(\d{3,4})m/);
    if (courseM) {
      surface = courseM[1] === "芝" ? "芝" : courseM[1] === "障" ? "障" : "ダ";
      distance = parseInt(courseM[2], 10);
    }

    // 馬エントリー: id="db_XXX" パターンで馬名・馬 ID を順番に取得
    const matches = [...html.matchAll(/id="db_(\d+)"[^>]*><span>([^の]+)のデータベース<\/span>/g)];
    if (matches.length === 0) return null; // 出馬表未発表

    const frameNums = calcFrameNumbers(matches.length);

    const horses: RaceEntryHorse[] = matches.map((m, idx) => {
      const horseId = m[1];
      const horseName = m[2].trim();
      const pos = m.index ?? 0;
      const nextPos = matches[idx + 1]?.index ?? html.length;
      // 前後の文脈（騎手・オッズ探索用）
      const segment = html.substring(Math.max(0, pos - 300), nextPos);

      // 騎手: /jockey/ href 付きリンクのテキスト
      let jockey = "";
      const jockeyM = segment.match(/href="[^"]*\/jockey\/[^"]*"[^>]*>([^<]{2,8})<\/a>/) ??
        segment.match(/class="[^"]*Jockey[^"]*"[^>]*>(?:<[^>]+>)*([^<]{2,8})/);
      if (jockeyM) jockey = stripTags(jockeyM[1]).trim();

      // オッズ: Odds 系クラスまたは数値パターン
      let odds: number | null = null;
      const oddsM = segment.match(/class="[^"]*Odds[^"]*"[^>]*>\s*<[^>]+>\s*([\d.]+)/) ??
        segment.match(/class="[^"]*Odds[^"]*"[^>]*>([\d.]+)/) ??
        segment.match(/class="[^"]*OddsPoint[^"]*"[^>]*>([\d.]+)/);
      if (oddsM) {
        const v = parseFloat(oddsM[1]);
        if (!isNaN(v) && v >= 1.0 && v <= 9999) odds = v;
      }

      return {
        frameNumber: frameNums[idx],
        horseNumber: idx + 1,
        horse: horseName,
        netKeibaHorseId: horseId,
        jockey,
        odds,
      };
    });

    return { raceName, postTime, surface, distance, venue, raceNumber, netKeibaRaceId, horses };
  } catch (e) {
    console.warn(`  [scraper] fetchRaceEntry failed (${netKeibaRaceId}):`, (e as Error).message);
    return null;
  }
}

/** JRA 標準枠番割り当て（n 頭 → 各馬の枠番配列） */
function calcFrameNumbers(n: number): number[] {
  if (n <= 8) return Array.from({ length: n }, (_, i) => i + 1);

  // 各枠の頭数: まず全枠1頭、余りを外枠(8→1)から順に加算
  const counts = new Array(8).fill(1);
  let extra = n - 8;
  let f = 7;
  while (extra > 0) {
    counts[f]++;
    f = f === 0 ? 7 : f - 1;
    extra--;
  }

  // 枠番配列生成（馬番順に枠番を割り当て）
  const result: number[] = [];
  for (let frame = 0; frame < 8; frame++) {
    for (let j = 0; j < counts[frame]; j++) result.push(frame + 1);
  }
  return result.slice(0, n);
}
