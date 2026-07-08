/**
 * 予測時点のスナップショットを lib/predictions-log.json に「追記専用」で保存する。
 *
 * races-cache.json は累積・更新される設計のため、後から「当時どのオッズ・
 * どのスコアで賭けたか」を再現できない。このスクリプトはスコア計算・EV 算出の
 * タイミング（オッズ確定後）で、各馬のスコア内訳・pTrue・marketProb・edge・EV・
 * その時点のオッズを不変レコードとして append する。
 *
 * 設計上の不変性:
 *   - 既存レコードは絶対に上書き・削除しない（読み込んだものはそのまま残す）
 *   - 同一レースの直近スナップショットと計算結果が完全一致する場合のみ追記を省略
 *     （＝オッズ・スコアが変われば新レコードを積む）
 *   - キーは raceId + snapshotAt
 *
 * 使い方:
 *   npm run snapshot                 # latestDates（今週末）の確定オッズ分を記録
 *   npx tsx scripts/snapshot-predictions.ts 20260705 20260706   # 日付指定(YYYYMMDD)
 *   npx tsx scripts/snapshot-predictions.ts --all               # races-cache 全レース
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { calculateScore } from "../lib/engine";
import type { HorseScores, ModelVersion } from "../lib/scorer";
import type { RacesCache } from "./fetch-races";

const DEFAULT = 65;

// ── スナップショット型 ────────────────────────────────────────────────────────

export type PredictionHorseSnapshot = {
  horseNumber: number;
  horse: string;
  odds: number;
  // 算出に用いたスコア内訳（0-100、欠損は null）
  formScore: number;
  pedigreeScore: number;
  trainingScore: number | null;
  jockeyScore: number | null;
  // モデル出力
  pTrue: number;
  marketProb: number;
  edge: number;
  ev: number;
};

export type PredictionSnapshot = {
  raceId: number;
  netKeibaRaceId: string;
  raceName: string;
  date: string;
  venue: string;
  raceNumber: number;
  snapshotAt: string;       // このスナップショットを記録した時刻(ISO)
  modelVersion: ModelVersion;
  horses: PredictionHorseSnapshot[];
};

export type PredictionsLog = {
  updatedAt: string;
  snapshots: PredictionSnapshot[];
};

// ── 入出力 ────────────────────────────────────────────────────────────────────

function loadJSON<T>(filename: string): T | null {
  try {
    const p = join(process.cwd(), "lib", filename);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

function loadScores(): Record<number, HorseScores> {
  const raw = loadJSON<{ scores?: Record<string, HorseScores> }>("scores-cache.json");
  const result: Record<number, HorseScores> = {};
  for (const [k, v] of Object.entries(raw?.scores ?? {})) result[Number(k)] = v;
  return result;
}

function loadLog(): PredictionsLog {
  const raw = loadJSON<PredictionsLog>("predictions-log.json");
  if (raw && Array.isArray(raw.snapshots)) return raw;
  return { updatedAt: "", snapshots: [] };
}

// ── 計算（score route の実データ経路をミラー）────────────────────────────────

function computeSnapshot(
  race: RacesCache["races"][number],
  scoresById: Record<number, HorseScores>,
  snapshotAt: string
): PredictionSnapshot | null {
  const horsesWithOdds = race.horses.filter(
    (h): h is typeof h & { odds: number } => h.odds != null && h.odds > 0
  );
  if (horsesWithOdds.length === 0) return null;

  // engine 入力（欠損 training/jockey は null を透過。cached 無しは DEFAULT）
  const inputs = horsesWithOdds.map((h) => {
    const cached = scoresById[h.id];
    const rawTraining = cached ? (cached.trainingScore ?? null) : DEFAULT;
    const rawJockey = cached ? (cached.jockeyScore ?? null) : DEFAULT;
    return {
      id: h.id,
      name: h.horse,
      formScore: (cached?.formScore ?? DEFAULT) / 100,
      pedigreeScore: (cached?.pedigreeScore ?? DEFAULT) / 100,
      trainingScore: rawTraining == null ? null : rawTraining / 100,
      jockeyScore: rawJockey == null ? null : rawJockey / 100,
      odds: h.odds,
    };
  });

  const { finalScores } = calculateScore(inputs);
  const numberById = new Map(horsesWithOdds.map((h) => [h.id, h.horseNumber]));
  const idByName = new Map(finalScores.map((h) => [h.name, h.id]));

  const modelVersion: ModelVersion = horsesWithOdds.some(
    (h) => scoresById[h.id]?.modelVersion === "v2"
  )
    ? "v2"
    : "v1";

  const horses: PredictionHorseSnapshot[] = finalScores.map((h) => {
    const id = idByName.get(h.name)!;
    const cached = scoresById[id];
    // 記録するスコア内訳は算出に用いた生値（0-100、欠損は null）
    const train100 = cached ? (cached.trainingScore ?? null) : DEFAULT;
    const jockey100 = cached ? (cached.jockeyScore ?? null) : DEFAULT;
    return {
      horseNumber: numberById.get(id) ?? 0,
      horse: h.name,
      odds: h.odds,
      formScore: cached?.formScore ?? DEFAULT,
      pedigreeScore: cached?.pedigreeScore ?? DEFAULT,
      trainingScore: train100,
      jockeyScore: jockey100,
      pTrue: h.probability,
      marketProb: h.marketProb,
      edge: h.edge,
      ev: h.ev,
    };
  });

  return {
    raceId: race.id,
    netKeibaRaceId: race.netKeibaRaceId,
    raceName: race.raceName,
    date: race.date,
    venue: race.venue,
    raceNumber: race.raceNumber,
    snapshotAt,
    modelVersion,
    horses,
  };
}

/** 内容の同一判定用シグネチャ（snapshotAt を除いた計算結果） */
function signature(s: PredictionSnapshot): string {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return JSON.stringify({
    v: s.modelVersion,
    h: s.horses.map((h) => [
      h.horseNumber, h.odds, h.formScore, h.pedigreeScore,
      h.trainingScore, h.jockeyScore, round(h.pTrue), round(h.ev),
    ]),
  });
}

