/** Structural audit only: no settlement, accuracy, market ranking or performance metrics. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { developmentDate, sha256 } from "./simulator/canonical";
import { assertInputPath } from "./simulator/input";
import { loadRun } from "./simulator/store";
import type { Json } from "./simulator/types";
import type { execute } from "./run-stage1-independent";

type Capture = Omit<ReturnType<typeof execute>, "runs"> & { runIds: string[]; performanceEvaluated: boolean };
const id = process.argv[2];
if (process.argv.length !== 3 || !/^[a-f0-9]{64}$/.test(id ?? "")) throw new Error("Supply only a capture run ID");
loadRun(id); // Validates output directory/parent links before accessing the sidecar.
const path = join(process.cwd(), "lib", "simulation-runs", id, "stage1-capture.json");
if (lstatSync(path).isSymbolicLink()) throw new Error("Linked capture rejected");
const capture = JSON.parse(readFileSync(path, "utf8")) as Capture;
assert.equal(capture.statuses.length, 1338);
assert.equal(new Set(capture.statuses.map(s => s.raceId)).size, 1338);
assert.equal(capture.performanceEvaluated, false);
assert.equal(capture.runIds[0], id);
assert.equal(capture.artifacts.length, 3); assert.equal(capture.runIds.length, 3);
for (const [file, hash] of Object.entries(capture.sourceHashes)) {
  assert.equal(createHash("sha256").update(readFileSync(assertInputPath(file))).digest("hex"), hash);
}
const source = JSON.parse(readFileSync(assertInputPath("lib/backfill/races.json"), "utf8")) as {
  races: Record<string, { netKeibaRaceId: string; date: string }> };
const sourceDates = new Map(Object.values(source.races).map(r => [r.netKeibaRaceId, developmentDate(r.date)]));
for (const status of capture.statuses) assert.equal(sourceDates.get(status.raceId), status.date);
const seen = new Set<string>();
const counts = [];
for (let i = 0; i < capture.runIds.length; i++) {
  const run = loadRun(capture.runIds[i]), artifact = capture.artifacts[i], window = capture.windows[i];
  assert.equal((run.model.config as { artifactSha256: string }).artifactSha256, sha256(artifact));
  assert.equal(artifact.trainedThroughDate, window.cutoff);
  const training = new Set(artifact.trainingRaceIds);
  assert.equal(training.size, artifact.trainingRaceIds.length);
  for (const raceId of training) assert.ok(sourceDates.get(raceId)! <= window.cutoff);
  for (const record of run.records) {
    assert.ok(record.date >= window.start && record.date <= window.end);
    assert.ok(record.date > artifact.trainedThroughDate);
    assert.ok(!training.has(record.raceId)); assert.ok(!seen.has(record.raceId)); seen.add(record.raceId);
    assert.equal(record.tickets.length, 0);
    assert.equal(capture.statuses.find(s => s.raceId === record.raceId)?.status, "predicted; uncalibrated");
    for (const horse of record.predictions) for (const feature of horse.reasons) {
      const raw = feature.rawValue as { [key: string]: Json };
      const rows = raw.sourceRows as Array<{ date: string; raceId: string | null }>;
      // JSON represents -0 as 0; numeric equality correctly treats those as equal.
      assert.ok(feature.contribution === (raw.transformed as number) * (raw.weight as number));
      for (const row of rows) {
        assert.ok(row.date < record.date); assert.notEqual(row.raceId, record.raceId);
        assert.ok(!("oddsRaw" in row)); assert.ok(!("popularity" in row));
      }
      if (["recentFinish", "surfaceFinish", "distanceFinish"].includes(feature.name) && raw.value !== null) {
        const finishes = rows as Array<{ date: string; raceId: string | null; position: number; fieldSize: number }>;
        assert.ok(finishes.length > 0 && finishes.length <= 3);
        assert.equal(raw.value, finishes.reduce((s, r) => s + (r.fieldSize - r.position) / (r.fieldSize - 1), 0) / finishes.length);
      }
    }
    const nomination = capture.nominations.find(n => n.raceId === record.raceId)!;
    assert.equal(nomination.horseId, record.predictions[0].horseId);
    assert.equal(nomination.runId, run.runId);
    const score = record.predictions[0].reasons.reduce((s, r) => s + r.contribution!, 0);
    assert.equal(score, nomination.score);
    assert.ok(Math.abs(nomination.differences.reduce((s, f) => s + f.contribution, 0) -
      (nomination.scoreGap ?? nomination.score)) < 1e-10);
  }
  counts.push({ window: window.name, trainingRaces: training.size,
    excludedTrainingRaces: artifact.excluded.length, predictionRecords: run.records.length });
}
assert.equal(seen.size, capture.nominations.length);
assert.equal(new Set(capture.nominations.map(n => n.raceId)).size, seen.size);
assert.equal(capture.statuses.filter(s => s.status === "predicted; uncalibrated").length, seen.size);
console.log(JSON.stringify({ savedStructureValid: true, inputBytesUnchanged: true,
  predictionRecords: seen.size, windows: counts, performanceEvaluated: false }, null, 2));
