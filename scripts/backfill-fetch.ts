/**
 * ④ 過去レース一括取得（バックフィル本体）— 取得フェーズ
 *
 * 設計: docs/backfill-leak-design.md §3 / §5
 *   「エンティティ単位で生データを1回だけ取り、レース日を cutoff にした導出は
 *     オフラインで行う」。本スクリプトは **取得だけ** を担当し、スコア導出は
 *   backfill-derive.ts が担当する（再スクレイピング不要で何度でも導出し直せる）。
 *
 * フェーズ（それぞれ独立に再開可能）:
 *   A: 日付 → race_id 一覧              約180リクエスト
 *   B: race_id → レース1枚（馬ID/騎手ID/着順/確定オッズ/払戻）  約1,759
 *   C: 馬ID → 全戦績（直近10走に切らない）                     約10,200
 *   D: 騎手ID → 年度別成績（既存 jockey-yearly-cache.json に追記）
 *
 * 中断耐性（§5-1）:
 *   - エンティティ（日付/レース/馬/騎手）単位で逐次チェックポイント保存
 *   - 保存は 一時ファイル→rename の原子的書き込み。書き込み中に落ちても壊れない
 *   - 再実行すると未取得分のみ処理する
 *   - 取得失敗は既存エントリを上書きしない
 *   - 進捗を lib/backfill/progress.log に追記（別セッションから確認可能）
 *
 * 使い方:
 *   npx tsx scripts/backfill-fetch.ts                        # 6ヶ月・全フェーズ
 *   npx tsx scripts/backfill-fetch.ts --from=2026-07-01 --to=2026-07-12
 *   npx tsx scripts/backfill-fetch.ts --max-races=40         # 小規模テスト
 *   npx tsx scripts/backfill-fetch.ts --phase=C              # 特定フェーズのみ
 *   npx tsx scripts/backfill-fetch.ts --dir=lib/backfill-test # 出力先を変える
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import {
  fetchRaceIdsByDate,
  fetchDbRacePage,
  fetchHorseResultsAll,
  fetchJockeyYearlyTable,
  type DbRacePage,
} from "../lib/scraper";
import type { RaceResult } from "../lib/scorer";
import type { JockeyYearlyCache } from "./fetch-jockey-yearly";

// ── 引数 ──────────────────────────────────────────────────────────────────────

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function defaultFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
}

const FROM = arg("from") ?? defaultFrom();
const TO = arg("to") ?? new Date().toISOString().slice(0, 10);
const MAX_RACES = arg("max-races") ? parseInt(arg("max-races")!, 10) : Infinity;
const PHASE = (arg("phase") ?? "all").toUpperCase();
const DIR = arg("dir") ?? "lib/backfill";
/** 騎手キャッシュは本番のバックテストと共有する（レース年で切るので使い回して安全） */
const JOCKEY_CACHE_PATH = join(process.cwd(), "lib", "jockey-yearly-cache.json");

const runPhase = (p: string) => PHASE === "ALL" || PHASE === p;

// ── 永続化（原子的書き込み + チェックポイント）────────────────────────────────

const dirPath = join(process.cwd(), DIR);
if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });

const LOG_PATH = join(dirPath, "progress.log");

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  try {
    appendFileSync(LOG_PATH, line + "\n", "utf-8");
  } catch {
    // ログ書き込み失敗で取得を止めない
  }
}

/**
 * 前回の異常終了で残った書きかけの .tmp を掃除する。
 * .tmp は rename されていない = 本体には反映されていないので、捨ててよい。
 */
function cleanStaleTmp() {
  for (const f of ["race-index.json", "races.json", "horses.json"]) {
    const tmp = join(dirPath, `${f}.tmp`);
    if (existsSync(tmp)) {
      rmSync(tmp, { force: true });
      log(`  前回の書きかけ ${f}.tmp を破棄（本体は無傷）`);
    }
  }
}

/**
 * 一時ファイルに書いてから rename する。rename は同一ボリュームでは原子的なので、
 * 書き込み途中で電源が落ちても «壊れた JSON» が残らない（旧版がそのまま残る）。
 */
function saveAtomic(file: string, data: unknown) {
  const p = join(dirPath, file);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), "utf-8");
  renameSync(tmp, p);
}