// ── メイン ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const dateArgs = args
    .filter((a) => /^\d{8}$/.test(a))
    .map((a) => `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}`);

  const racesCache = loadJSON<RacesCache>("races-cache.json");
  if (!racesCache) {
    console.error("races-cache.json が見つかりません");
    process.exit(1);
  }

  const scoresById = loadScores();
  const log = loadLog();
  const snapshotAt = new Date().toISOString();

  // 対象レース: --all=全件, 日付指定=その日付, 既定=latestDates（今週末）
  const targetDates = all
    ? null
    : dateArgs.length > 0
      ? dateArgs
      : (racesCache.latestDates ?? racesCache.dates.slice(-2));

  const targets = racesCache.races.filter(
    (r) => !r.entriesPending && (targetDates === null || targetDates.includes(r.date))
  );

  console.log("=== VALUE HORSE prediction snapshot ===");
  console.log(`対象: ${all ? "全レース" : (targetDates ?? []).join(", ")} / ${targets.length} レース`);
  console.log(`既存スナップショット: ${log.snapshots.length} 件`);

  // raceId ごとの直近スナップショットを引く（変化検知用）
  const latestByRace = new Map<number, PredictionSnapshot>();
  for (const s of log.snapshots) {
    const prev = latestByRace.get(s.raceId);
    if (!prev || s.snapshotAt > prev.snapshotAt) latestByRace.set(s.raceId, s);
  }

  let added = 0;
  let skipped = 0;
  let noOdds = 0;

  for (const race of targets) {
    const snap = computeSnapshot(race, scoresById, snapshotAt);
    if (!snap) { noOdds++; continue; }

    const prev = latestByRace.get(race.id);
    if (prev && signature(prev) === signature(snap)) {
      skipped++;
      continue;
    }

    // append-only: 既存には一切触れず末尾に追加
    log.snapshots.push(snap);
    added++;
  }

  log.updatedAt = snapshotAt;
  const outPath = join(process.cwd(), "lib", "predictions-log.json");
  writeFileSync(outPath, JSON.stringify(log, null, 2), "utf-8");

  console.log(`\n✓ 書き出し完了: ${outPath}`);
  console.log(`  新規追記: ${added} 件 / 変化なしスキップ: ${skipped} 件 / オッズ未確定: ${noOdds} 件`);
  console.log(`  累積スナップショット: ${log.snapshots.length} 件`);
}

main();
