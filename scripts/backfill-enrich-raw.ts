/**
 * development 専用の生データ拡張取得。
 *
 * 入力は lib/backfill/races.json の 1,338R / 7,851頭だけ。
 * fixed evaluation と .sealed-data は参照しない。
 * 取得結果は追記型JSONLにcheckpointし、最後にJSONへ集約する。
 *
 * 特徴量生成時は必ず history.date < targetRace.date とすること。
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const SOURCE_DIR = join(process.cwd(), "lib", "backfill");
const DEVELOPMENT_END_SLASH = "2026/06/21";

function arg(name: string, fallback: string): string {
  const value = process.argv.slice(2).find((v) => v.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : fallback;
}

const MODE = arg("mode", "all");
const OUT_DIR = join(process.cwd(), arg("out", "lib/backfill-stage1"));
if (!["lib/backfill-stage1", "lib/backfill-stage1-sample"].some((path) =>
  resolve(OUT_DIR) === resolve(process.cwd(), path))) {
  throw new Error("出力先はdevelopment専用のstage1ディレクトリに限定します");
}
const DELAY_MS = Number(arg("delay-ms", "1300"));
const MAX_HORSES = Number(arg("max-horses", "Infinity"));
const MAX_RACES = Number(arg("max-races", "Infinity"));
const HORSE_JSONL = join(OUT_DIR, "checkpoint", "horses.jsonl");
const RACE_JSONL = join(OUT_DIR, "checkpoint", "races.jsonl");
const FAILURE_JSONL = join(OUT_DIR, "checkpoint", "failures.jsonl");

type SourceHorse = { horseId: string; horse: string };
type SourceRace = {
  netKeibaRaceId: string;
  date: string;
  venue: string;
  raceName: string;
  horses: SourceHorse[];
};

type RawHistoryRow = {
  netKeibaRaceId: string | null;
  raceId: number | null;
  date: string;
  venueRaw: string | null;
  venue: string | null;
  raceName: string | null;
  weatherRaw: string | null;
  surface: "芝" | "ダ" | "障" | null;
  distance: number | null;
  trackConditionRaw: string | null;
  fieldSize: number | null;
  frameNumber: number | null;
  horseNumber: number | null;
  positionRaw: string | null;
  position: number | null;
  marginRaw: string | null;
  raceTimeRaw: string | null;
  cornerPositionsRaw: string | null;
  final3fRaw: string | null;
  jockey: string | null;
  jockeyId: string | null;
  carriedWeightRaw: string | null;
  horseWeightRaw: string | null;
  oddsRaw: string | null;
  popularity: number | null;
};

type ComboPayout = { combo: number[]; payout: number };
type SinglePayout = { horse: number; payout: number };
type PayoutResult = {
  status: "ok" | "missing" | "refund" | "not_offered" | "unparsed";
  rawCombination: string | null;
  rawPayout: string | null;
  entries: Array<ComboPayout | SinglePayout>;
  rows?: PayoutResult[];
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const clean = (value: string | undefined): string | null => {
  const v = (value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return v === "" ? null : v;
};
const intOrNull = (value: string | null): number | null => {
  if (!value || !/^-?\d+$/.test(value.replace(/,/g, ""))) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const stableRaceId = (id: string | null): number | null =>
  id && /^\d{12}$/.test(id) ? Number(id.slice(4)) : null;

function atomicWrite(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf-8").split(/\r?\n/).filter(Boolean);
  const rows: T[] = [];
  for (const [i, line] of lines.entries()) {
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      throw new Error(`${path}:${i + 1} が壊れています。修復するまで再開しません`);
    }
  }
  // 取得済み判定には履歴の日付ではなくチェックポイントのIDを使う。
  return rows; // Checkpoint completion uses IDs, not history dates.
}

function appendJsonl(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(value) + "\n", "utf-8");
}

async function fetchEuc(url: string): Promise<string> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(DELAY_MS * (attempt === 1 ? 1 : attempt));
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
          "Accept-Language": "ja,en-US;q=0.9",
        },
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new TextDecoder("euc-jp").decode(await response.arrayBuffer());
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function tableRows(html: string): Array<{ html: string; cells: Array<string | null> }> {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => ({
    html: row[0],
    cells: [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
      clean(cell[1])
    ),
  }));
}

function parseHorseHistory(html: string): RawHistoryRow[] {
  const rows: RawHistoryRow[] = [];
  for (const row of tableRows(html)) {
    const c = row.cells;
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(c[0] ?? "")) continue;
    const course = (c[14] ?? "").match(/^([芝ダ障])(\d{3,4})/);
    const raceId = row.html.match(/\/race\/(\d{12})\//)?.[1] ?? null;
    const jockeyId =
      row.html.match(/\/jockey\/(?:result\/recent\/)?(\d{5})\//)?.[1] ?? null;
    const venueRaw = c[1];
    const venue =
      venueRaw?.match(/札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉/)?.[0] ?? null;
    rows.push({
      netKeibaRaceId: raceId,
      raceId: stableRaceId(raceId),
      date: c[0]!,
      venueRaw,
      venue,
      raceName: c[4],
      weatherRaw: c[2],
      surface: course ? (course[1] as "芝" | "ダ" | "障") : null,
      distance: course ? Number(course[2]) : null,
      trackConditionRaw: c[16],
      fieldSize: intOrNull(c[6]),
      frameNumber: intOrNull(c[7]),
      horseNumber: intOrNull(c[8]),
      positionRaw: c[11],
      position: intOrNull(c[11]),
      marginRaw: c[19],
      raceTimeRaw: c[18],
      cornerPositionsRaw: c[25],
      final3fRaw: c[27],
      jockey: c[12],
      jockeyId,
      carriedWeightRaw: c[13],
      horseWeightRaw: c[28],
      oddsRaw: c[9],
      popularity: intOrNull(c[10]),
    });
  }
  return rows;
}

export function payoutRow(html: string, className: string, kind: "single" | "combo"): PayoutResult {
  const matches = tableRows(html).filter((r) =>
    new RegExp(`<th[^>]*class=["']${className}["']`, "i").test(r.html)
  );
  if (matches.length > 1) {
    const rows = matches.map((r) => payoutRow(r.html, className, kind));
    return {
      status: rows.every((r) => r.status === rows[0].status) ? rows[0].status : "unparsed",
      rawCombination: rows.map((r) => r.rawCombination ?? "").join("\n"),
      rawPayout: rows.map((r) => r.rawPayout ?? "").join("\n"),
      entries: rows.flatMap((r) => r.entries), rows,
    };
  }
  const row = matches[0];
  if (!row) return { status: "missing", rawCombination: null, rawPayout: null, entries: [] };
  const combo = row.cells[0];
  const payout = row.cells[1];
  const joined = `${combo ?? ""} ${payout ?? ""}`;
  if (/返還|特払/.test(joined)) {
    return { status: "refund", rawCombination: combo, rawPayout: payout, entries: [] };
  }
  if (/発売なし|不成立/.test(joined)) {
    return { status: "not_offered", rawCombination: combo, rawPayout: payout, entries: [] };
  }
  if (!combo || !payout) {
    return { status: "unparsed", rawCombination: combo, rawPayout: payout, entries: [] };
  }
  const combos = combo.split(/\s+/).filter(Boolean);
  const payouts = payout.split(/\s+/).filter(Boolean);
  const entries: Array<ComboPayout | SinglePayout> = [];
  for (let i = 0; i < combos.length; i++) {
    const amount = intOrNull(payouts[i] ?? null);
    if (amount == null) continue;
    const numbers = combos[i].split(/[-→]/).map(Number).filter(Number.isFinite);
    if (kind === "single" && numbers.length === 1) entries.push({ horse: numbers[0], payout: amount });
    if (kind === "combo" && numbers.length >= 2) entries.push({ combo: numbers, payout: amount });
  }
  return {
    status: entries.length > 0 ? "ok" : "unparsed",
    rawCombination: combo,
    rawPayout: payout,
    entries,
  };
}

function parseClass(raceName: string | null) {
  const raw = raceName;
  if (!raceName) return { raw, structured: null, grade: null };
  const gradeMatch = raceName.match(/\((J?G)(I{1,3}|[1-3])\)/i);
  let grade: string | null = null;
  if (gradeMatch) {
    const roman = gradeMatch[2].toUpperCase();
    const normalized = roman === "I" ? "1" : roman === "II" ? "2" : roman === "III" ? "3" : roman;
    grade = `${gradeMatch[1].toUpperCase()}${normalized}`;
  }
  let structured: string | null = null;
  if (grade) structured = grade;
  else if (/新馬/.test(raceName)) structured = "newcomer";
  else if (/未勝利/.test(raceName)) structured = "maiden";
  else if (/1勝/.test(raceName)) structured = "one_win";
  else if (/2勝/.test(raceName)) structured = "two_win";
  else if (/3勝/.test(raceName)) structured = "three_win";
  else if (/\(L\)|リステッド/.test(raceName)) structured = "listed";
  else if (/オープン|\(OP\)/i.test(raceName)) structured = "open";
  return { raw, structured, grade };
}

function parseRacePage(html: string, source: SourceRace) {
  const plain = clean(html) ?? "";
  const condition = plain.match(/(芝|ダ|障)[^/]{0,8}?(\d{3,4})m\s*\/\s*天候\s*:\s*([^/]+)\/\s*(?:芝|ダート|障害)\s*:\s*([^/]+)\/\s*発走\s*:\s*(\d{1,2}:\d{2})/);
  const rows = tableRows(html);
  const horses = rows
    .filter(
      (r) =>
        r.cells.length >= 18 &&
        /^(?:\d+|中|失|取|除|降)/.test(r.cells[0] ?? "") &&
        /\/horse\/\d{10}\//.test(r.html)
    )
    .map((row) => {
      const c = row.cells;
      const sexAge = c[4]?.match(/^(.)(\d+)$/);
      const horseId = row.html.match(/\/horse\/(\d{10})\//)?.[1] ?? null;
      const trainerId =
        row.html.match(/\/trainer\/(?:result\/recent\/)?(\d+)\//)?.[1] ?? null;
      const trainerRaw = c[22];
      return {
        horseId,
        horse: c[3],
        frameNumber: intOrNull(c[1]),
        horseNumber: intOrNull(c[2]),
        preRace: {
          sexAgeRaw: c[4],
          sex: sexAge?.[1] ?? null,
          age: sexAge ? Number(sexAge[2]) : null,
          carriedWeightRaw: c[5],
          carriedWeight: c[5] && /^\d+(?:\.\d+)?$/.test(c[5]) ? Number(c[5]) : null,
          jockey: c[6],
          jockeyId: row.html.match(/\/jockey\/(?:result\/recent\/)?(\d{5})\//)?.[1] ?? null,
          trainerRaw,
          trainer: trainerRaw?.replace(/^\[[^\]]+\]\s*/, "") ?? null,
          trainerId,
        },
        result: {
          positionRaw: c[0],
          raceTimeRaw: c[7],
          marginRaw: c[8],
          cornerPositionsRaw: c[14],
          final3fRaw: c[15],
          oddsRaw: c[16],
          popularity: intOrNull(c[17]),
          horseWeightRaw: c[18] ?? null,
        },
      };
    });
  return {
    netKeibaRaceId: source.netKeibaRaceId,
    date: source.date,
    venue: source.venue,
    raceName: source.raceName,
    fetchedAt: new Date().toISOString(),
    preRace: {
      trackConditionRaw: condition?.[4]?.trim() ?? null,
      weatherRaw: condition?.[3]?.trim() ?? null,
      postTimeRaw: condition?.[5] ?? null,
      class: parseClass(source.raceName),
    },
    horses,
    labels: {
      note: "発走後に確定する情報。発走前特徴量として使用禁止",
      payouts: {
        tan: payoutRow(html, "tan", "single"),
        fuku: payoutRow(html, "fuku", "single"),
        umaren: payoutRow(html, "uren", "combo"),
        wide: payoutRow(html, "wide", "combo"),
        umatan: payoutRow(html, "utan", "combo"),
        sanfuku: payoutRow(html, "sanfuku", "combo"),
        santan: payoutRow(html, "santan", "combo"),
      },
    },
  };
}

