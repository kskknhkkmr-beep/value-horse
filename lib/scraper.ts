import type { RaceResult, JockeyStats, JockeyYearRow } from "./scorer";
import { MIN_RIDES_FOR_YEAR } from "./scorer";

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

/**
 * スリープ復帰後の無効な接続や Wi-Fi 瞬断時、素の fetch は応答を無期限に待ち続け
 * ハングし得る（AbortSignal 無しだと打ち切る手段が無いため）。全リクエストで
 * タイムアウトを強制し、打ち切り時は呼び出し元の catch で「失敗」として扱えるよう
 * 分かりやすいエラーに変換する。
 */
const DEFAULT_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`timeout after ${timeoutMs}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// netkeiba DB は EUC-JP
async function fetchEuc(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, { headers: PC_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  // charset=euc-jp / charset= の両方に対応
  const latin = new TextDecoder("latin1").decode(buf.slice(0, 1000));
  const enc = latin.toLowerCase().includes("euc") ? "euc-jp" : "utf-8";
  return new TextDecoder(enc).decode(buf);
}

// SP サイトは UTF-8
async function fetchUtf8(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, { headers: SP_HEADERS });
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
    const res = await fetchWithTimeout(url, {
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

/**
 * 同じページから **全戦績行**（直近10走に切らない）を返す。
 *
 * 遡及バックフィル専用。過去のレース時点の形状を復元するには、そのレース日より
 * 前の走りだけを残して切り出す必要があり、直近10走に切ってしまうと
 * 「対象レースより後の走り」で枠が埋まって手前が消える。生データを全部持ち、
 * cutoff はオフラインで当てる（docs/backfill-leak-design.md §3）。
 */
export async function fetchHorseResultsAll(horseId: string): Promise<RaceResult[] | null> {
  await sleep(1200);
  const url = `https://db.netkeiba.com/horse/result/${horseId}/`;
  try {
    const html = await fetchEuc(url);
    return parseRaceResultTable(html, { fieldSizeCol: 6, positionCol: 11, courseCol: 14 }, Infinity);
  } catch (e) {
    console.warn(`  [scraper] fetchHorseResultsAll failed (${horseId}):`, (e as Error).message);
    return null;
  }
}

// ─── 騎手成績（年度別） → JockeyStats ────────────────────────────────────────

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

/**
 * 同じ年度別成績ページから、**集約せず全行をそのまま** 返す。
 * レース年を cutoff にした導出（`resolveJockeyStats`）をオフラインで行うための生データ取得。
 * fetchJockeyStats（本番ライブ経路）とは用途が異なるため別関数として並置する。
 */
export async function fetchJockeyYearlyTable(jockeyId: string): Promise<JockeyYearRow[] | null> {
  await sleep(1200);
  const url = `https://db.netkeiba.com/jockey/result/${jockeyId}/`;
  try {
    const html = await fetchEuc(url);
    const rows = parseJockeyYearRows(html);
    return rows.length > 0 ? rows : null;
  } catch (e) {
    console.warn(`  [scraper] fetchJockeyYearlyTable failed (${jockeyId}):`, (e as Error).message);
    return null;
  }
}

// ─── 内部パーサー ────────────────────────────────────────────────────────────

function parseRaceResultTable(
  html: string,
  cols: { fieldSizeCol: number; positionCol: number; courseCol: number },
  limit = 10
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

  return limit === Infinity ? results : results.slice(0, limit); // 既定は直近10走まで
}

/** 年度別成績テーブルの行を、集約せずそのまま抽出する。 */
function parseJockeyYearRows(html: string): JockeyYearRow[] {
  const rows: JockeyYearRow[] = [];

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

  return rows;
}

