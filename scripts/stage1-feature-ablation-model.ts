/** Fixed B/C retraining only; existing A/D implementations remain untouched. */
import { developmentDate, frozenClone, isoDate, sha256 } from "./simulator/canonical";
import type { Model } from "./simulator/types";
import { RACE_KIND_VERSION } from "./simulator/race-kind";
import { derive, independentInput, unsupported, softmax, SETTINGS, FEATURES } from "./stage1-independent-v2";
import type { Artifact as V2Artifact, Example, FeaturedRace } from "./stage1-independent-v2";

export type Variant = "B" | "C";
export function featureNames(variant: Variant) {
  if (variant !== "B" && variant !== "C") throw new Error("Only fixed variants B/C");
  return [...FEATURES.slice(0,5), variant === "B" ? "cornerPosition" : "weightChange"];
}
export function configuration(variant: Variant) {
  featureNames(variant);
  return frozenClone({ ...SETTINGS, version: "stage1-independent-ablation-" + variant });
}
export type Artifact = Omit<V2Artifact, "settings"> & { variant: Variant; settings: ReturnType<typeof configuration> };
export function subset(input: FeaturedRace, variant: Variant): FeaturedRace {
  const names = featureNames(variant);
  if (input.inputClassificationVersion !== RACE_KIND_VERSION) throw new Error("Legacy classification");
  developmentDate(input.date);
  return frozenClone({ ...input, horses: input.horses.map(h => {
    if (h.features.map(f=>f.name).join("|") !== FEATURES.join("|")) throw new Error("Unexpected source feature columns");
    const selected = h.features.filter(f=>names.includes(f.name));
    for (const f of selected) {
      if (f.value !== null && !Number.isFinite(f.value)) throw new Error("Invalid feature number");
      for (const row of f.sourceRows) {
        if (Object.keys(row).some(k=>!["raceId","date","surface","distance","position","positionRaw","fieldSize","eligibleJra","cornerPositionsRaw","carriedWeightRaw"].includes(k))) throw new Error("Unapproved feature source column");
        if (isoDate(row.date) >= input.date || row.raceId === input.raceId) throw new Error("Leaked feature");
      }
    }
    return { ...h, features: selected };
  }) });
}
function vector(features: FeaturedRace["horses"][number]["features"], means: number[]) {
  return [...features.map((f,i)=>(f.value ?? means[i])-means[i]), ...features.map(f=>f.value===null ? 1 : 0)];
}
/** One fixed full-batch fit per calendar window; no search/early stopping/metric reporting. */
export function train(variant: Variant, examples: Example[], cutoff: string, excluded: Artifact["excluded"] = []): Artifact {
  const features = featureNames(variant), settings = configuration(variant);
  examples = examples.map(e => ({ ...e, input: subset(e.input, variant) }));
  developmentDate(cutoff);
  if (!examples.length || new Set(examples.map(e => e.input.raceId)).size !== examples.length) throw new Error("Empty/duplicate training set");
  const ordered = [...examples].sort((a, b) => a.input.date.localeCompare(b.input.date) || a.input.raceId.localeCompare(b.input.raceId));
  for (const e of ordered) {
    if (e.input.inputClassificationVersion !== RACE_KIND_VERSION) throw new Error("Legacy classification training example rejected");
    developmentDate(e.input.date);
    if (e.input.date > cutoff || !e.input.horses.some(h => h.horseId === e.winnerId)) throw new Error("Invalid training example");
    for (const h of e.input.horses) for (const f of h.features) for (const r of f.sourceRows) {
      if (isoDate(r.date) >= e.input.date || r.raceId === e.input.raceId) throw new Error("Leaked training feature");
    }
  }
  const means = features.map((_, i) => {
    const values = ordered.flatMap(e => e.input.horses.map(h => h.features[i].value)).filter((v): v is number => v !== null);
    if (!values.length) throw new Error("No training observations for feature");
    return values.reduce((s, v) => s + v, 0) / values.length;
  });
  const rows = ordered.map(e => ({ winner: e.input.horses.findIndex(h => h.horseId === e.winnerId),
    x: e.input.horses.map(h => vector(h.features, means)) }));
  const weights = Array<number>(features.length * 2).fill(0);
  for (let step = 0; step < settings.iterations; step++) {
    const gradient = weights.map(w => settings.l2 * w);
    for (const race of rows) {
      const p = softmax(race.x.map(x => x.reduce((s, v, j) => s + v * weights[j], 0)));
      race.x.forEach((x, i) => x.forEach((v, j) => { gradient[j] += (p[i] - Number(i === race.winner)) * v / rows.length; }));
    }
    weights.forEach((w, j) => { weights[j] = w - settings.learningRate * gradient[j]; });
  }
  if (weights.some(w => !Number.isFinite(w))) throw new Error("Non-finite fitted weight");
  return frozenClone({ inputClassificationVersion: RACE_KIND_VERSION, variant, settings, features, trainedThroughDate: cutoff,
    trainingRaceIds: ordered.map(e => e.input.raceId), excluded, means, weights, trainingSha256: sha256(ordered) });
}
export function model(artifact: Artifact, codeSha256: string): Model {
  const features = featureNames(artifact.variant), settings = configuration(artifact.variant);
  if (sha256(artifact.settings) !== sha256(settings) || artifact.weights.length !== 12 || artifact.means.length !== 6 || [...artifact.weights, ...artifact.means].some(x => !Number.isFinite(x))) throw new Error("Invalid ablation artifact");
  if (artifact.settings.version !== settings.version || artifact.features.join("|") !== features.join("|")) throw new Error("Model version/features mismatch");
  if (artifact.inputClassificationVersion !== RACE_KIND_VERSION) throw new Error("Legacy classification artifact rejected; separate retraining approval required");
  return { identity: { name: "stage1-independent", version: settings.version, codeSha256,
    trainedThroughDate: artifact.trainedThroughDate, config: { settings: settings, artifactSha256: sha256(artifact) } },
  predict(input) {
    if (input.date <= artifact.trainedThroughDate || artifact.trainingRaceIds.includes(input.raceId)) throw new Error("In-sample/future-trained prediction rejected");
    const featured = subset(derive(independentInput(input)), artifact.variant);
    if (unsupported(featured, input.surface)) throw new Error("Unsupported prediction; retain status instead");
    const explanations = featured.horses.map(h => {
      const x = vector(h.features, artifact.means);
      const reasons = x.map((v, j) => {
        const f = h.features[j % features.length];
        return { name: j < features.length ? f.name : `${f.name}:missing`,
          rawValue: { value: f.value, transformed: v, unit: f.unit, missingReason: f.missingReason, details: f.details ?? null,
            sourceRows: f.sourceRows, trainingMean: artifact.means[j % features.length], weight: artifact.weights[j] },
          contribution: v * artifact.weights[j], explanation: "Fixed additive model; training-only mean and missing indicator, not causal attribution" };
      });
      return { horseId: h.horseId, reasons, score: reasons.reduce((s, r) => s + r.contribution, 0) };
    });
    const p = softmax(explanations.map(h => h.score / settings.temperature));
    return explanations.map((h, i) => ({ horseId: h.horseId, probability: p[i], reasons: h.reasons }));
  } };
}
