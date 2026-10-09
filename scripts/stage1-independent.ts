/** Pure independent prediction/training. No filesystem or market access. */
import { developmentDate, frozenClone, isoDate, sha256 } from "./simulator/canonical";
import { assertPreRaceInput } from "./simulator/runner";
import type { Model, PreRaceInput, Truth } from "./simulator/types";

export const SETTINGS = frozenClone({ version: "stage1-independent-minimal-v1", iterations: 200,
  learningRate: 0.1, l2: 0.01, temperature: 1, recentRuns: 3, distanceBandMetres: 200,
  calibration: "not performed; uncalibrated probabilities", tieBreak: "horseNumber" });
export const FEATURES = ["recentFinish", "surfaceFinish", "distanceFinish", "historyCount", "restDays"] as const;
type Past = { raceId: string | null; date: string; surface: string | null; distance: number | null;
  position: number | null; positionRaw: string | null; fieldSize: number | null };
export type IndependentInput = { raceId: string; date: string; surface: string; distance: number;
  horses: { horseId: string; horseNumber: number; history: Past[] }[] };
type Feature = { name: string; value: number | null; missingReason: string | null; sourceRows: Past[]; unit: string };
export type FeaturedRace = { raceId: string; date: string; horses: {
  horseId: string; horseNumber: number; features: Feature[] }[] };
export type Example = { input: FeaturedRace; winnerId: string };
export type Artifact = { settings: typeof SETTINGS; features: readonly string[]; trainedThroughDate: string;
  trainingRaceIds: string[]; excluded: { raceId: string; reason: string }[];
  means: number[]; weights: number[]; trainingSha256: string };

/** Explicit second projection removes even historical odds/popularity and free text. */
export function independentInput(input: PreRaceInput): IndependentInput {
  assertPreRaceInput(input);
  const projected = frozenClone({ raceId: input.raceId, date: input.date, surface: input.surface,
    distance: input.distance, horses: input.horses.map(h => ({ horseId: h.horseId,
      horseNumber: h.horseNumber, history: h.history.map(r => ({ raceId: r.netKeibaRaceId,
        date: isoDate(r.date), surface: r.surface, distance: r.distance, position: r.position,
        positionRaw: r.positionRaw, fieldSize: r.fieldSize })) })) });
  assertIndependent(projected); return projected;
}
export function assertIndependent(input: IndependentInput) {
  const keys = (o: object, allowed: string[]) => {
    if (Object.keys(o).some(k => !allowed.includes(k))) throw new Error("Unapproved independent input column");
  };
  keys(input, ["raceId", "date", "surface", "distance", "horses"]);
  const date = developmentDate(input.date);
  if (!Number.isFinite(input.distance) || input.distance <= 0 || !input.horses.length) throw new Error("Invalid race input");
  if (new Set(input.horses.map(h => h.horseId)).size !== input.horses.length ||
      new Set(input.horses.map(h => h.horseNumber)).size !== input.horses.length) throw new Error("Duplicate starter");
  for (const h of input.horses) {
    keys(h, ["horseId", "horseNumber", "history"]);
    if (!Number.isInteger(h.horseNumber) || h.horseNumber < 1) throw new Error("Invalid horse number");
    for (const r of h.history) {
      keys(r, ["raceId", "date", "surface", "distance", "position", "positionRaw", "fieldSize"]);
      if (isoDate(r.date) >= date || r.raceId === input.raceId) throw new Error("Future/same-day/target history");
    }
  }
}
const validFinish = (r: Past) => Number.isInteger(r.position) && Number.isInteger(r.fieldSize) &&
  r.fieldSize! >= 2 && r.position! >= 1 && r.position! <= r.fieldSize! &&
  r.positionRaw !== null && /^\d+$/.test(r.positionRaw) && Number(r.positionRaw) === r.position;
