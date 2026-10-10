import { canonical, developmentDate, frozenClone, isoDate, sha256 } from "./canonical";
import { TICKET_KINDS } from "./input";
import { prepareInputV2 as prepareInput } from "../stage1-v2-input";
import { classifyRaceKind } from "./race-kind";
import type { Context, Dataset, Model, Policy, PreRaceInput, RankedPrediction, Run, Ticket, Version } from "./types";

export const SIMULATOR_VERSION = "development-timeline-position-weight-v2";
export function context(seed: number, raceId: string, role: string): Context {
  let state = parseInt(sha256({ seed, raceId, role }).slice(0, 8), 16);
  return { seed, random: () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  } };
}
function versionAt(identity: Version, date: string) {
  if (!identity.name || !identity.version || !/^[a-f0-9]{64}$/.test(identity.codeSha256)) throw new Error("Missing version/code fingerprint");
  canonical(identity.config);
  if (identity.trainedThroughDate !== null && isoDate(identity.trainedThroughDate) >= date) {
    throw new Error("Model/policy training cutoff is not strictly before target race");
  }
}
export function assertPreRaceInput(input: PreRaceInput) {
  if (classifyRaceKind(input).kind !== input.surface) throw new Error("Uncorrected race kind in prediction input");
  const allowedRace = new Set(["raceId", "date", "venue", "raceNumber", "raceName", "surface", "distance",
    "classRaw", "structuredClass", "grade", "horses"]);
  if (Object.keys(input).some((k) => !allowedRace.has(k))) throw new Error("Unapproved current race field");
  const allowedHorse = new Set(["horseId", "horse", "horseNumber", "frameNumber", "sex", "age", "carriedWeight",
    "carriedWeightRaw", "jockey", "jockeyId", "trainer", "trainerId", "history"]);
  const date = developmentDate(input.date);
  for (const horse of input.horses) {
    if (Object.keys(horse).some((k) => !allowedHorse.has(k))) throw new Error("Unapproved current horse field");
    for (const row of horse.history) if (isoDate(row.date) >= date || row.netKeibaRaceId === input.raceId) {
      throw new Error("Future, same-day or target-race history leaked");
    }
  }
}
function predict(model: Model, input: PreRaceInput, seed: number): RankedPrediction[] {
  versionAt(model.identity, input.date);
  assertPreRaceInput(input);
  const generate = () => model.predict(frozenClone(input), context(seed, input.raceId, "model"));
  const first = frozenClone(generate()), second = frozenClone(generate());
  if (canonical(first) !== canonical(second)) throw new Error("Non-deterministic model output");
  const horses = new Map(input.horses.map((h) => [h.horseId, h]));
  if (first.length !== horses.size || new Set(first.map((p) => p.horseId)).size !== first.length) throw new Error("Prediction coverage mismatch");
  let sum = 0;
  const predictions = first.map((p) => {
    const h = horses.get(p.horseId);
    if (!h || !Number.isFinite(p.probability) || p.probability < 0 || p.probability > 1 || !Array.isArray(p.reasons)) {
      throw new Error("Invalid prediction");
    }
    for (const reason of p.reasons) if (!reason.name || typeof reason.explanation !== "string" ||
        (reason.contribution !== null && !Number.isFinite(reason.contribution))) throw new Error("Invalid reason breakdown");
    sum += p.probability;
    return { horseId: p.horseId, horseNumber: h.horseNumber, probability: p.probability,
      reasons: p.reasons, rank: 0 };
  });
  if (Math.abs(sum - 1) > 1e-6) throw new Error("Probabilities must sum to 1 (no silent renormalization)");
  return predictions.sort((a, b) => b.probability - a.probability || a.horseNumber - b.horseNumber)
    .map((p, i) => ({ ...p, rank: i + 1 }));
}
export function validateTickets(tickets: Ticket[], input: PreRaceInput): Ticket[] {
  const counts = { tan: 1, fuku: 1, wide: 2, umaren: 2, umatan: 2, sanfuku: 3, santan: 3 };
  const numbers = new Set(input.horses.map((h) => h.horseNumber)), seen = new Set<string>();
  return tickets.map((ticket) => {
    if (!TICKET_KINDS.includes(ticket.kind) || !Number.isSafeInteger(ticket.stakeYen) ||
        ticket.stakeYen <= 0 || ticket.stakeYen % 100 !== 0 || !Array.isArray(ticket.horses) ||
        ticket.horses.length !== counts[ticket.kind] || new Set(ticket.horses).size !== ticket.horses.length ||
        ticket.horses.some((n) => !Number.isInteger(n) || !numbers.has(n))) throw new Error("Invalid ticket");
    const horses = ["wide", "umaren", "sanfuku"].includes(ticket.kind) ? [...ticket.horses].sort((a, b) => a - b) : [...ticket.horses];
    const key = `${ticket.kind}:${horses.join("-")}`;
    if (seen.has(key)) throw new Error("Duplicate ticket (merge stakes explicitly)"); seen.add(key);
    return { kind: ticket.kind, horses, stakeYen: ticket.stakeYen };
  }).sort((a, b) => a.kind.localeCompare(b.kind) || canonical(a.horses).localeCompare(canonical(b.horses)));
}

/** No built-in model. Prediction phase completes BEFORE outcome joining; no metrics are automatic. */
export function simulate(dataset: Dataset, model: Model, policy: Policy, seed: number, simulatorSha256: string): Run {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF || !/^[a-f0-9]{64}$/.test(simulatorSha256)) throw new Error("Invalid seed/runtime fingerprint");
  const snapshot = frozenClone(dataset), modelIdentity = frozenClone(model.identity), policyIdentity = frozenClone(policy.identity);
  if (new Set(snapshot.races.map((r) => r.raceId)).size !== snapshot.races.length) throw new Error("Duplicate race ID");
  if (Object.keys(snapshot.truthByRace).length !== snapshot.races.length) throw new Error("Truth coverage mismatch");
  const inputs = snapshot.races.map((r) => prepareInput(r, snapshot.historyByHorse))
    .sort((a, b) => a.date.localeCompare(b.date) || a.raceId.localeCompare(b.raceId));
  const planned = inputs.map((input) => {
    const predictions = frozenClone(predict({ ...model, identity: modelIdentity }, input, seed));
    versionAt(policyIdentity, input.date);
    const generate = () => validateTickets(policy.tickets(frozenClone(input), frozenClone(predictions), context(seed, input.raceId, "policy")), input);
    const first = frozenClone(generate()), second = frozenClone(generate());
    if (canonical(first) !== canonical(second)) throw new Error("Non-deterministic betting policy");
    const race = snapshot.races.find((r) => r.raceId === input.raceId)!;
    return { raceId: input.raceId, date: input.date, inputSha256: sha256(input),
      starters: race.starters, predictions, tickets: first };
  });
  // Training and inference never receive this evaluation-only phase.
  const records = planned.map((p) => {
    const actual = snapshot.truthByRace[p.raceId];
    if (!actual || actual.raceId !== p.raceId || actual.date !== p.date) throw new Error("Truth ID/date mismatch");
    developmentDate(actual.date);
    return { ...p, actual };
  });
  const payload = { schemaVersion: 1 as const, seed, simulatorVersion: SIMULATOR_VERSION, simulatorSha256,
    model: modelIdentity, policy: policyIdentity, sourceHashes: snapshot.sourceHashes,
    inputSha256: sha256(inputs), truthSha256: sha256(snapshot.truthByRace), constraints: snapshot.constraints, records };
  return frozenClone({ ...payload, runId: sha256(payload) });
}
