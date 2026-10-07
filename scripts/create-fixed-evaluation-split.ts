/**
 * 6ヶ月バックフィルを、事前に固定した時系列境界で一度だけ分割する。
 *
 * 成績、ROI、AUC、的中率は読み取らない。検証するのは日付、raceId、件数、
 * ファイル集合、SHA-256だけ。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

const BOUNDARY = "2026-06-27";
const DEVELOPMENT_END = "2026-06-21";
const DEVELOPMENT_HORSE_CUTOFF = "2026-06-22";
const FIXED_END = "2026-08-02";
const SOURCE_COMMIT = "2e34baaa7ec4381743c001b883b125e13273eb70";
const SOURCE_DIR = join(process.cwd(), "lib", "backfill");
const SEALED_ROOT = join(process.cwd(), ".sealed-data");
const SOURCE_ARCHIVE = join(SEALED_ROOT, "source-full-20260207-20260802");
const FIXED_DIR = join(SEALED_ROOT, "fixed-evaluation-20260627");
const DEV_TMP = join(process.cwd(), "lib", "backfill-development.tmp");
const FIXED_TMP = join(SEALED_ROOT, "fixed-evaluation-20260627.tmp");
const MANIFEST_PATH = join(process.cwd(), "docs", "fixed-evaluation-manifest.json");

const DATA_FILES = [
  "race-index.json",
  "races.json",
  "horses.json",
  "races-cache.json",
  "results-cache.json",
  "payouts-cache.json",
  "scores-cache.json",
] as const;
const SOURCE_ONLY_FILES = ["scores-cache-v2.json", "progress.log", "run.out", "run-retry.out"];

type RawRace = {
  netKeibaRaceId: string;
  date: string;
  horses: Array<{ horseId: string }>;
};
type CachedRace = {
  id: number;
  date: string;
  netKeibaRaceId: string;
  horses: Array<{ id: number; netKeibaHorseId: string }>;
};
type ResultRace = { netKeibaRaceId: string; date: string };
type PayoutRace = { netKeibaRaceId: string; date: string };
type HorseStore = Record<string, { rows: Array<{ date: string }>; fetchedAt: string }>;

function read<T>(dir: string, file: string): T {
  return JSON.parse(readFileSync(join(dir, file), "utf-8")) as T;
}

function write(dir: string, file: string, value: unknown) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), JSON.stringify(value), "utf-8");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function raceSet(values: Array<{ netKeibaRaceId: string }>): Set<string> {
  return new Set(values.map((r) => r.netKeibaRaceId));
}

function equalSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

function partition<T extends { date: string }>(values: T[]) {
  return {
    development: values.filter((v) => v.date < BOUNDARY),
    fixed: values.filter((v) => v.date >= BOUNDARY),
  };
}

function selectScores(
  scores: Record<string, unknown>,
  races: CachedRace[]
): Record<string, unknown> {
  const ids = new Set(races.flatMap((r) => r.horses.map((h) => String(h.id))));
  return Object.fromEntries(Object.entries(scores).filter(([id]) => ids.has(id)));
}

function selectHorses(
  horses: HorseStore,
  races: RawRace[],
  cutoff: string
): HorseStore {
  const ids = new Set(races.flatMap((r) => r.horses.map((h) => h.horseId)));
  const slashCutoff = cutoff.replace(/-/g, "/");
  return Object.fromEntries(
    Object.entries(horses)
      .filter(([id]) => ids.has(id))
      .map(([id, entry]) => [
        id,
        { ...entry, rows: entry.rows.filter((row) => row.date < slashCutoff) },
      ])
  );
}

function hashes(dir: string, files: readonly string[]) {
  return Object.fromEntries(
    files.map((file) => [file, sha256(join(dir, file))])
  );
}

function main() {
  assert(existsSync(SOURCE_DIR), `${SOURCE_DIR} がありません`);
  assert(!existsSync(SOURCE_ARCHIVE), `${SOURCE_ARCHIVE} は既に存在します`);
  assert(!existsSync(FIXED_DIR), `${FIXED_DIR} は既に存在します`);
  assert(!existsSync(DEV_TMP) && !existsSync(FIXED_TMP), "一時ディレクトリが残っています");

  const sourceRaces = read<{ races: Record<string, RawRace> }>(SOURCE_DIR, "races.json");
  const sourceRaceValues = Object.values(sourceRaces.races);
  const sourceCache = read<{
    fetchedAt: string;
    dates: string[];
    latestDates: string[];
    races: CachedRace[];
  }>(SOURCE_DIR, "races-cache.json");
  const sourceResults = read<{ fetchedAt: string; results: ResultRace[] }>(
    SOURCE_DIR,
    "results-cache.json"
  );
  const sourcePayouts = read<{ fetchedAt: string; payouts: PayoutRace[] }>(
    SOURCE_DIR,
    "payouts-cache.json"
  );
  const sourceScores = read<{
    fetchedAt: string;
    source: string;
    scores: Record<string, unknown>;
  }>(SOURCE_DIR, "scores-cache.json");
  const sourceHorses = read<{ horses: HorseStore }>(SOURCE_DIR, "horses.json");
  const sourceIndex = read<{ from: string; to: string; dates: Record<string, string[]> }>(
    SOURCE_DIR,
    "race-index.json"
  );

  assert(sourceRaceValues.length === 1770, `元レース数が1770ではありません: ${sourceRaceValues.length}`);
  const rawSplit = partition(sourceRaceValues);
  const cacheSplit = partition(sourceCache.races);
  const resultSplit = partition(sourceResults.results);
  const payoutSplit = partition(sourcePayouts.payouts);
  assert(rawSplit.development.length === 1338, "developmentのレース数が1338ではありません");
  assert(rawSplit.fixed.length === 432, "fixed evaluationのレース数が432ではありません");

  const writePartition = (
    dir: string,
    rawRaces: RawRace[],
    cachedRaces: CachedRace[],
    results: ResultRace[],
    payouts: PayoutRace[],
    from: string,
    to: string,
    horseCutoff: string
  ) => {
    const ids = raceSet(rawRaces);
    const dates = [...new Set(cachedRaces.map((r) => r.date))].sort();
    const dateKeys = new Set(dates.map((d) => d.replace(/-/g, "")));
    const indexDates = Object.fromEntries(
      Object.entries(sourceIndex.dates)
        .filter(([date]) => dateKeys.has(date))
        .map(([date, raceIds]) => [date, raceIds.filter((id) => ids.has(id))])
    );

    write(dir, "race-index.json", { from, to, dates: indexDates });
    write(dir, "races.json", {
      races: Object.fromEntries(rawRaces.map((r) => [r.netKeibaRaceId, r])),
    });
    write(dir, "horses.json", {
      horses: selectHorses(sourceHorses.horses, rawRaces, horseCutoff),
    });
    write(dir, "races-cache.json", {
      fetchedAt: sourceCache.fetchedAt,
      dates,
      latestDates: dates.slice(-2),
      races: cachedRaces,
    });
    write(dir, "results-cache.json", { fetchedAt: sourceResults.fetchedAt, results });
    write(dir, "payouts-cache.json", { fetchedAt: sourcePayouts.fetchedAt, payouts });
    write(dir, "scores-cache.json", {
      fetchedAt: sourceScores.fetchedAt,
      source: sourceScores.source,
      scores: selectScores(sourceScores.scores, cachedRaces),
    });
  };

  writePartition(
    DEV_TMP,
    rawSplit.development,
    cacheSplit.development,
    resultSplit.development,
    payoutSplit.development,
    "2026-02-07",
    DEVELOPMENT_END,
    DEVELOPMENT_HORSE_CUTOFF
  );
  writePartition(
    FIXED_TMP,
    rawSplit.fixed,
    cacheSplit.fixed,
    resultSplit.fixed,
    payoutSplit.fixed,
    BOUNDARY,
    FIXED_END,
    "2026-08-03"
  );

  const validate = (
    dir: string,
    expected: number,
    min: string,
    max: string,
    horseCutoff: string
  ) => {
    const raw = Object.values(read<{ races: Record<string, RawRace> }>(dir, "races.json").races);
    const cache = read<{ races: CachedRace[] }>(dir, "races-cache.json").races;
    const results = read<{ results: ResultRace[] }>(dir, "results-cache.json").results;
    const payouts = read<{ payouts: PayoutRace[] }>(dir, "payouts-cache.json").payouts;
    const scores = read<{ scores: Record<string, unknown> }>(dir, "scores-cache.json").scores;
    const horses = read<{ horses: HorseStore }>(dir, "horses.json").horses;
    const expectedScoreIds = new Set(cache.flatMap((r) => r.horses.map((h) => String(h.id))));
    assert(raw.length === expected, `${dir}: races.jsonの件数不一致`);
    assert(cache.length === expected, `${dir}: races-cacheの件数不一致`);
    assert(results.length === expected, `${dir}: results-cacheの件数不一致`);
    assert(payouts.length === expected, `${dir}: payouts-cacheの件数不一致`);
    assert(equalSet(raceSet(raw), raceSet(cache)), `${dir}: raw/cacheのraceId不一致`);
    assert(equalSet(raceSet(raw), raceSet(results)), `${dir}: raw/resultsのraceId不一致`);
    assert(equalSet(raceSet(raw), raceSet(payouts)), `${dir}: raw/payoutsのraceId不一致`);
    assert(equalSet(expectedScoreIds, new Set(Object.keys(scores))), `${dir}: score id不一致`);
    const dates = raw.map((r) => r.date).sort();
    assert(dates[0] === min && dates.at(-1) === max, `${dir}: 日付範囲不一致`);
    const slashCutoff = horseCutoff.replace(/-/g, "/");
    assert(
      Object.values(horses).every((entry) =>
        entry.rows.every((row) => row.date < slashCutoff)
      ),
      `${dir}: horses.jsonに区画末尾より後の履歴があります`
    );
    assert(!existsSync(join(dir, "scores-cache-v2.json")), `${dir}: v2スコアは禁止です`);
    return raceSet(raw);
  };

  const devIds = validate(
    DEV_TMP,
    1338,
    "2026-02-07",
    DEVELOPMENT_END,
    DEVELOPMENT_HORSE_CUTOFF
  );
  const fixedIds = validate(FIXED_TMP, 432, BOUNDARY, FIXED_END, "2026-08-03");
  assert([...devIds].every((id) => !fixedIds.has(id)), "development/fixed evaluationのraceIdが重複しています");
  assert(devIds.size + fixedIds.size === 1770, "分割後のraceId和集合が元データと一致しません");

  mkdirSync(SEALED_ROOT, { recursive: true });
  renameSync(SOURCE_DIR, SOURCE_ARCHIVE);
  renameSync(DEV_TMP, SOURCE_DIR);
  renameSync(FIXED_TMP, FIXED_DIR);

  // 隔離原本が分割前の全11ファイルを保持していることを確認する。
  for (const file of [...DATA_FILES, ...SOURCE_ONLY_FILES]) {
    assert(existsSync(join(SOURCE_ARCHIVE, file)), `原本ファイル不在: ${file}`);
  }

  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    boundaryDate: BOUNDARY,
    source: {
      period: { from: "2026-02-07", to: FIXED_END },
      collectionWindow: { from: "2026-02-05", to: "2026-08-05" },
      races: 1770,
      commit: SOURCE_COMMIT,
      directory: ".sealed-data/source-full-20260207-20260802",
      files: [...DATA_FILES, ...SOURCE_ONLY_FILES],
      sha256: hashes(SOURCE_ARCHIVE, [...DATA_FILES, ...SOURCE_ONLY_FILES]),
    },
    development: {
      period: { from: "2026-02-07", to: DEVELOPMENT_END },
      races: 1338,
      directory: "lib/backfill",
      files: [...DATA_FILES],
      sha256: hashes(SOURCE_DIR, DATA_FILES),
      prohibitedFiles: ["scores-cache-v2.json"],
    },
    fixedEvaluation: {
      period: { from: BOUNDARY, to: FIXED_END },
      races: 432,
      directory: ".sealed-data/fixed-evaluation-20260627",
      files: [...DATA_FILES],
      sha256: hashes(FIXED_DIR, DATA_FILES),
      priorUseDisclosure:
        "過去の市場乖離診断で使用済みであり、厳密な完全未見データではない",
    },
    invariants: {
      boundaryWillNotChangeAfterViewingEvaluationResults: true,
      developmentAndFixedRaceIdsDisjoint: true,
      unionMatchesSourceRaceIds: true,
      performanceMetricsIncluded: false,
      strictUnseenEvaluation:
        "2026-08-02より後に蓄積された将来データで別途実施する",
      horseFeatureRule: "各レース日より厳密に前の履歴だけを使用する",
      jockeyFeatureRule: "レース年より前の年度行だけを使用する",
    },
  };
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  console.log("fixed evaluation分割を作成しました");
  console.log(`development: ${devIds.size}R (2026-02-07〜${DEVELOPMENT_END})`);
  console.log(`fixed evaluation: ${fixedIds.size}R (${BOUNDARY}〜${FIXED_END})`);
  console.log("raceId重複: 0");
}

main();
