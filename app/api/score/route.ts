import { NextResponse } from "next/server";
import { calculateScore } from "@/lib/engine";
import { races, horses, horseFeatures, marketOdds } from "@/lib/mockData";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raceId = Number(searchParams.get("raceId")) || 1;

  const race = races.find((r) => r.id === raceId);
  if (!race) {
    return NextResponse.json({ error: "Race not found" }, { status: 404 });
  }

  const raceHorses = horses.filter((h) => h.raceId === raceId);

  const inputs = raceHorses.map((h) => {
    const features = horseFeatures.find((f) => f.horseId === h.id)!;
    const odds = marketOdds.find((o) => o.horseId === h.id)!;
    return {
      id: h.id,
      name: h.horse,
      formScore: features.formScore / 100,
      pedigreeScore: features.pedigreeScore / 100,
      trainingScore: features.trainingScore / 100,
      jockeyScore: features.jockeyScore / 100,
      odds: odds.odds,
    };
  });

  const result = calculateScore(inputs);

  const featuresById = new Map(
    raceHorses.map((h) => {
      const f = horseFeatures.find((f) => f.horseId === h.id)!;
      return [h.id, f];
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
        ? { form: f.formScore, pedigree: f.pedigreeScore, training: f.trainingScore, jockey: f.jockeyScore }
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
    finalScores: result.finalScores.map(toHorseShape),
    valueRanking: result.valueRanking.map(toHorseShape),
    evRanking: result.evRanking.map(toHorseShape),
    edgeRanking: result.edgeRanking.map(toHorseShape),
  });
}