export function derive(input: IndependentInput): FeaturedRace {
  assertIndependent(input);
  return frozenClone({ raceId: input.raceId, date: input.date, horses: [...input.horses]
    .sort((a, b) => a.horseNumber - b.horseNumber).map(h => {
      const past = [...h.history].sort((a, b) => b.date.localeCompare(a.date) ||
        (a.raceId ?? "").localeCompare(b.raceId ?? ""));
      const finish = (name: string, rows: Past[]): Feature => {
        const selected = rows.filter(validFinish).slice(0, SETTINGS.recentRuns);
        return { name, value: selected.length ? selected.reduce((s, r) => s +
          (r.fieldSize! - r.position!) / (r.fieldSize! - 1), 0) / selected.length : null,
        missingReason: selected.length ? null : past.length ? "no valid matching finish" : "no prior history",
        sourceRows: selected, unit: "normalized finish [0,1]" };
      };
      const days = past.length ? (Date.parse(input.date) - Date.parse(past[0].date)) / 86400000 : null;
      return { horseId: h.horseId, horseNumber: h.horseNumber, features: [
        finish("recentFinish", past), finish("surfaceFinish", past.filter(r => r.surface === input.surface)),
        finish("distanceFinish", past.filter(r => r.surface === input.surface && r.distance !== null &&
          Math.abs(r.distance - input.distance) <= SETTINGS.distanceBandMetres)),
        { name: "historyCount", value: Math.min(past.length, 10) / 10, missingReason: null,
          sourceRows: past, unit: "min(history count,10)/10" },
        { name: "restDays", value: days === null ? null : Math.min(days, 365) / 365,
          missingReason: days === null ? "no prior history" : null,
          sourceRows: past.slice(0, 1), unit: "min(days,365)/365" },
      ] };
    }) });
}
export function unsupported(input: FeaturedRace, surface: string): string | null {
  if (!["芝", "ダ"].includes(surface)) return "unsupported surface (including obstacles)";
  if (input.horses.every(h => h.features[0].value === null)) return "all horses lack valid prior finishes";
  return null;
}
function vector(features: Feature[], means: number[]) {
  return [...features.map((f, i) => (f.value ?? means[i]) - means[i]),
    ...features.map(f => f.value === null ? 1 : 0)];
}
export function softmax(scores: number[]): number[] {
  const max = Math.max(...scores), exp = scores.map(s => Math.exp(s - max));
  const total = exp.reduce((s, x) => s + x, 0); return exp.map(x => x / total);
}
export function trainingExample(input: FeaturedRace, truth: Truth, cutoff: string): Example | string {
  developmentDate(input.date); developmentDate(cutoff);
  if (input.date > cutoff || truth.date !== input.date || truth.raceId !== input.raceId) throw new Error("Training date/ID guard");
  const starters = new Set(input.horses.map(h => h.horseId));
  const winners = truth.horses.filter(h => starters.has(h.horseId) && h.positionRaw === "1");
  if (winners.length !== 1) return "missing or dead-heat winner";
  return { input, winnerId: winners[0].horseId };
}
/** One fixed full-batch fit per calendar window; no search/early stopping/metric reporting. */
export function train(examples: Example[], cutoff: string, excluded: Artifact["excluded"] = []): Artifact {
  developmentDate(cutoff);
  if (!examples.length || new Set(examples.map(e => e.input.raceId)).size !== examples.length) throw new Error("Empty/duplicate training set");
  const ordered = [...examples].sort((a, b) => a.input.date.localeCompare(b.input.date) || a.input.raceId.localeCompare(b.input.raceId));
  for (const e of ordered) {
    developmentDate(e.input.date);
    if (e.input.date > cutoff || !e.input.horses.some(h => h.horseId === e.winnerId)) throw new Error("Invalid training example");
    for (const h of e.input.horses) for (const f of h.features) for (const r of f.sourceRows) {
      if (isoDate(r.date) >= e.input.date || r.raceId === e.input.raceId) throw new Error("Leaked training feature");
    }
  }
  const means = FEATURES.map((_, i) => {
    const values = ordered.flatMap(e => e.input.horses.map(h => h.features[i].value)).filter((v): v is number => v !== null);
    if (!values.length) throw new Error("No training observations for feature");
    return values.reduce((s, v) => s + v, 0) / values.length;
  });
  const rows = ordered.map(e => ({ winner: e.input.horses.findIndex(h => h.horseId === e.winnerId),
    x: e.input.horses.map(h => vector(h.features, means)) }));
  const weights = Array<number>(FEATURES.length * 2).fill(0);
  for (let step = 0; step < SETTINGS.iterations; step++) {
    const gradient = weights.map(w => SETTINGS.l2 * w);
    for (const race of rows) {
      const p = softmax(race.x.map(x => x.reduce((s, v, j) => s + v * weights[j], 0)));
      race.x.forEach((x, i) => x.forEach((v, j) => { gradient[j] += (p[i] - Number(i === race.winner)) * v / rows.length; }));
    }
    weights.forEach((w, j) => { weights[j] = w - SETTINGS.learningRate * gradient[j]; });
  }
  if (weights.some(w => !Number.isFinite(w))) throw new Error("Non-finite fitted weight");
  return frozenClone({ settings: SETTINGS, features: FEATURES, trainedThroughDate: cutoff,
    trainingRaceIds: ordered.map(e => e.input.raceId), excluded, means, weights, trainingSha256: sha256(ordered) });
}
export function model(artifact: Artifact, codeSha256: string): Model {
  return { identity: { name: "stage1-independent", version: SETTINGS.version, codeSha256,
    trainedThroughDate: artifact.trainedThroughDate, config: { settings: SETTINGS, artifactSha256: sha256(artifact) } },
  predict(input) {
    if (input.date <= artifact.trainedThroughDate || artifact.trainingRaceIds.includes(input.raceId)) throw new Error("In-sample/future-trained prediction rejected");
    const featured = derive(independentInput(input));
    if (unsupported(featured, input.surface)) throw new Error("Unsupported prediction; retain status instead");
    const explanations = featured.horses.map(h => {
      const x = vector(h.features, artifact.means);
      const reasons = x.map((v, j) => {
        const f = h.features[j % FEATURES.length];
        return { name: j < FEATURES.length ? f.name : `${f.name}:missing`,
          rawValue: { value: f.value, transformed: v, unit: f.unit, missingReason: f.missingReason,
            sourceRows: f.sourceRows, trainingMean: artifact.means[j % FEATURES.length], weight: artifact.weights[j] },
          contribution: v * artifact.weights[j], explanation: "Fixed additive model; training-only mean and missing indicator, not causal attribution" };
      });
      return { horseId: h.horseId, reasons, score: reasons.reduce((s, r) => s + r.contribution, 0) };
    });
    const p = softmax(explanations.map(h => h.score / SETTINGS.temperature));
    return explanations.map((h, i) => ({ horseId: h.horseId, probability: p[i], reasons: h.reasons }));
  } };
}