/**
 * 既存チェックポイントを読む。壊れていた場合は **黙って作り直さない**。
 * 数時間分の取得を無言で捨てるのが最悪なので、明示的に異常終了させる。
 */
function loadCheckpoint<T>(file: string, fallback: T): T {
  const p = join(dirPath, file);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch (e) {
    console.error(`\n[FATAL] ${p} が壊れています: ${(e as Error).message}`);
    console.error("  取得済みデータを失わないため、ここで停止します。");
    console.error("  ファイルを退避・削除してから再実行してください。");
    process.exit(1);
  }
}

// ── 型 ────────────────────────────────────────────────────────────────────────

type RaceIndex = {
  from: string;
  to: string;
  /** YYYYMMDD → race_id[]。取得済みの日付だけがキーとして存在する */
  dates: Record<string, string[]>;
};

type RacesStore = { races: Record<string, DbRacePage> };
type HorseEntry = { rows: RaceResult[]; fetchedAt: string };
type HorsesStore = { horses: Record<string, HorseEntry> };

// ── 日付列挙 ──────────────────────────────────────────────────────────────────

/** FROM〜TO の全日付（YYYYMMDD）。開催の有無は問わず、一覧ページで判定する */
function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** JRA の会場コードは 01〜10。地方・海外を混ぜないための絞り込み */
function isJraRaceId(id: string): boolean {
  const v = parseInt(id.slice(4, 6), 10);
  return v >= 1 && v <= 10;
}

// ── Phase A: 日付 → race_id ───────────────────────────────────────────────────

async function phaseA(): Promise<RaceIndex> {
  const idx = loadCheckpoint<RaceIndex>("race-index.json", { from: FROM, to: TO, dates: {} });
  idx.from = FROM;
  idx.to = TO;

  const all = datesInRange(FROM, TO);
  const todo = all.filter((d) => !(d in idx.dates));
  log(`\n━━ Phase A: 開催日の race_id 一覧 ━━`);
  log(`  期間 ${FROM}〜${TO} / 全 ${all.length}日 / 未処理 ${todo.length}日`);

  let done = 0;
  for (const yyyymmdd of todo) {
    const ids = (await fetchRaceIdsByDate(yyyymmdd)).filter(isJraRaceId);
    idx.dates[yyyymmdd] = ids;
    done++;
    if (ids.length > 0) log(`  ${yyyymmdd}: ${ids.length}レース`);
    if (done % 10 === 0) saveAtomic("race-index.json", idx);
  }
  saveAtomic("race-index.json", idx);

  const total = Object.values(idx.dates).flat().length;
  const raceDays = Object.values(idx.dates).filter((v) => v.length > 0).length;
  log(`  ✓ Phase A 完了: 開催 ${raceDays}日 / race_id ${total}件`);
  return idx;
}

// ── Phase B: race_id → レース1枚 ──────────────────────────────────────────────

async function phaseB(idx: RaceIndex): Promise<RacesStore> {
  const store = loadCheckpoint<RacesStore>("races.json", { races: {} });

  const allIds = [...new Set(Object.values(idx.dates).flat())].sort();
  const todo = allIds.filter((id) => !(id in store.races)).slice(0, MAX_RACES);

  log(`\n━━ Phase B: レース結果ページ（1レース1リクエスト）━━`);
  log(`  対象 ${allIds.length}R / 取得済み ${Object.keys(store.races).length}R / 今回 ${todo.length}R`);
  log(`  推定所要: 約 ${Math.ceil((todo.length * 1.3) / 60)} 分`);

  let done = 0;
  let failed = 0;
  for (const id of todo) {
    const page = await fetchDbRacePage(id);
    done++;
    if (!page) {
      failed++; // 取得失敗は保存しない = 次回再試行される
    } else {
      store.races[id] = page;
    }
    if (done % 20 === 0) {
      saveAtomic("races.json", store);
      log(`  ${done}/${todo.length} (失敗 ${failed})`);
    }
  }
  saveAtomic("races.json", store);
  log(`  ✓ Phase B 完了: 累計 ${Object.keys(store.races).length}R（今回失敗 ${failed}）`);
  return store;
}

// ── Phase C: 馬ID → 全戦績 ────────────────────────────────────────────────────

