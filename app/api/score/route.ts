import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";
import { calculateScore } from "@/lib/engine";
import { calcComboBets } from "@/lib/combination-ev";
import { races, horses, horseFeatures, marketOdds } from "@/lib/mockData";
import type { HorseScores } from "@/lib/scorer";
import type { RacesCache, CachedRace } from "@/scripts/fetch-races";

// ── キャッシュ読み込み ─────────────────────────────────────────────────────────

type ScoresCache = Record<number, HorseScores>;

function loadScoresCache(): ScoresCache {
  try {
    const p = join(process.cwd(), "lib", "scores-cache.json");
    if (!existsSync(p)) return {};
    const raw = JSON.parse(readFileSync(p, "utf-8")) as { scores?: Record<string, HorseScores> };
    const result: ScoresCache = {};
    for (const [k, v] of Object.entries(raw.scores ?? {})) result[Number(k)] = v;
    return result;
  } catch {
    return {};
  }
}

function loadRacesCache(): RacesCache | null {
  try {
    const p = join(process.cwd(), "lib", "races-cache.json");
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf-8")) as RacesCache;
    return raw.races?.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raceId = Number(searchParams.get("raceId")) || 1;

  const scoresCache = loadScoresCache();
  const racesCache = loadRacesCache();

  // races-cache.json があれば優先使用
  let race: { id: number; raceName: string; date: string; venue: string; raceNumber: number; postTime: string } | undefined;
  let raceHorses: Array<{ id: number; horse: string; horseNumber: number; odds: number | null; jockey?: string }> = [];
  let usingRacesCache = false;

  if (racesCache) {
    const cr: CachedRace | undefined = racesCache.races.find((r) => r.id === raceId);
    if (cr) {
      race = { id: cr.id, raceName: cr.raceName, date: cr.date, venue: cr.venue, raceNumber: cr.raceNumber, postTime: cr.postTime };
      raceHorses = cr.horses.map((h) => ({ id: h.id, horse: h.horse, horseNumber: h.horseNumber, odds: h.odds, jockey: h.jockey }));
      usingRacesCache = true;
    }
  }

  // フォールバック: mockData
  if (!race) {
    const mr = races.find((r) => r.id === raceId);
    if (!mr) return NextResponse.json({ error: "Race not found" }, { status: 404 });
    race = mr;
    raceHorses = horses
      .filter((h) => h.raceId === raceId)
      .map((h, i) => ({ id: h.id, horse: h.horse, horseNumber: (h as { horseNumber?: number }).horseNumber ?? (i + 1), odds: marketOdds.find((o) => o.horseId === h.id)?.odds ?? null }));
  }

  const usingScoresCache = Object.keys(scoresCache).length > 0;

  // エントリー未発表チェック
  if (usingRacesCache) {
    const cr = racesCache?.races.find((r) => r.id === raceId);
    if (cr?.entriesPending) {
      return NextResponse.json({
        raceId: race.id, raceName: race.raceName, date: race.date, venue: race.venue,
        raceNumber: race.raceNumber, postTime: race.postTime,
        entriesPending: true, oddsUnavailable: false,
        dataSource: "出走登録前", finalScores: [], valueRanking: [], evRanking: [], edgeRanking: [],
      });
    }
  }

  // odds が全頭 null の場合は EV 計算不可
  const horsesWithOdds = raceHorses.filter((h) => h.odds != null && h.odds > 0);
  if (horsesWithOdds.length === 0) {
    return NextResponse.json({
      raceId: race.id, raceName: race.raceName, date: race.date, venue: race.venue,
      raceNumber: race.raceNumber, postTime: race.postTime,
      entriesPending: false, oddsUnavailable: true,
      dataSource: "出走登録済み（オッズ未確定）",
      finalScores: [], valueRanking: [], evRanking: [], edgeRanking: [],
    });
  }

  const inputs = horsesWithOdds.map((h) => {
    const cached = scoresCache[h.id];

    // mockData の horseFeatures を探す（フォールバック用）
    const fallback = !usingRacesCache
      ? horseFeatures.find((f) => f.horseId === h.id)
      : undefined;

    const DEFAULT = 65;
    // form/pedigree は常に数値。training/jockey は欠損を null として保持
    // （cached エントリがあればその null を尊重し、DEFAULT で埋め戻さない）。
    const formScore = (cached?.formScore ?? fallback?.formScore ?? DEFAULT) / 100;
    const pedigreeScore = (cached?.pedigreeScore ?? fallback?.pedigreeScore ?? DEFAULT) / 100;
    const rawTraining = cached ? (cached.trainingScore ?? null) : (fallback?.trainingScore ?? DEFAULT);
    const rawJockey = cached ? (cached.jockeyScore ?? null) : (fallback?.jockeyScore ?? DEFAULT);
    const trainingScore = rawTraining == null ? null : rawTraining / 100;
    const jockeyScore = rawJockey == null ? null : rawJockey / 100;

    return { id: h.id, name: h.horse, formScore, pedigreeScore, trainingScore, jockeyScore, odds: h.odds! };
  });

  const result = calculateScore(inputs);

  const featuresById = new Map(
    horsesWithOdds.map((h) => {
      const cached = scoresCache[h.id];
      const fallback = !usingRacesCache ? horseFeatures.find((f) => f.horseId === h.id) : undefined;
      const DEFAULT = 65;
      return [h.id, {
        formScore: cached?.formScore ?? fallback?.formScore ?? DEFAULT,
        pedigreeScore: cached?.pedigreeScore ?? fallback?.pedigreeScore ?? DEFAULT,
        trainingScore: cached?.trainingScore ?? fallback?.trainingScore ?? DEFAULT,
        jockeyScore: cached?.jockeyScore ?? fallback?.jockeyScore ?? DEFAULT,
      }];
    })
  );

  const horseNumberById = new Map(horsesWithOdds.map((h) => [h.id, h.horseNumber]));

  const toShape = (h: (typeof result.finalScores)[number]) => {
    const f = featuresById.get(h.id);
    return {
      horse: h.name,
      horseNumber: horseNumberById.get(h.id) ?? 0,
      odds: h.odds,
      pTrue: h.probability,
      p_market: h.marketProb,
      edge: h.edge,
      ev: h.ev,
      valueRating: h.valueRating,
      features: f ? { form: f.formScore, pedigree: f.pedigreeScore, training: f.trainingScore, jockey: f.jockeyScore } : null,
    };
  };

  const harvilleInputs = result.finalScores.map((h) => ({
    name: h.name,
    horseNumber: horseNumberById.get(h.id) ?? 0,
    probability: h.probability,
    marketProb: h.marketProb,
  }));
  const comboBets = calcComboBets(harvilleInputs);

  const dataSource = usingRacesCache
    ? usingScoresCache ? "netkeiba（実データ）" : "netkeiba 出馬表（スコアはデフォルト値）"
    : usingScoresCache ? "netkeiba（実データ）" : "mockData（推定値）";

  return NextResponse.json({
    raceId: race.id,
    raceName: race.raceName,
    date: race.date,
    venue: race.venue,
    raceNumber: race.raceNumber,
    postTime: race.postTime,
    oddsUnavailable: false,
    dataSource,
    finalScores: result.finalScores.map(toShape),
    valueRanking: result.valueRanking.map(toShape),
    evRanking: result.evRanking.map(toShape),
    edgeRanking: result.edgeRanking.map(toShape),
    comboBets,
  });
}