function loadSource(): { races: SourceRace[]; horses: Map<string, string> } {
  const source = JSON.parse(readFileSync(join(SOURCE_DIR, "races.json"), "utf-8")) as {
    races: Record<string, SourceRace>;
  };
  const races = Object.values(source.races).sort((a, b) => a.netKeibaRaceId.localeCompare(b.netKeibaRaceId));
  if (races.length !== 1338) throw new Error(`development以外を拒否: ${races.length}R`);
  const dates = races.map((r) => r.date).sort();
  if (dates[0] !== "2026-02-07" || dates.at(-1) !== "2026-06-21") {
    throw new Error(`development日付範囲ではありません: ${dates[0]}..${dates.at(-1)}`);
  }
  const horses = new Map<string, string>();
  for (const race of races) for (const horse of race.horses) horses.set(horse.horseId, horse.horse);
  if (horses.size !== 7851) throw new Error(`development馬集合ではありません: ${horses.size}頭`);
  return { races, horses };
}

async function collect() {
  const { races, horses } = loadSource();
  mkdirSync(join(OUT_DIR, "checkpoint"), { recursive: true });
  const completedHorses = new Set(readJsonl<{ horseId: string }>(HORSE_JSONL).map((v) => v.horseId));
  const completedRaces = new Set(readJsonl<{ netKeibaRaceId: string }>(RACE_JSONL).map((v) => v.netKeibaRaceId));
  if (completedHorses.size !== readJsonl(HORSE_JSONL).length ||
      completedRaces.size !== readJsonl(RACE_JSONL).length) {
    throw new Error("チェックポイントIDが重複しています。バックアップして確認してください");
  }
  const sourceRaceIds = new Set(races.map((r) => r.netKeibaRaceId));
  if ([...completedHorses].some((id) => !horses.has(id)) ||
      [...completedRaces].some((id) => !sourceRaceIds.has(id))) {
    throw new Error("チェックポイントにdevelopment集合外のIDがあります");
  }
  const horseTodo = [...horses].filter(([id]) => !completedHorses.has(id)).slice(0, MAX_HORSES);
  const raceTodo = races.filter((r) => !completedRaces.has(r.netKeibaRaceId)).slice(0, MAX_RACES);
  console.log(`development限定: 1338R / 7851頭`);
  console.log(`horse todo=${horseTodo.length}, race todo=${raceTodo.length}, delay=${DELAY_MS}ms`);

  for (const [index, [horseId, horse]] of horseTodo.entries()) {
    try {
      const html = await fetchEuc(`https://db.netkeiba.com/horse/result/${horseId}/`);
      const rows = parseHorseHistory(html);
      if (rows.length === 0) throw new Error("戦績行0件");
      appendJsonl(HORSE_JSONL, { horseId, horse, fetchedAt: new Date().toISOString(), rows });
    } catch (error) {
      appendJsonl(FAILURE_JSONL, {
        at: new Date().toISOString(), type: "horse", id: horseId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if ((index + 1) % 25 === 0) console.log(`horses ${index + 1}/${horseTodo.length}`);
  }

  for (const [index, race] of raceTodo.entries()) {
    try {
      const html = await fetchEuc(`https://db.netkeiba.com/race/${race.netKeibaRaceId}/`);
      const parsed = parseRacePage(html, race);
      if (parsed.horses.length === 0) throw new Error("結果行0件");
      appendJsonl(RACE_JSONL, parsed);
    } catch (error) {
      appendJsonl(FAILURE_JSONL, {
        at: new Date().toISOString(), type: "race", id: race.netKeibaRaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if ((index + 1) % 25 === 0) console.log(`races ${index + 1}/${raceTodo.length}`);
  }
}

function fieldStats(rows: RawHistoryRow[], field: keyof RawHistoryRow) {
  const present = rows.filter((row) => row[field] !== null && row[field] !== "").length;
  return { present, missing: rows.length - present, missingRate: rows.length ? (rows.length - present) / rows.length : 0 };
}

function finalize() {
  const source = loadSource();
  const horseRows = readJsonl<{ horseId: string; horse: string; fetchedAt: string; rows: RawHistoryRow[] }>(HORSE_JSONL)
    .map((horse) => ({ ...horse, rows: horse.rows.filter((row) =>
      /^\d{4}\/\d{2}\/\d{2}$/.test(row.date) && row.date <= DEVELOPMENT_END_SLASH
    ) })); // Inspect only dates; never expose post-development history in ordinary outputs.
  const raceRows = readJsonl<ReturnType<typeof parseRacePage>>(RACE_JSONL);
  const horseIds = new Set(horseRows.map((r) => r.horseId));
  const raceIds = new Set(raceRows.map((r) => r.netKeibaRaceId));
  const sourceIds = new Set(source.races.map((r) => r.netKeibaRaceId));
  if (horseRows.length !== source.horses.size || horseIds.size !== horseRows.length ||
      raceRows.length !== source.races.length || raceIds.size !== raceRows.length ||
      [...horseIds].some((id) => !source.horses.has(id)) ||
      [...raceIds].some((id) => !sourceIds.has(id))) {
    throw new Error("取得が未完了、重複、またはdevelopment集合と不一致です");
  }
  const horseMap = Object.fromEntries(horseRows.map((row) => [row.horseId, row]));
  const raceMap = Object.fromEntries(raceRows.map((row) => [row.netKeibaRaceId, row]));
  const allHistory = horseRows.flatMap((row) => row.rows);
  const historyFields = Object.keys(allHistory[0] ?? {}) as Array<keyof RawHistoryRow>;
  const payoutCounts = Object.fromEntries(
    ["tan", "fuku", "umaren", "wide", "umatan", "sanfuku", "santan"].map((kind) => [
      kind,
      raceRows.filter((race) =>
        race.labels.payouts[kind as keyof typeof race.labels.payouts].status === "ok"
      ).length,
    ])
  );
  const failures = readJsonl<Record<string, unknown>>(FAILURE_JSONL);
  const report = {
    generatedAt: new Date().toISOString(),
    source: { races: source.races.length, uniqueHorses: source.horses.size },
    collected: { races: raceRows.length, horses: horseRows.length, historyRows: allHistory.length },
    historyFields: Object.fromEntries(historyFields.map((field) => [field, fieldStats(allHistory, field)])),
    raceFields: {
      trackCondition: raceRows.filter((r) => r.preRace.trackConditionRaw != null).length,
      structuredClass: raceRows.filter((r) => r.preRace.class.structured != null).length,
      grade: raceRows.filter((r) => r.preRace.class.grade != null).length,
      horseRows: raceRows.reduce((n, r) => n + r.horses.length, 0),
      sexAge: raceRows.flatMap((r) => r.horses).filter((h) => h.preRace.sex != null && h.preRace.age != null).length,
      carriedWeight: raceRows.flatMap((r) => r.horses).filter((h) => h.preRace.carriedWeightRaw != null).length,
      trainer: raceRows.flatMap((r) => r.horses).filter((h) => h.preRace.trainer != null).length,
      trainerId: raceRows.flatMap((r) => r.horses).filter((h) => h.preRace.trainerId != null).length,
    },
    payoutOkRaces: payoutCounts,
    checkpointFailuresLogged: failures.length,
    invariants: {
      developmentOnly: true,
      fixedEvaluationAccessed: false,
      historyFeatureRule: "history.date < targetRace.date (同日を含めない)",
      resultFieldsAreLabels: true,
    },
  };
  atomicWrite(join(OUT_DIR, "horse-history-raw.json"), {
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    source: "db.netkeiba.com/horse/result/{horseId}/",
    leakageRule: "特徴量生成時は history.date < targetRace.date。同日・対象レース・未来を除外する",
    horses: horseMap,
  });
  atomicWrite(join(OUT_DIR, "race-details-raw.json"), {
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    source: "db.netkeiba.com/race/{netKeibaRaceId}/",
    separation: "preRaceは発走前情報、result/labelsは評価専用",
    races: raceMap,
  });
  atomicWrite(join(OUT_DIR, "quality-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  if (!existsSync(join(SOURCE_DIR, "races.json"))) throw new Error("development入力がありません");
  mkdirSync(OUT_DIR, { recursive: true });
  const lockPath = join(OUT_DIR, "collection.lock");
  const lock = openSync(lockPath, "wx"); // Existing lock requires manual process/state verification.
  try {
    if (MODE === "collect" || MODE === "all") await collect();
    if (MODE === "finalize" || MODE === "all") finalize();
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

if (resolve(process.argv[1] ?? "") === resolve(process.cwd(), "scripts/backfill-enrich-raw.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
