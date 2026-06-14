import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";
import { calculateScore } from "@/lib/engine";
import { races, horses, horseFeatures, marketOdds } from "@/lib/mockData";
import type { HorseScores } from "@/lib/scorer";

// ── キャッシュ読み込み（fetch-scores スクリプト実行後に有効になる）─────────

type ScoresCache = Record<number, HorseScores>;

function loadScoresCache(): ScoresCache {
  try {
    const p = join(process.cwd(), "lib", "scores-cache.json");
    if (!existsSync(p)) return {};
    const raw = JSON.parse(readFileSync(p, "utf-8")) as {
      scores?: Record<string, HorseScores>;
    };
    // キーは文字列で保存されているので数値変換
    const result: ScoresCache = {};
    for (const [k, v] of Object.entries(raw.scores ?? {})) {
      result[Number(k)] = v;
    }
    return result;
  } catch {
    return {};
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raceId = Number(searchParams.get("raceId")) || 1;

  const race = races.find((r) => r.id === raceId);
  if (!race) {
    return NextResponse.json({ error: "Race not found" }, { status: 404 });
  }

  const scoresCache = loadScoresCache();
  const usingCache = Object.keys(scoresCache).length > 0;

  const raceHorses = horses.filter((h) => h.raceId === raceId);

  const inputs = raceHorses.map((h) => {
    const cached = scoresCache[h.id];
    const fallback = horseFeatures.find((f) => f.horseId === h.id)!;
    const odds = marketOdds.find((o) => o.horseId === h.id)!;

    // キャッシュ（実データ）があればそちらを優先、なければ mockData を使用
    const formScore = (cached?.formScore ?? fallback.formScore) / 100;
    const pedigreeScore = (cached?.pedigreeScore ?? fallback.pedigreeScore) / 100;
    const trainingScore = (cached?.trainingScore ?? fallback.trainingScore) / 100;
    const jockeyScore = (cached?.jockeyScore ?? fallback.jockeyScore) / 100;

    return {
      id: h.id,
      name: h.horse,
      formScore,
      pedigreeScore,
      trainingScore,
      jockeyScore,
      odds: odds.odds,
    };
  });

  const result = calculateScore(inputs);

  const featuresById = new Map(
    raceHorses.map((h) => {
      const cached = scoresCache[h.id];
      const fallback = horseFeatures.find((f) => f.horseId === h.id)!;
      return [
        h.id,
        {
          formScore: cached?.formScore ?? fallback.formScore,
          pedigreeScore: cached?.pedigreeScore ?? fallback.pedigreeScore,
          trainingScore: cached?.trainingScore ?? fallback.trainingScore,
          jockeyScore: cached?.jockeyScore ?? fallback.jockeyScore,
        },
      ];
    })
  );

  const toHorseShape = (h: (typeof result.finalScores)[number]) => {
    const f = featuresById.get(h.id);
    return {
      horse: h.name,
      odds: h.odds,
      pTrue: h.probability,
      p_market: h.marketProb,
      edge: h.edge,
      ev: h.ev,
      valueRating: h.valueRating,
      features: f
        ? {
            form: f.formScore,
            pedigree: f.pedigreeScore,
            training: f.trainingScore,
            jockey: f.jockeyScore,
          }
        : null,
    };
  };

  return NextResponse.json({
    raceId: race.id,
    raceName: race.raceName,
    date: race.date,
    venue: race.venue,
    raceNumber: race.raceNumber,
    postTime: race.postTime,
    dataSource: usingCache ? "netkeiba (実データ)" : "mockData (推定値)",
    finalScores: result.finalScores.map(toHorseShape),
    valueRanking: result.valueRanking.map(toHorseShape),
    evRanking: result.evRanking.map(toHorseShape),
    edgeRanking: result.edgeRanking.map(toHorseShape),
  });
}