function parseJockeyYearlyStats(html: string): JockeyStats | null {
  const rows = parseJockeyYearRows(html);
  if (rows.length === 0) return null;

  const toStats = (r: JockeyYearRow): JockeyStats => ({
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

// ─── 確定払戻（単勝・複勝・ワイド・馬連・馬単） ───────────────────────────────

export type ComboPayout = {
  combo: number[]; // 馬連/ワイド=昇順2頭、馬単=着順(1着→2着)の2頭
  payout: number; // 100円あたり払戻金
};

export type SinglePayout = {
  horse: number; // 馬番
  payout: number; // 100円あたり払戻金
};

export type RacePayouts = {
  umaren: ComboPayout[]; // 通常1件。1着同着等で複数件になる場合がある
  umatan: ComboPayout[];
  /** 単勝。通常1件（1着同着で2件） */
  tan: SinglePayout[];
  /** 複勝。通常3件。出走5〜7頭なら2件、4頭以下は発売なしで0件 */
  fuku: SinglePayout[];
  /** ワイド。通常3件（3着同着等で増える） */
  wide: ComboPayout[];
};

const EMPTY_PAYOUTS: RacePayouts = { umaren: [], umatan: [], tan: [], fuku: [], wide: [] };

/**
 * db.netkeiba.com のレース結果ページから馬連・馬単の確定払戻を取得する。
 * URL: https://db.netkeiba.com/race/[12桁ID]/
 */
export async function fetchRacePayouts(netKeibaRaceId: string): Promise<RacePayouts> {
  await sleep(1200);
  try {
    const url = `https://db.netkeiba.com/race/${netKeibaRaceId}/`;
    const html = await fetchEuc(url);
    return parsePayouts(html);
  } catch (e) {
    console.warn(`  [scraper] fetchRacePayouts failed (${netKeibaRaceId}):`, (e as Error).message);
    return { ...EMPTY_PAYOUTS };
  }
}

/**
 * 払戻テーブル（class="pay_table_01"）をパースする。
 * 構造:
 *   <tr><th class="tan">単勝</th><td>8</td><td class="txt_r">390</td><td class="txt_r">2</td></tr>
 *   <tr><th class="fuku" align="center">複勝</th><td>8<br />4<br />7</td>
 *       <td class="txt_r">140<br />110<br />140</td><td class="txt_r">3<br />1<br />2</td></tr>
 *   <tr><th class="uren">馬連</th><td>8 - 13</td><td class="txt_r">29,830</td><td class="txt_r">58</td></tr>
 *   <tr><th class="wide">ワイド</th><td>4 - 8<br />7 - 8<br />4 - 7</td>
 *       <td class="txt_r">240<br />360<br />260</td><td class="txt_r">1<br />4<br />2</td></tr>
 *   <tr><th class="utan">馬単</th><td>13 → 8</td><td class="txt_r">70,700</td><td class="txt_r">114</td></tr>
 * 複数組み合わせ（ワイド・複勝の各点、同着等）は <br /> 区切りで並ぶ。
 *
 * 注: th の class は完全一致で引くこと。"fuku" を部分一致にすると
 *     三連複の class="sanfuku" を誤って拾う。
 */
function parsePayouts(html: string): RacePayouts {
  /** 該当行の「組み合わせ列」と「払戻列」を <br /> で割って対で返す */
  function extractCells(thClass: string): Array<[string, number]> {
    const rowRe = new RegExp(
      `<th[^>]*class="${thClass}"[^>]*>[\\s\\S]*?<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>\\s*<td[^>]*class="txt_r"[^>]*>([\\s\\S]*?)<\\/td>`,
      "i"
    );
    const m = html.match(rowRe);
    if (!m) return [];
    const combos = m[1].split(/<br\s*\/?>/i).map((s) => stripTags(s).trim()).filter(Boolean);
    const payouts = m[2].split(/<br\s*\/?>/i).map((s) => stripTags(s).trim()).filter(Boolean);
    const out: Array<[string, number]> = [];
    for (let i = 0; i < combos.length; i++) {
      const payout = parseInt((payouts[i] ?? "").replace(/[^\d]/g, ""), 10);
      if (!isNaN(payout) && payout > 0) out.push([combos[i], payout]);
    }
    return out;
  }

  /** 2頭組（馬連・ワイド・馬単） */
  function extractCombo(thClass: string, sep: "-" | "→"): ComboPayout[] {
    const results: ComboPayout[] = [];
    for (const [combo, payout] of extractCells(thClass)) {
      const nums = combo
        .split(sep)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));
      if (nums.length === 2) results.push({ combo: nums, payout });
    }
    return results;
  }

  /** 単頭（単勝・複勝） */
  function extractSingle(thClass: string): SinglePayout[] {
    const results: SinglePayout[] = [];
    for (const [combo, payout] of extractCells(thClass)) {
      const horse = parseInt(combo.trim(), 10);
      if (!isNaN(horse)) results.push({ horse, payout });
    }
    return results;
  }

  return {
    umaren: extractCombo("uren", "-"),
    umatan: extractCombo("utan", "→"),
    tan: extractSingle("tan"),
    fuku: extractSingle("fuku"),
    wide: extractCombo("wide", "-"),
  };
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

// ─── 過去レース1枚取得（バックフィル専用） ──────────────────────────────────

export type DbRaceHorse = {
  /** 着順。中止・失格など着順がつかなかった馬は 0（出走はしたので買えた） */
  position: number;
  frameNumber: number;
  horseNumber: number;
  horse: string;
  horseId: string;
  jockey: string;
  jockeyId: string;
  /** 確定単勝オッズ */
  odds: number | null;
  popularity: number | null;
};

export type DbRacePage = {
  netKeibaRaceId: string;
  date: string; // YYYY-MM-DD
  venue: string;
  raceNumber: number;
  raceName: string;
  surface: "芝" | "ダ" | "障";
  distance: number;
  horses: DbRaceHorse[];
  payouts: RacePayouts;
};

/**
 * db.netkeiba.com のレース結果ページ **1枚** から、バックフィルに必要なものを全部取る。
 *   馬ID・騎手ID・馬番・馬名・着順・確定単勝オッズ・レース条件・確定払戻
 *
 * 設計 §5 では「出馬表＋オッズ＋結果の3枚」を見込んでいたが、実測でこの1枚に
 * すべて揃うことを確認したため、レースあたりのリクエストは 1 で済む。
 *
 * 注意: ここで取れるオッズは **確定単勝オッズ**。本番のライブ経路が使う
 * 「発走前スナップショット」とは厳密には別物（遡及取得では原理的に手に入らない）。
 */
export async function fetchDbRacePage(netKeibaRaceId: string): Promise<DbRacePage | null> {
  await sleep(1200);
  const url = `https://db.netkeiba.com/race/${netKeibaRaceId}/`;
  let html: string;
  try {
    html = await fetchEuc(url);
  } catch (e) {
    console.warn(`  [scraper] fetchDbRacePage failed (${netKeibaRaceId}):`, (e as Error).message);
    return null;
  }
  return parseDbRacePage(html, netKeibaRaceId);
}

/** 着順セル → 数値。"中"(中止)・"失"(失格)は出走扱いで 0、"除"/"取"(非出走)は null */
function parseFinishCell(s: string): number | null {
  const t = s.trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (t.startsWith("中") || t.startsWith("失")) return 0;
  return null; // 除外・取消 → 出走していないので対象外
}

export function parseDbRacePage(html: string, netKeibaRaceId: string): DbRacePage | null {
  // 条件: <span>芝右1200m / 天候 : 晴 / ...</span>
  const condM = html.match(/(芝|ダ|障)[^<]{0,4}?(\d{3,4})m/);
  if (!condM) return null;
  const surface = (condM[1] === "芝" ? "芝" : condM[1] === "障" ? "障" : "ダ") as "芝" | "ダ" | "障";
  const distance = parseInt(condM[2], 10);

  // 日付: <p class="smalltxt">2026年06月28日 1回函館6日目 ...</p>
  const dateM = html.match(/class="smalltxt"[^>]*>\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!dateM) return null;
  const date = `${dateM[1]}-${dateM[2].padStart(2, "0")}-${dateM[3].padStart(2, "0")}`;

  const nameM = html.match(/<dl class="racedata[^"]*"[\s\S]*?<h1>([\s\S]*?)<\/h1>/);
  const raceName = nameM ? stripTags(nameM[1].replace(/<!--[\s\S]*?-->/g, "")) : "";

  // 会場・R番号は race_id から一意に決まる（HTML 解析より確実）
  const venue = VENUE_MAP[netKeibaRaceId.slice(4, 6)] ?? netKeibaRaceId.slice(4, 6);
  const raceNumber = parseInt(netKeibaRaceId.slice(10, 12), 10);

  // 着順テーブル: 0:着順 1:枠番 2:馬番 3:馬名 4:性齢 5:斤量 6:騎手 ... 16:単勝 17:人気
  const horses: DbRaceHorse[] = [];
  for (const rowM of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowM[1];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1]));
    if (cells.length < 18) continue;

    const position = parseFinishCell(cells[0]);
    if (position == null) continue;

    const horseId = row.match(/\/horse\/(\d{10})\//)?.[1];
    const jockeyId = row.match(/\/jockey\/(?:result\/)?(?:recent\/)?(\d{5})\//)?.[1];
    if (!horseId) continue;

    const horseNumber = toInt(cells[2]);
    const frameNumber = toInt(cells[1]);
    if (isNaN(horseNumber)) continue;

    const oddsVal = parseFloat(cells[16]);
    const popVal = parseInt(cells[17], 10);

    horses.push({
      position,
      frameNumber: isNaN(frameNumber) ? 0 : frameNumber,
      horseNumber,
      horse: cells[3],
      horseId,
      jockey: cells[6],
      jockeyId: jockeyId ?? "",
      odds: !isNaN(oddsVal) && oddsVal >= 1 ? oddsVal : null,
      popularity: isNaN(popVal) ? null : popVal,
    });
  }

  if (horses.length === 0) return null;

  return {
    netKeibaRaceId,
    date,
    venue,
    raceNumber,
    raceName,
    surface,
    distance,
    horses: horses.sort((a, b) => a.horseNumber - b.horseNumber),
    payouts: parsePayouts(html),
  };
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

export type RaceGrade = "G1" | "G2" | "G3" | null;

export type RaceEntryInfo = {
  raceName: string;
  postTime: string | null;
  surface: "芝" | "ダ" | "障";
  distance: number;
  venue: string;
  raceNumber: number;
  netKeibaRaceId: string;
  entriesPending: boolean; // true = 出馬表未発表
  grade: RaceGrade; // 重賞グレード（G1/G2/G3）。重賞でなければ null
  horses: RaceEntryHorse[];
};

/**
 * shutuba ページの重賞グレード表示から grade を抽出する。
 * 構造: <span class="Icon_GradeType Icon_GradeType{1|2|3} ...">G{I|II|III}</span>
 * 重賞でないレースにはこの要素自体が存在しない。
 */
function parseGrade(html: string): RaceGrade {
  const m = html.match(/Icon_GradeType\s+Icon_GradeType([123])\b/);
  if (!m) return null;
  return (`G${m[1]}` as RaceGrade);
}

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

    const grade = parseGrade(html);

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

    // 馬エントリー: <tr class="HorseList"> 行ごとに処理する。
    // ⚠ 馬番は「並び順(idx)」ではなく行内の <td class="Waku{枠}">{馬番}</td> セルから
    //   実値を読む。SP shutuba は枠順表示前などに五十音順で配信されることがあり、
    //   idx を馬番にすると別馬のオッズ(fetch-races 側で馬番 join)が混入するため。
    const rowChunks = html.split(/<tr class="HorseList"/).slice(1);

    // 出馬表未発表判定用: 馬 DB リンクがページに1つも無ければメタのみ返す
    const hasAnyHorseLink = /id="db_\d+"/.test(html) || /horse_id=\d+/.test(html);
    if (!hasAnyHorseLink) {
      if (!raceName && !postTime) return null; // ページ自体がないか無効
      return { raceName, postTime, surface, distance, venue, raceNumber, netKeibaRaceId, entriesPending: true, grade, horses: [] };
    }

    const horses: RaceEntryHorse[] = [];
    for (const chunk of rowChunks) {
      // 先頭セル <td class="Waku{枠}">{馬番}</td> から枠番・実馬番を取得
      const wakuM = chunk.match(/<td class="Waku(\d+)"[^>]*>\s*(\d{1,2})\s*<\/td>/);
      if (!wakuM) continue; // Waku セルの無い行（テンプレ等）はスキップ
      const frameNumber = parseInt(wakuM[1], 10);
      const horseNumber = parseInt(wakuM[2], 10);
      if (isNaN(horseNumber) || horseNumber < 1 || horseNumber > 18) continue;

      // 馬 ID（db リンク優先、無ければ modal リンクの horse_id）
      const idM = chunk.match(/id="db_(\d+)"/) ?? chunk.match(/horse_id=(\d+)/);
      const horseId = idM ? idM[1] : "";
      // 馬名（「{馬名}のデータベース」span。名前に「の」を含む馬にも対応するため非貪欲）
      const nameM = chunk.match(/<span>([^<]+?)のデータベース<\/span>/);
      const horseName = nameM ? nameM[1].trim() : "";
      if (!horseId || !horseName) continue; // 必須情報欠落はスキップ

      // <dd class="Jockey"><a href=".../jockey/01222/?rf=shutuba">▲<em>森田</em> 52.0</a><!--01222--></dd>
      let jockey = "";
      let jockeyId = "";
      const jockeyBlockM = chunk.match(/<dd class="Jockey">([\s\S]*?)<\/dd>/);
      if (jockeyBlockM) {
        const block = jockeyBlockM[1];
        const jIdM = block.match(/\/jockey\/(\d+)\//);
        const jNameM = block.match(/<em>([^<]+)<\/em>/);
        if (jIdM) jockeyId = jIdM[1];
        if (jNameM) jockey = jNameM[1].trim();
      }

      // オッズ（shutuba ページ側。fetch-races は winOddsMap で上書きするが従来通り保持）
      let odds: number | null = null;
      const oddsM = chunk.match(/class="[^"]*Odds[^"]*"[^>]*>\s*<[^>]+>\s*([\d.]+)/) ??
        chunk.match(/class="[^"]*Odds[^"]*"[^>]*>([\d.]+)/) ??
        chunk.match(/id="odds-1_\d+"[^>]*>([\d.]+)</);
      if (oddsM) {
        const v = parseFloat(oddsM[1]);
        if (!isNaN(v) && v >= 1.0 && v <= 9999) odds = v;
      }

      horses.push({ frameNumber, horseNumber, horse: horseName, netKeibaHorseId: horseId, jockey, jockeyId, odds });
    }

    // 有効な馬行が無い（＝出馬表未発表 or 構造変化）→ メタのみ返す
    if (horses.length === 0) {
      if (!raceName && !postTime) return null;
      return { raceName, postTime, surface, distance, venue, raceNumber, netKeibaRaceId, entriesPending: true, grade, horses: [] };
    }

    // ── 再発防止ガード: 馬番の重複を検知したら誤データを出さず未発表扱いにする ──
    // （行から実馬番を読むため並び順バグは原理的に起きないが、パース異常の安全網）
    const nums = horses.map((h) => h.horseNumber);
    if (new Set(nums).size !== nums.length) {
      console.warn(
        `  [scraper] 馬番重複を検知 (${netKeibaRaceId}): [${[...nums].sort((a, b) => a - b).join(",")}] → entriesPending 扱い`
      );
      return { raceName, postTime, surface, distance, venue, raceNumber, netKeibaRaceId, entriesPending: true, grade, horses: [] };
    }

    // 馬番順にソートして返す（表示・join の一貫性のため）
    horses.sort((a, b) => a.horseNumber - b.horseNumber);

    return { raceName, postTime, surface, distance, venue, raceNumber, netKeibaRaceId, entriesPending: false, grade, horses };
  } catch (e) {
    console.warn(`  [scraper] fetchRaceEntry failed (${netKeibaRaceId}):`, (e as Error).message);
    return null;
  }
}

