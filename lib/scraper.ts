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

// ─── 単勝オッズ取得（PC版 JSON API） ──────────────────────────────────────────

/**
 * race.netkeiba.com の単勝オッズ JSON API から「馬番 → 単勝オッズ」を返す。
 * URL: https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=XXX&type=1&action=update
 * レスポンス: { data: { odds: { "1": { "01": ["2.9","","2"], ... } } } }
 */
export async function fetchWinOdds(netKeibaRaceId: string): Promise<Map<number, number>> {
  await sleep(800);
  const url = `https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=${netKeibaRaceId}&type=1&action=update`;
  try {
    const res = await fetch(url, {
      headers: { ...PC_HEADERS, Referer: `https://race.netkeiba.com/race/shutuba.html?race_id=${netKeibaRaceId}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      status: string;
      data: { odds?: Record<string, Record<string, [string, string, string]>> } | string;
    };
    if (typeof json.data !== "object" || !json.data?.odds) return new Map();
    const winOdds = json.data.odds["1"];
    if (!winOdds) return new Map();
    const map = new Map<number, number>();
    for (const [padded, values] of Object.entries(winOdds)) {
      const horseNum = parseInt(padded, 10);
      const oddsVal = parseFloat(values[0]);
      if (!isNaN(horseNum) && !isNaN(oddsVal) && oddsVal > 0) {
        map.set(horseNum, oddsVal);
      }
    }
    return map;
  } catch (e) {
    console.warn(`  [scraper] fetchWinOdds failed (${netKeibaRaceId}):`, (e as Error).message);
    return new Map();
  }
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
 * 騎手名から netkeiba 騎手 ID を検索して返す。
 * URL: https://db.netkeiba.com/?pid=jockey_search_detail&match=1&name=[encodedName]
 * 見つからない場合は null。
 */
export async function fetchJockeyId(jockeyName: string): Promise<string | null> {
  await sleep(1000);
  // EUC-JP でエンコードが必要だが fetch 経由では難しいので、
  // 騎手一覧から名前で照合する方法を使う
  const url = `https://db.netkeiba.com/?pid=jockey_list`;
  try {
    const html = await fetchEuc(url);
    // パターン: /jockey/01088/ のような形式に続いて騎手名が現れる
    const re = /\/jockey\/(\d{5})\/"[^>]*>([^<]{2,10})<\/a>/g;
    for (const m of html.matchAll(re)) {
      if (m[2].trim() === jockeyName) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

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

// ─── 追い切り評価 → trainingScore ────────────────────────────────────────────

// S=95, A=85, B=72, C=60, D=48 に対応
const TRAINING_RANK_SCORE: Record<string, number> = {
  S: 95, "◎": 95,
  A: 85, "○": 85,
  B: 72, "△": 72,
  C: 60, "▲": 60,
  D: 48, "×": 48,
};

/**
 * SP 追い切りページから「馬名 → trainingScore (0-100)」のマップを返す。
 * URL: https://race.sp.netkeiba.com/race/oikiri.html?race_id=[raceId]
 *
 * 評価記号（Rank クラス等）が見つからない馬は null。
 */
export async function fetchTrainingScores(netKeibaRaceId: string): Promise<Map<string, number>> {
  await sleep(1000);
  const url = `https://race.sp.netkeiba.com/race/oikiri.html?race_id=${netKeibaRaceId}`;
  try {
    const html = await fetchUtf8(url);
    return parseTrainingScores(html);
  } catch (e) {
    console.warn(`  [scraper] fetchTrainingScores failed (${netKeibaRaceId}):`, (e as Error).message);
    return new Map();
  }
}

function parseTrainingScores(html: string): Map<string, number> {
  const map = new Map<string, number>();

  // 各馬ブロック: id="db_XXXXX" の周辺セグメントに評価記号がある
  const horseRe = /id="db_(\d+)"[^>]*><span>([^の]+)のデータベース<\/span>/g;
  const horseMatches = [...html.matchAll(horseRe)];

  for (let i = 0; i < horseMatches.length; i++) {
    const m = horseMatches[i];
    const horseName = m[2].trim();
    const start = m.index ?? 0;
    const end = horseMatches[i + 1]?.index ?? html.length;
    const segment = html.substring(start, end);

    // Rank クラスから評価取得
    const rankM =
      segment.match(/class="[^"]*Rank[^"]*"[^>]*>\s*([SABCD◎○△▲×])\s*</) ??
      segment.match(/>\s*([SABCD])\s*<\/[^>]+>\s*<\/[^>]*Rank/i) ??
      segment.match(/追い切り評価[^>]*>\s*([SABCD◎○△▲×])/);

    if (rankM) {
      const score = TRAINING_RANK_SCORE[rankM[1].trim()];
      if (score !== undefined) map.set(horseName, score);
    }
  }

  return map;
}

// ─── レース確定結果（着順） ───────────────────────────────────────────────────

export type RaceFinishResult = {
  position: number;
  horseNumber: number;
  horse: string;
  odds: number | null; // 確定単勝オッズ（db.netkeiba 結果ページから）
};

/**
 * db.netkeiba.com のレース結果ページから着順リストを返す。
 * URL: https://db.netkeiba.com/race/[12桁ID]/
 * テーブル列（0始まり）: 着順, 枠番, 馬番, 馬名, ...
 */
export async function fetchRaceResult(netKeibaRaceId: string): Promise<RaceFinishResult[]> {
  await sleep(1200);
  const url = `https://db.netkeiba.com/race/${netKeibaRaceId}/`;
  try {
    const html = await fetchEuc(url);
    return parseFinishOrder(html);
  } catch (e) {
    console.warn(`  [scraper] fetchRaceResult failed (${netKeibaRaceId}):`, (e as Error).message);
    return [];
  }
}

function parseFinishOrder(html: string): RaceFinishResult[] {
  const results: RaceFinishResult[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;

  while ((m = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(m[1])) !== null) {
      cells.push(stripTags(cm[1]));
    }
    if (cells.length < 4) continue;

    const pos = parseInt(cells[0], 10);
    if (isNaN(pos) || pos < 1 || pos > 18) continue;

    const horseNum = parseInt(cells[2], 10);
    if (isNaN(horseNum) || horseNum < 1 || horseNum > 18) continue;

    const horse = cells[3].trim();
    if (!horse || horse.length < 2) continue;

    // 単勝オッズ: 列 16 (標準位置)、なければ 14-18 の小数値から取得
    // col18 = 馬体重(整数)、col17 = 人気(整数)、col16 = オッズ(小数)
    let odds: number | null = null;
    const tryCol = (ci: number) => {
      if (ci >= cells.length) return;
      const raw = cells[ci];
      if (!raw.includes(".")) return; // オッズは必ず小数点あり
      const v = parseFloat(raw.replace(/[^\d.]/g, ""));
      if (!isNaN(v) && v >= 1.0 && v <= 999.9) odds = v;
    };
    tryCol(16); // 標準位置
    if (odds === null) { tryCol(15); tryCol(14); tryCol(17); }

    results.push({ position: pos, horseNumber: horseNum, horse, odds });
  }

  return results.sort((a, b) => a.position - b.position);
}

// ─── 週末レース一覧取得 ───────────────────────────────────────────────────────

/**
 * 指定日（YYYYMMDD）の race_id 一覧を返す。
 *
 * ① db.netkeiba.com/race/list/YYYYMMDD/ から 12 桁 race_id を直接抽出（過去レース）
 * ② 見つからない場合は会場コードを取得し、shutuba ページを探索して特定（未来レース）
 */
export async function fetchRaceIdsByDate(yyyymmdd: string): Promise<string[]> {
  await sleep(1000);
  const listUrl = `https://db.netkeiba.com/race/list/${yyyymmdd}/`;

  try {
    const html = await fetchEuc(listUrl);

    // ① 12 桁 race_id を直接抽出（結果確定済みレース）
    const directIds = new Set<string>();
    for (const m of html.matchAll(/\/race\/(\d{12})\//g)) directIds.add(m[1]);
    if (directIds.size > 0) return [...directIds].sort();

    // ② 会場コードを抽出 → shutuba ページ探索
    const venueCodes = new Set<string>();
    for (const m of html.matchAll(/\/race\/(?:sum|pay)\/(\d{2})\/\d{8}\//g)) {
      venueCodes.add(m[1]);
    }
    if (venueCodes.size === 0) {
      console.warn(`  [scraper] 会場コード取得失敗 (${yyyymmdd})`);
      return [];
    }

    const date = new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`);
    const isSaturday = date.getDay() === 6;
    const year = yyyymmdd.slice(0, 4);
    const month = parseInt(yyyymmdd.slice(4, 6));
    const day = parseInt(yyyymmdd.slice(6, 8));

    console.log(`  会場コード: ${[...venueCodes].map(c => `${c}(${VENUE_MAP[c] ?? c})`).join(', ')}`);

    const allIds: string[] = [];
    for (const venueCode of venueCodes) {
      const ids = await probeRaceIds(year, venueCode, month, day, isSaturday);
      allIds.push(...ids);
    }
    return allIds.sort();

  } catch (e) {
    console.warn(`  [scraper] fetchRaceIdsByDate failed (${yyyymmdd}):`, (e as Error).message);
    return [];
  }
}

/** 会場コードと日付から race_id を探索する（shutuba ページの日付で照合） */
async function probeRaceIds(
  year: string, venueCode: string, month: number, day: number, isSat: boolean
): Promise<string[]> {
  // 土曜=奇数D、日曜=偶数D（JRA 標準）
  const dCandidates = isSat ? [1, 3, 5, 7, 9] : [2, 4, 6, 8, 10];
  const datePattern = `${month}月${day}日`;
  const venue = VENUE_MAP[venueCode] ?? venueCode;

  for (let meet = 1; meet <= 4; meet++) {
    for (const d of dCandidates) {
      const probeId = `${year}${venueCode}${String(meet).padStart(2, "0")}${String(d).padStart(2, "0")}11`;
      await sleep(600);
      try {
        const html = await fetchUtf8(
          `https://race.sp.netkeiba.com/race/shutuba.html?race_id=${probeId}`
        );
        if (html.includes(datePattern)) {
          const prefix = `${year}${venueCode}${String(meet).padStart(2, "0")}${String(d).padStart(2, "0")}`;
          const ids = Array.from({ length: 12 }, (_, i) => prefix + String(i + 1).padStart(2, "0"));
          console.log(`  ${venue}: M${meet} D${d} 確認 → ${ids.length}レース`);
          return ids;
        }
      } catch {
        // 存在しない race_id は無視
      }
    }
  }
  console.warn(`  ${venue}(${venueCode}): race_id 特定失敗`);
  return [];
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
  entriesPending: boolean; // true = 出馬表未発表
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
      // class あり h1
      html.match(/<h1[^>]*class="[^"]*RaceName[^"]*"[^>]*>([^<]+)<\/h1>/i),
      // class なし h1（SP shutuba はシンプルな h1）
      html.match(/<h1[^>]*>([^<]{2,35})<\/h1>/),
      html.match(/<div[^>]*class="[^"]*RaceName[^"]*"[^>]*>([^<]+)<\/div>/i),
      // タイトルタグ（「出馬表」を除去）
      html.match(/<title>([^|<\n]+)/),
    ];
    for (const m of raceNameCandidates) {
      const v = m?.[1]?.trim()
        .replace(/出馬表.*$/, "")   // 「出馬表」以降を除去
        .replace(/\s+/g, "")
        .replace(/\|.*$/, "");     // パイプ以降を除去
      if (v && v.length >= 2 && v.length < 40) { raceName = v; break; }
    }

    // テキスト正規化ヘルパー（タグ除去 + 全角数字・ｍ・ダート正規化）
    const toPlain = (src: string) =>
      stripTags(src)
        .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/ｍ/g, "m")
        .replace(/ダート/g, "ダ");

    const headerPlain = toPlain(html);

    // 発走時刻
    const timeM = headerPlain.match(/(\d{2}:\d{2})\s*発走/) ??
                  headerPlain.match(/(\d{2}:\d{2})\s*[芝ダ障]/);
    let postTime: string | null = timeM ? timeM[1] : null;

    // コース情報パーサー（「芝2200m」「ダ 2100 m」「2200 m 芝」いずれにも対応）
    const parseCourse = (text: string) => {
      const m = text.match(/([芝ダ障])\s*(\d{3,4})\s*m/) ??
                text.match(/(\d{3,4})\s*m\s*([芝ダ障])/);
      if (!m) return null;
      const s = /^\d/.test(m[1]) ? m[2] : m[1]; // 数字先頭なら m[2] が surface
      const d = /^\d/.test(m[1]) ? m[1] : m[2];
      return {
        surface: (s === "芝" ? "芝" : s === "障" ? "障" : "ダ") as "芝" | "ダ" | "障",
        distance: parseInt(d, 10),
      };
    };

    // ① SP ページから試行
    let surface: "芝" | "ダ" | "障" = "芝";
    let distance = 0;
    const spCourse = parseCourse(headerPlain);
    if (spCourse) {
      surface = spCourse.surface;
      distance = spCourse.distance;
    } else {
      // ② SP から取れなければ PC 版 shutuba（EUC-JP）を試行
      try {
        await sleep(600);
        const pcHtml = await fetchEuc(
          `https://race.netkeiba.com/race/shutuba.html?race_id=${netKeibaRaceId}`
        );
        const pcPlain = toPlain(pcHtml);
        const pcCourse = parseCourse(pcPlain);
        if (pcCourse) {
          surface = pcCourse.surface;
          distance = pcCourse.distance;
        }
        if (!postTime) {
          const pcTime = pcPlain.match(/(\d{2}:\d{2})\s*発走/);
          if (pcTime) postTime = pcTime[1];
        }
      } catch {
        // PC 版取得失敗は無視
      }
    }

    // 馬エントリー: id="db_XXX" パターンで馬名・馬 ID を順番に取得
    const matches = [...html.matchAll(/id="db_(\d+)"[^>]*><span>([^の]+)のデータベース<\/span>/g)];

    // 出馬表未発表の場合: レースメタ情報だけ返す
    if (matches.length === 0) {
      if (!raceName && !postTime) return null; // ページ自体がないか無効
      return { raceName, postTime, surface, distance, venue, raceNumber, netKeibaRaceId, entriesPending: true, horses: [] };
    }

    const frameNums = calcFrameNumbers(matches.length);

    const horses: RaceEntryHorse[] = matches.map((m, idx) => {
      const horseId = m[1];
      const horseName = m[2].trim();
      const pos = m.index ?? 0;
      const nextPos = matches[idx + 1]?.index ?? html.length;
      const segment = html.substring(Math.max(0, pos - 300), nextPos);

      let jockey = "";
      const jockeyM = segment.match(/href="[^"]*\/jockey\/[^"]*"[^>]*>([^<]{2,8})<\/a>/) ??
        segment.match(/class="[^"]*Jockey[^"]*"[^>]*>(?:<[^>]+>)*([^<]{2,8})/);
      if (jockeyM) jockey = stripTags(jockeyM[1]).trim();

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

    return { raceName, postTime, surface, distance, venue, raceNumber, netKeibaRaceId, entriesPending: false, horses };
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
