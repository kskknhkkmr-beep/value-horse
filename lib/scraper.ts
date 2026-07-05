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

// ─── 騎手成績（年度別） → JockeyStats ────────────────────────────────────────

// 年度成績の騎乗数がこれ未満の場合、前年度分と合算してサンプルを確保する
const MIN_RIDES_FOR_YEAR = 30;

/**
 * 騎手の年度別成績（今年 or 直近年度、サンプル不足時は前年度と合算）から
 * 勝利数・連対数・騎乗数を集計して返す。
 * URL: https://db.netkeiba.com/jockey/result/[jockeyId]/
 *
 * テーブル列（EUC-JP ページ・0 始まり、年度別成績テーブル）:
 *   0:年度 1:順位 2:1着 3:2着 4:3着 5:着外 6-15:重賞/特別/平場/芝/ダート(出走・勝利)
 *   16:勝率 17:連対率 18:複勝率 19:収得賞金 20:代表馬
 * 先頭行は「累計」（キャリア通算）、以降は新しい年度から降順。
 */
export async function fetchJockeyStats(jockeyId: string): Promise<JockeyStats | null> {
  await sleep(1200);
  const url = `https://db.netkeiba.com/jockey/result/${jockeyId}/`;
  try {
    const html = await fetchEuc(url);
    return parseJockeyYearlyStats(html);
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

function parseJockeyYearlyStats(html: string): JockeyStats | null {
  type YearRow = { label: string; wins: number; seconds: number; thirds: number; others: number };
  const rows: YearRow[] = [];

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;

  while ((m = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(m[1])) !== null) {
      cells.push(stripTags(cm[1]));
    }
    if (cells.length < 6) continue;

    const label = cells[0];
    if (!/^(累計|\d{4})$/.test(label)) continue; // 年度行（「累計」または西暦4桁）以外は除外

    const n = (s: string) => {
      const v = toInt(s);
      return isNaN(v) ? 0 : v;
    };
    rows.push({ label, wins: n(cells[2]), seconds: n(cells[3]), thirds: n(cells[4]), others: n(cells[5]) });
  }

  if (rows.length === 0) return null;

  const toStats = (r: YearRow): JockeyStats => ({
    wins: r.wins,
    places: r.wins + r.seconds,
    rides: r.wins + r.seconds + r.thirds + r.others,
  });

  const total = rows.find((r) => r.label === "累計");
  const years = rows.filter((r) => r.label !== "累計");
  if (years.length === 0) return total ? toStats(total) : null;

  // 直近年度を優先。騎乗数が少なければ前年度分と合算してサンプルを確保する。
  let wins = years[0].wins;
  let seconds = years[0].seconds;
  let thirds = years[0].thirds;
  let others = years[0].others;
  let rides = wins + seconds + thirds + others;

  if (rides < MIN_RIDES_FOR_YEAR && years[1]) {
    wins += years[1].wins;
    seconds += years[1].seconds;
    thirds += years[1].thirds;
    others += years[1].others;
    rides = wins + seconds + thirds + others;
  }

  if (rides === 0) return total ? toStats(total) : null;
  return { wins, places: wins + seconds, rides };
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
 * SP 追い切り（調教）ページから「netkeiba 馬 ID → trainingScore (0-100)」のマップを返す。
 * URL: https://race.sp.netkeiba.com/?pid=oikiri&race_id=[raceId]
 *
 * netkeiba 記者による追い切りコメント・評価が付いた馬のみが対象（全頭ではない）。
 * 評価記号（Rank_S/A/B/C/D クラス）が見つからない馬は含まれない。
 */
export async function fetchTrainingScores(netKeibaRaceId: string): Promise<Map<string, number>> {
  await sleep(1000);
  const url = `https://race.sp.netkeiba.com/?pid=oikiri&race_id=${netKeibaRaceId}`;
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

  // 各馬ブロック: <tr class="HorseList"> から次の HorseList 行（or 末尾）まで
  const blockRe = /<tr[^>]*class="HorseList"[^>]*>([\s\S]*?)(?=<tr[^>]*class="HorseList"|$)/g;

  for (const m of html.matchAll(blockRe)) {
    const block = m[1];
    // 馬 ID: <a href="https://db.sp.netkeiba.com//horse/training/2022105291/">
    const idM = block.match(/\/horse\/training\/(\d+)\//);
    // 評価: <span class="Rank_B">B</span>
    const rankM = block.match(/class="Rank_([SABCD])"/);
    if (!idM || !rankM) continue;

    const score = TRAINING_RANK_SCORE[rankM[1]];
    if (score !== undefined) map.set(idM[1], score);
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
 * race.netkeiba.com の結果ページから着順リストを返す（当日結果はこちらが速い）。
 * db.netkeiba.com は結果反映が数時間遅れる場合がある。
 * URL: https://race.netkeiba.com/race/result.html?race_id=[12桁ID]
 */
export async function fetchRaceResult(netKeibaRaceId: string): Promise<RaceFinishResult[]> {
  await sleep(1200);
  // 1st try: race.netkeiba.com (当日反映が速い・PC UA で取得)
  try {
    const url = `https://race.netkeiba.com/race/result.html?race_id=${netKeibaRaceId}`;
    const html = await fetchEuc(url); // fetchEuc は PC UA + 自動エンコード検出
    const results = parseFinishOrderSP(html);
    if (results.length > 0) return results;
  } catch {
    // fall through to DB
  }
  // 2nd try: db.netkeiba.com (過去データの保険)
  try {
    const url = `https://db.netkeiba.com/race/${netKeibaRaceId}/`;
    const html = await fetchEuc(url);
    return parseFinishOrder(html);
  } catch (e) {
    console.warn(`  [scraper] fetchRaceResult failed (${netKeibaRaceId}):`, (e as Error).message);
    return [];
  }
}

/**
 * race.netkeiba.com/race/result.html の HTML をパース。
 * 構造: <tr class="HorseList"> 内に
 *   .Result_Num > .Rank   → 着順
 *   .Num.Txt_C > div       → 馬番（2列目の Num）
 *   .HorseNameSpan         → 馬名
 *   .Odds.Txt_R > span     → 単勝オッズ
 */
function parseFinishOrderSP(html: string): RaceFinishResult[] {
  const results: RaceFinishResult[] = [];
  // HorseList 行を抽出（FirstDisplay HorseList または HorseList）
  const rowRe = /<tr[^>]+HorseList[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;

  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1];

    // 着順
    const rankM = row.match(/<div[^>]*class="Rank"[^>]*>(\d+)<\/div>/);
    if (!rankM) continue;
    const pos = parseInt(rankM[1], 10);
    if (isNaN(pos) || pos < 1 || pos > 18) continue;

    // 馬番: class="Num Txt_C" の <div> 内
    const horseNumM = row.match(/<td[^>]*class="Num Txt_C"[^>]*>\s*<div>\s*(\d+)\s*<\/div>/);
    if (!horseNumM) continue;
    const horseNumber = parseInt(horseNumM[1], 10);
    if (isNaN(horseNumber) || horseNumber < 1 || horseNumber > 18) continue;

    // 馬名
    const horseM = row.match(/<span[^>]*class="HorseNameSpan"[^>]*>\s*([^<]+)\s*<\/span>/);
    if (!horseM) continue;
    const horse = horseM[1].trim();
    if (!horse || horse.length < 2) continue;

    // 単勝オッズ: class="Odds Txt_R" の <span>
    const oddsM = row.match(/<td[^>]*class="Odds Txt_R"[^>]*>\s*<span[^>]*>\s*([\d.]+)\s*<\/span>/);
    const odds = oddsM ? parseFloat(oddsM[1]) : null;

    results.push({ position: pos, horseNumber, horse, odds: odds && odds >= 1 ? odds : null });
  }

  return results.sort((a, b) => a.position - b.position);
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
    let odds: number | null = null;
    const tryCol = (ci: number) => {
      if (ci >= cells.length) return;
      const raw = cells[ci];
      if (!raw.includes(".")) return;
      const v = parseFloat(raw.replace(/[^\d.]/g, ""));
      if (!isNaN(v) && v >= 1.0 && v <= 999.9) odds = v;
    };
    tryCol(16);
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
  jockeyId: string;
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

      // <dd class="Jockey"><a href=".../jockey/01222/?rf=shutuba">▲<em>森田</em> 52.0</a><!--01222--></dd>
      let jockey = "";
      let jockeyId = "";
      const jockeyBlockM = segment.match(/<dd class="Jockey">([\s\S]*?)<\/dd>/);
      if (jockeyBlockM) {
        const block = jockeyBlockM[1];
        const idM = block.match(/\/jockey\/(\d+)\//);
        const nameM = block.match(/<em>([^<]+)<\/em>/);
        if (idM) jockeyId = idM[1];
        if (nameM) jockey = nameM[1].trim();
      }

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
        jockeyId,
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
