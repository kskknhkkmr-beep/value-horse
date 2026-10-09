/** Prediction capture only. Never calls settlement, market comparison or metrics. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, frozenClone, sha256 } from "./simulator/canonical";
import { loadDevelopment, prepareInput } from "./simulator/input";
import { simulate } from "./simulator/runner";
import { saveRun, simulatorFingerprint } from "./simulator/store";
import type { Dataset, Policy, Run } from "./simulator/types";
import { derive, independentInput, model, SETTINGS, train, trainingExample, unsupported } from "./stage1-independent";
import type { Artifact, Example } from "./stage1-independent";

export const WINDOWS = frozenClone([
  { name: "A", cutoff: "2026-03-29", start: "2026-04-04", end: "2026-04-26", trainingCount: 546, targetCount: 264 },
  { name: "B", cutoff: "2026-04-26", start: "2026-05-02", end: "2026-05-31", trainingCount: 810, targetCount: 336 },
  { name: "C", cutoff: "2026-05-31", start: "2026-06-06", end: "2026-06-21", trainingCount: 1146, targetCount: 192 },
]);
type Status = { raceId: string; date: string; status: string; window: string | null };
export function execute(dataset: Dataset, codeSha256: string, simulatorSha256: string) {
  const ordered = [...dataset.races].sort((a, b) => a.date.localeCompare(b.date) || a.raceId.localeCompare(b.raceId));
  if (ordered.length !== 1338 || new Set(ordered.map(r => r.raceId)).size !== 1338) throw new Error("Development coverage mismatch");
  const featured = new Map(ordered.map(r => [r.raceId, derive(independentInput(prepareInput(r, dataset.historyByHorse)))]));
  const statuses: Status[] = ordered.map(r => ({ raceId: r.raceId, date: r.date,
    status: r.date <= WINDOWS[0].cutoff ? "initial training period; no out-of-sample prediction" : "pending", window: null }));
  const artifacts: Artifact[] = [], runs: Run[] = [];
  const policy: Policy = { identity: { name: "no-bets-no-evaluation", version: "1", codeSha256,
    config: {}, trainedThroughDate: null }, tickets: () => [] };
  for (const window of WINDOWS) {
    const training = ordered.filter(r => r.date <= window.cutoff);
    const targets = ordered.filter(r => r.date >= window.start && r.date <= window.end);
    if (training.length !== window.trainingCount || targets.length !== window.targetCount) throw new Error("Fixed calendar window count mismatch");
    const examples: Example[] = [], excluded: Artifact["excluded"] = [];
    for (const race of training) {
      const input = featured.get(race.raceId)!;
      const reason = unsupported(input, race.surface);
      if (reason) { excluded.push({ raceId: race.raceId, reason }); continue; }
      // Select and project historical winner labels only after the calendar cutoff selection.
      const example = trainingExample(input, dataset.truthByRace[race.raceId], window.cutoff);
      if (typeof example === "string") excluded.push({ raceId: race.raceId, reason: example });
      else examples.push(example);
    }
    const artifact = train(examples, window.cutoff, excluded); artifacts.push(artifact);
    const supported = targets.filter(r => {
      const reason = unsupported(featured.get(r.raceId)!, r.surface);
      const status = statuses.find(s => s.raceId === r.raceId)!;
      status.window = window.name; status.status = reason ?? "predicted; uncalibrated";
      return reason === null;
    });
    const selected: Dataset = { ...dataset, races: supported,
      truthByRace: Object.fromEntries(supported.map(r => [r.raceId, dataset.truthByRace[r.raceId]])),
      constraints: [...dataset.constraints, "Stage 1 independent; no market features; probabilities uncalibrated.",
        "No bets or performance metrics calculated; training and prediction races disjoint within each window."] };
    runs.push(simulate(selected, model(artifact, codeSha256), policy, 0, simulatorSha256));
  }
  if (statuses.some(s => s.status === "pending")) throw new Error("Unaccounted development race");
  const nominations = runs.flatMap(run => run.records.map(record => {
    const first = record.predictions[0], second = record.predictions[1];
    const score = first.reasons.reduce((s, r) => s + r.contribution!, 0);
    const differences = first.reasons.map((reason, j) => ({ name: reason.name,
      contribution: reason.contribution! - (second?.reasons[j].contribution ?? 0) }));
    const secondScore = second?.reasons.reduce((s, r) => s + r.contribution!, 0) ?? null;
    return { raceId: record.raceId, date: record.date, runId: run.runId, horseId: first.horseId,
      horseNumber: first.horseNumber, score, secondScore, scoreGap: secondScore === null ? null : score - secondScore,
      tiedAtTop: second !== undefined && first.probability === second.probability, differences,
      independentInputSha256: sha256(independentInput(prepareInput(ordered.find(r => r.raceId === record.raceId)!, dataset.historyByHorse))) };
  }));
  return frozenClone({ settings: SETTINGS, windows: WINDOWS, sourceHashes: dataset.sourceHashes,
    statuses, artifacts, runs, nominations });
}
function main() {
  if (process.argv.length !== 2) throw new Error("No custom input paths or tuning arguments accepted");
  const sources = ["scripts/stage1-independent.ts", "scripts/run-stage1-independent.ts"];
  const codeSha256 = sha256(Object.fromEntries(sources.map(file => [file,
    createHash("sha256").update(readFileSync(file)).digest("hex")])));
  const dataset = loadDevelopment();
  const output = execute(dataset, codeSha256, simulatorFingerprint());
  // Recheck immutable source bytes before creating any append-only output.
  for (const [file, expected] of Object.entries(dataset.sourceHashes)) {
    if (createHash("sha256").update(readFileSync(file)).digest("hex") !== expected) throw new Error("Input changed during execution");
  }
  const paths = output.runs.map(saveRun);
  const { runs, ...capture } = output;
  const report = { ...capture, runIds: runs.map(r => r.runId), performanceEvaluated: false };
  writeFileSync(join(paths[0], "stage1-capture.json"), canonical(report) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ developmentRaces: output.statuses.length, predictionRecords: output.nominations.length,
    statusCounts: Object.fromEntries([...new Set(output.statuses.map(s => s.status))].map(status =>
      [status, output.statuses.filter(s => s.status === status).length])), paths,
    performanceEvaluated: false }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
