/** Prediction capture only. Never calls settlement, market comparison or metrics. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { references, verifyProtection, verifyCohort } from "./stage1-feature-ablation-reference";
import { canonical, frozenClone, sha256 } from "./simulator/canonical";
import { loadDevelopment } from "./simulator/input";
import { prepareInputV2 as prepareInput } from "./stage1-v2-input";
import { simulate } from "./simulator/stage1-v2-runner";
import { saveRun, simulatorFingerprint } from "./simulator/store";
import { flatExclusionReason } from "./simulator/race-kind";
import type { Dataset, Policy, Run } from "./simulator/types";
import { derive, independentInput, trainingExample, unsupported } from "./stage1-independent-v2";
import type { Example } from "./stage1-independent-v2";
import { model, train, configuration } from "./stage1-feature-ablation-model";
import type { Artifact, Variant } from "./stage1-feature-ablation-model";

import { WINDOWS } from "./run-stage1-independent";
export { WINDOWS };
export function fingerprints() {
  const files = ["docs/STAGE1_FEATURE_ABLATION_PLAN.md", "scripts/stage1-feature-ablation-reference.ts", "scripts/stage1-feature-ablation-model.ts", "scripts/run-stage1-feature-ablation.ts", "scripts/stage1-independent-v2.ts", "scripts/stage1-v2-input.ts",
    "scripts/simulator/stage1-v2-runner.ts", "scripts/run-stage1-independent.ts"];
  const codeSha256 = sha256(Object.fromEntries(files.map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")])));
  return { codeSha256, simulatorSha256: sha256({ base: simulatorFingerprint(), codeSha256 }) };
}
type Status = { raceId: string; date: string; status: string; window: string | null };
export function execute(variant: Variant, dataset: Dataset, codeSha256: string, simulatorSha256: string, baseline = references()) {
  assert.deepEqual(dataset.sourceHashes,baseline.captures.D.sourceHashes);
  const ordered = [...dataset.races].sort((a, b) => a.date.localeCompare(b.date) || a.raceId.localeCompare(b.raceId));
  if (ordered.length !== 1338 || new Set(ordered.map(r => r.raceId)).size !== 1338) throw new Error("Development coverage mismatch");
  const featured = new Map(ordered.filter(r => flatExclusionReason(r) === null)
    .map(r => [r.raceId, derive(independentInput(prepareInput(r, dataset.historyByHorse)))]));
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
      const kindReason = flatExclusionReason(race);
      if (kindReason) { excluded.push({ raceId: race.raceId, reason: kindReason }); continue; }
      const input = featured.get(race.raceId)!;
      const reason = unsupported(input, race.surface);
      if (reason) { excluded.push({ raceId: race.raceId, reason }); continue; }
      // Select and project historical winner labels only after the calendar cutoff selection.
      const example = trainingExample(input, dataset.truthByRace[race.raceId], window.cutoff);
      if (typeof example === "string") excluded.push({ raceId: race.raceId, reason: example });
      else examples.push(example);
    }
    const index = WINDOWS.indexOf(window);
    assert.deepEqual(examples.map(e=>e.input.raceId),baseline.captures.D.artifacts[index].trainingRaceIds);
    assert.deepEqual(excluded,baseline.captures.D.artifacts[index].excluded);
    const artifact = train(variant, examples, window.cutoff, excluded); artifacts.push(artifact);
    const supported = targets.filter(r => {
      const reason = flatExclusionReason(r) ?? unsupported(featured.get(r.raceId)!, r.surface);
      const status = statuses.find(s => s.raceId === r.raceId)!;
      status.window = window.name; status.status = reason ?? "predicted; uncalibrated";
      return reason === null;
    });
    const selected: Dataset = { ...dataset, races: supported,
      truthByRace: Object.fromEntries(supported.map(r => [r.raceId, dataset.truthByRace[r.raceId]])),
      constraints: [...dataset.constraints, "Stage 1 independent; no market features; probabilities uncalibrated.",
        "No bets or performance metrics calculated; training and prediction races disjoint within each window."] };
    const run=simulate(selected, model(artifact, codeSha256), policy, 0, simulatorSha256);
    verifyCohort(run,baseline.runs.D[index]); runs.push(run);
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
  verifyProtection(baseline.protectedHashes);
  return frozenClone({ variant, settings: configuration(variant), windows: WINDOWS, sourceHashes: dataset.sourceHashes,
    classification: dataset.classification ?? null,
    statuses, artifacts, runs, nominations });
}
function main() {
  if (process.argv.length !== 2) throw new Error("No custom input paths or tuning arguments accepted");
  const { codeSha256, simulatorSha256 } = fingerprints();
  const dataset = loadDevelopment();
  const baseline = references();
  const reports = [];
  for (const variant of ["B","C"] as const) {
    const output = execute(variant, dataset, codeSha256, simulatorSha256, baseline);
    for (const [file, expected] of Object.entries(dataset.sourceHashes)) {
      if (createHash("sha256").update(readFileSync(file)).digest("hex") !== expected) throw new Error("Input changed during execution");
    }
    const paths = output.runs.map(saveRun);
    const { runs, ...capture } = output;
    const report = { ...capture, runIds: runs.map(r=>r.runId), performanceEvaluated: false };
    writeFileSync(join(paths[0],"stage1-capture.json"), canonical(report)+"\n", {flag:"wx"});
    reports.push({variant,runIds:report.runIds,predictions:output.nominations.length,classification:output.classification});
    console.log(JSON.stringify(reports.at(-1)));
  }
  writeFileSync("lib/simulation-runs/stage1-feature-ablation-capture.json",canonical({codeSha256,simulatorSha256,reports})+"\n",{flag:"wx"});
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
