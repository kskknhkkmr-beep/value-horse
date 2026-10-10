/** Offline development infrastructure; no VH model or buying rule is defined here. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type History = {
  netKeibaRaceId: string | null; date: string; venueRaw: string | null;
  venue: string | null; raceName: string | null; weatherRaw: string | null;
  surface: string | null; distance: number | null; trackConditionRaw: string | null;
  fieldSize: number | null; frameNumber: number | null; horseNumber: number | null;
  positionRaw: string | null; position: number | null; marginRaw: string | null;
  raceTimeRaw: string | null; cornerPositionsRaw: string | null; final3fRaw: string | null;
  jockey: string | null; jockeyId: string | null; carriedWeightRaw: string | null;
  horseWeightRaw: string | null; oddsRaw: string | null; popularity: number | null;
};
export type Starter = {
  horseId: string; horse: string; horseNumber: number; frameNumber: number | null;
  sex: string | null; age: number | null; carriedWeight: number | null;
  carriedWeightRaw: string | null; jockey: string | null; jockeyId: string | null;
  trainer: string | null; trainerId: string | null;
};
export type RaceSpec = {
  raceId: string; date: string; venue: string; raceNumber: number;
  raceName: string; surface: string; distance: number;
  classRaw: string | null; structuredClass: string | null; grade: string | null;
  starters: Starter[];
};
export type PreRaceInput = Omit<RaceSpec, "starters"> & {
  horses: Array<Starter & { history: History[] }>;
};
export type TicketKind = "tan" | "fuku" | "wide" | "umaren" | "umatan" | "sanfuku" | "santan";
export type Payout = {
  status: "ok" | "missing" | "refund" | "not_offered" | "unparsed";
  rawCombination: string | null; rawPayout: string | null;
  entries: Array<{ horse?: number; combo?: number[]; payout: number }>;
  rows?: Payout[];
};
export type Truth = {
  raceId: string; date: string; archivedStartTime: string | null;
  horses: Array<{ horseId: string; horseNumber: number; positionRaw: string | null;
    raceTimeRaw: string | null; marginRaw: string | null; final3fRaw: string | null;
    cornerPositionsRaw: string | null; finalOddsRaw: string | null; popularity: number | null }>;
  payouts: Record<TicketKind, Payout>;
  /** Only populate from verified, ticket-specific refund evidence; raw 'refund' is insufficient. */
  refunds?: Array<{ kind: TicketKind; horses: number[]; evidence: string }>;
};
export type Dataset = {
  races: RaceSpec[]; historyByHorse: Record<string, History[]>;
  truthByRace: Record<string, Truth>; sourceHashes: Record<string, string>;
  constraints: string[];
  classification?: { version: string; races: Array<{ raceId: string; date: string;
    storedSurface: string; kind: string; reasons: string[]; exclusionReason: string | null }> };
};
export type Reason = { name: string; rawValue: Json; contribution: number | null; explanation: string };
export type Prediction = { horseId: string; probability: number; reasons: Reason[] };
export type RankedPrediction = Prediction & { rank: number; horseNumber: number };
export type Ticket = { kind: TicketKind; horses: number[]; stakeYen: number };
export type Version = {
  name: string; version: string; codeSha256: string; config: Json;
  /** null explicitly means no fitted model; otherwise must precede EVERY target date. */
  trainedThroughDate: string | null;
};
export type Context = { seed: number; random: () => number };
export type Model = { identity: Version; predict: (input: PreRaceInput, context: Context) => Prediction[] };
export type Policy = { identity: Version; tickets: (input: PreRaceInput,
  predictions: RankedPrediction[], context: Context) => Ticket[] };
export type Run = {
  schemaVersion: 1; runId: string; seed: number; simulatorVersion: string;
  simulatorSha256: string; model: Version; policy: Version;
  sourceHashes: Record<string, string>; inputSha256: string; truthSha256: string;
  constraints: string[];
  records: Array<{ raceId: string; date: string; inputSha256: string;
    starters: Starter[]; predictions: RankedPrediction[]; tickets: Ticket[]; actual: Truth }>;
};