async function phaseC(races: RacesStore): Promise<HorsesStore> {
  const store = loadCheckpoint<HorsesStore>("horses.json", { horses: {} });

  const horseIds = new Set<string>();
  for (const r of Object.values(races.races)) for (const h of r.horses) horseIds.add(h.horseId);
  const todo = [...horseIds].filter((id) => !(id in store.horses));

  log(`\n━━ Phase C: 馬の全戦績 ━━`);
  log(`  ユニーク馬 ${horseIds.size}頭 / 取得済み ${Object.keys(store.horses).length}頭 / 今回 ${todo.length}頭`);
  log(`  推定所要: 約 ${((todo.length * 1.3) / 3600).toFixed(1)} 時間`);

  let done = 0;
  let failed = 0;
  for (const id of todo) {
    const rows = await fetchHorseResultsAll(id);
    done++;
    if (rows == null) {
      failed++; // 保存しない = 次回再試行
    } else {
      store.horses[id] = { rows, fetchedAt: new Date().toISOString() };
    }
    if (done % 25 === 0) {
      saveAtomic("horses.json", store);
      const pct = ((done / todo.length) * 100).toFixed(1);
      const remainMin = Math.ceil(((todo.length - done) * 1.3) / 60);
      log(`  ${done}/${todo.length} (${pct}%, 失敗 ${failed}, 残り約 ${remainMin}分)`);
    }
  }
  saveAtomic("horses.json", store);
  log(`  ✓ Phase C 完了: 累計 ${Object.keys(store.horses).length}頭（今回失敗 ${failed}）`);
  return store;
}

// ── Phase D: 騎手ID → 年度別成績 ──────────────────────────────────────────────

async function phaseD(races: RacesStore) {
  const cache: JockeyYearlyCache = existsSync(JOCKEY_CACHE_PATH)
    ? (JSON.parse(readFileSync(JOCKEY_CACHE_PATH, "utf-8")) as JockeyYearlyCache)
    : { fetchedAt: "", source: "db.netkeiba.com/jockey/result/", jockeys: {} };

  const jockeys = new Map<string, string>();
  for (const r of Object.values(races.races)) {
    for (const h of r.horses) if (h.jockeyId) jockeys.set(h.jockeyId, h.jockey);
  }
  const todo = [...jockeys].filter(([id]) => !cache.jockeys[id]?.rows?.length);

  log(`\n━━ Phase D: 騎手の年度別成績 ━━`);
  log(`  ユニーク騎手 ${jockeys.size}名 / 未取得 ${todo.length}名`);

  let done = 0;
  for (const [id, name] of todo) {
    const rows = await fetchJockeyYearlyTable(id);
    done++;
    if (rows) cache.jockeys[id] = { name, rows, fetchedAt: new Date().toISOString() };
    if (done % 10 === 0) {
      cache.fetchedAt = new Date().toISOString();
      const tmp = `${JOCKEY_CACHE_PATH}.tmp`;
      writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf-8");
      renameSync(tmp, JOCKEY_CACHE_PATH);
    }
  }
  cache.fetchedAt = new Date().toISOString();
  const tmp = `${JOCKEY_CACHE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf-8");
  renameSync(tmp, JOCKEY_CACHE_PATH);
  log(`  ✓ Phase D 完了: 累計 ${Object.keys(cache.jockeys).length}名`);
}

// ── メイン ────────────────────────────────────────────────────────────────────

async function main() {
  const started = Date.now();
  cleanStaleTmp();
  log(`\n=== ④ バックフィル取得 (${FROM} 〜 ${TO}, phase=${PHASE}, dir=${DIR}) ===`);
  if (MAX_RACES !== Infinity) log(`  ※ --max-races=${MAX_RACES} 指定（小規模テスト）`);

  const idx = runPhase("A")
    ? await phaseA()
    : loadCheckpoint<RaceIndex>("race-index.json", { from: FROM, to: TO, dates: {} });

  const races = runPhase("B")
    ? await phaseB(idx)
    : loadCheckpoint<RacesStore>("races.json", { races: {} });

  if (runPhase("D")) await phaseD(races); // 騎手は129名程度なので先に済ませる
  if (runPhase("C")) await phaseC(races);

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  log(`\n✓ 取得フェーズ終了（${mins}分）`);
  log(`  次: npx tsx scripts/backfill-derive.ts --dir=${DIR}`);
}

main().catch((e) => {
  console.error("\n[ERROR]", e);
  process.exit(1);
});
