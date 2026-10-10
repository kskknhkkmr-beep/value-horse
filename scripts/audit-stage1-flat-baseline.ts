/** Corrected flat baseline audit of immutable saved predictions; never trains or tunes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { calculateScore } from "../lib/engine";
import type { HorseScores } from "../lib/scorer";
import type { CachedRace } from "./fetch-races";
import { canonical, developmentDate, sha256 } from "./simulator/canonical";
import { loadDevelopment, prepareInput } from "./simulator/input";
import { marketTopN } from "./simulator/runner";
import { loadRun, simulatorFingerprint } from "./simulator/store";
import { flatExclusionReason, RACE_KIND_VERSION } from "./simulator/race-kind";
import { derive, FEATURES, independentInput, SETTINGS, softmax, trainingExample, unsupported } from "./stage1-independent";
import type { Example } from "./stage1-independent";
import { WINDOWS } from "./run-stage1-independent";
import type { execute } from "./run-stage1-independent";
import { recommendations } from "./stage0-audit-core";
import { AUDIT_SETTINGS, caseGroups, compare, describe, observe, type AuditRow } from "./stage1-first-audit-core";

if (process.argv.length !== 4 || process.argv[2] !== "--retrospective-final-odds" || !/^--capture=[a-f0-9]{64}$/.test(process.argv[3])) throw new Error("Require retrospective mode and immutable capture ID; no selection parameters");
const firstId = process.argv[3].slice("--capture=".length);
const legacyDir = "lib/simulation-runs/stage1-first-audit-47ae88195890f642fcb17a741816e4768090c9c82895056c8a607c7c84e9b538";
const stage0Id = "60a3f5fa66139c692759757d1a205d9891d2f6d60384d50d515585528baedad8";
const stage0Dir = `lib/simulation-runs/stage0-audit-${stage0Id}`;
const sourceFiles = ["lib/backfill/races.json", "lib/backfill-stage1/race-details-raw.json", "lib/backfill-stage1/horse-history-raw.json",
  "lib/backfill/races-cache.json", "lib/backfill/scores-cache.json", "lib/backfill/horses.json"];
const savedFiles = [`lib/simulation-runs/${firstId}/stage1-capture.json`, `${stage0Dir}/summary.json`, `${stage0Dir}/logs.json`, `${legacyDir}/rows.json`, `${legacyDir}/summary.json`];
const sourceHashes: Record<string, string> = {}, savedHashes: Record<string, string> = {};
function noLinks(path: string) {
  const root = resolve(process.cwd()), target = resolve(path);
  if (relative(root, target).startsWith("..")) throw new Error("Outside workspace");
  let cursor = root;
  for (const part of ["", ...relative(root, target).split(/[\\/]/)]) {
    if (part) cursor = join(cursor, part);
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Linked audit path");
  }
}
const byteHash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
function read<T>(file: string): T {
  if (![...sourceFiles, ...savedFiles].includes(file)) throw new Error("Not an allowlisted development audit file");
  noLinks(file); const bytes = readFileSync(file);
  (sourceFiles.includes(file) ? sourceHashes : savedHashes)[file] = createHash("sha256").update(bytes).digest("hex");
  return JSON.parse(bytes.toString("utf8")) as T;
}
type Capture = Omit<ReturnType<typeof execute>, "runs"> & { runIds: string[]; performanceEvaluated: boolean };
type Stage0Meta = { runId: string; mode: string; sourceCommit: string; inputHashes: Record<string, string>;
  codeHashes: Record<string, string>; seed: number };
const capture = read<Capture>(savedFiles[0]);
assert.equal(capture.runIds[0], firstId); assert.deepEqual(capture.windows, WINDOWS);
assert.deepEqual(capture.settings, SETTINGS); assert.equal(capture.statuses.length, 1338);
assert.equal(new Set(capture.statuses.map(s => s.raceId)).size, 1338);
const dataset = loadDevelopment(); Object.assign(sourceHashes, dataset.sourceHashes);
assert.deepEqual(capture.sourceHashes, dataset.sourceHashes);
assert.equal(capture.classification?.version, RACE_KIND_VERSION);
assert.deepEqual(capture.classification, dataset.classification);
assert.equal(dataset.races.filter(r => flatExclusionReason(r) === null).length, 1292);
const specs = new Map(dataset.races.map(r => [r.raceId, r]));
for (const s of capture.statuses) assert.equal(specs.get(s.raceId)?.date, developmentDate(s.date));
const stage0 = read<Stage0Meta>(savedFiles[1]);
assert.equal(stage0.runId, stage0Id);
assert.equal(sha256({ mode: stage0.mode, sourceCommit: stage0.sourceCommit, inputHashes: stage0.inputHashes,
  codeHashes: stage0.codeHashes, seed: stage0.seed }), stage0Id);
assert.deepEqual(Object.keys(stage0.inputHashes).sort(), [...sourceFiles].sort());
for (const file of sourceFiles) { noLinks(file); assert.equal(byteHash(file), stage0.inputHashes[file]); sourceHashes[file] = byteHash(file); }
const stage0Code = ["lib/engine.ts", "lib/scorer.ts", "lib/combination-ev.ts", "lib/starRating.ts", "app/page.tsx", "app/api/score/route.ts",
  "scripts/backfill-derive.ts", "scripts/audit-stage0.ts", "scripts/stage0-audit-core.ts", "scripts/simulator/input.ts",
  "scripts/simulator/settlement.ts", "scripts/simulator/canonical.ts", "docs/STAGE0_AUDIT_PLAN.md"];
assert.deepEqual(Object.keys(stage0.codeHashes).sort(), [...stage0Code].sort());
// Verify the historical code identity, not the corrected loader against old bytes.
for (const file of stage0Code) {
  if (file === "scripts/simulator/input.ts") {
    const archived = execFileSync("git", ["show", `${stage0.sourceCommit}:${file}`]);
    assert.equal(createHash("sha256").update(archived).digest("hex"), stage0.codeHashes[file]);
  } else assert.equal(byteHash(file), stage0.codeHashes[file]);
}
const cache = read<{ races: CachedRace[] }>("lib/backfill/races-cache.json");
const scores = read<{ scores: Record<number, HorseScores> }>("lib/backfill/scores-cache.json").scores;
const stage0Logs = read<Array<{ raceId: string; date: string; picks: number[];
  horses: Array<{ id: number; horseId: string; horseNumber: number; scoreCache: HorseScores }> }>>(savedFiles[2]);
assert.equal(stage0Logs.length, 1338); assert.equal(new Set(stage0Logs.map(r => r.raceId)).size, 1338);
const logsById = new Map(stage0Logs.map(r => [r.raceId, r]));
const cacheById = new Map(cache.races.map(r => [r.netKeibaRaceId, r]));
const codeHash = sha256(Object.fromEntries(["scripts/stage1-independent.ts", "scripts/run-stage1-independent.ts"].map(f => [f, byteHash(f)])));
const simHash = simulatorFingerprint();
const rows: AuditRow[] = [], chronology: unknown[] = [], reasonLogs: unknown[] = [];
const seen = new Set<string>();
const featureCache = new Map<string, ReturnType<typeof derive>>();
function features(raceId: string) {
  if (!featureCache.has(raceId)) featureCache.set(raceId, derive(independentInput(prepareInput(specs.get(raceId)!, dataset.historyByHorse))));
  return featureCache.get(raceId)!;
}
for (const [index, window] of WINDOWS.entries()) {
  const artifact = capture.artifacts[index];
  assert.equal(artifact.trainedThroughDate, window.cutoff); assert.deepEqual(artifact.settings, SETTINGS);
  assert.equal(artifact.inputClassificationVersion, RACE_KIND_VERSION);
  const training = dataset.races.filter(r => r.date <= window.cutoff).sort((a, b) => a.date.localeCompare(b.date) || a.raceId.localeCompare(b.raceId));
  assert.equal(training.length, window.trainingCount);
  const examples: Example[] = [], excluded: typeof artifact.excluded = [];
  for (const r of training) {
    const kindReason = flatExclusionReason(r);
    if (kindReason) { excluded.push({ raceId: r.raceId, reason: kindReason }); continue; }
    const f = features(r.raceId), reason = unsupported(f, r.surface);
    if (reason) { excluded.push({ raceId: r.raceId, reason }); continue; }
    const e = trainingExample(f, dataset.truthByRace[r.raceId], window.cutoff);
    if (typeof e === "string") excluded.push({ raceId: r.raceId, reason: e }); else examples.push(e);
  }
  assert.deepEqual(artifact.trainingRaceIds, examples.map(e => e.input.raceId));
  assert.deepEqual(artifact.excluded, excluded); assert.equal(sha256(examples), artifact.trainingSha256);
  const means = FEATURES.map((_, i) => {
    const values = examples.flatMap(e => e.input.horses.map(h => h.features[i].value)).filter((v): v is number => v !== null);
    return values.reduce((s, v) => s + v, 0) / values.length;
  });
  assert.deepEqual(means, artifact.means);
  const trainedIds = new Set(artifact.trainingRaceIds);
  const run = loadRun(capture.runIds[index]);
  for (const name of ["run.json", "manifest.json"]) {
    const file = `lib/simulation-runs/${run.runId}/${name}`; savedHashes[file] = byteHash(file);
  }
  assert.equal(run.model.codeSha256, codeHash); assert.equal(run.simulatorSha256, simHash);
  assert.equal(run.model.trainedThroughDate, window.cutoff); assert.deepEqual(run.sourceHashes, dataset.sourceHashes);
  assert.equal((run.model.config as { artifactSha256: string }).artifactSha256, sha256(artifact));
  for (const record of run.records) {
    assert.ok(!seen.has(record.raceId)); seen.add(record.raceId);
    assert.ok(record.date > window.cutoff && record.date >= window.start && record.date <= window.end);
    assert.ok(!trainedIds.has(record.raceId)); assert.equal(record.tickets.length, 0);
    const spec = specs.get(record.raceId)!;
    assert.equal(flatExclusionReason(spec), null);
    assert.deepEqual(record.actual, dataset.truthByRace[record.raceId]);
    const input = prepareInput(spec, dataset.historyByHorse), f = features(record.raceId);
    const nomination = capture.nominations.find(n => n.raceId === record.raceId)!;
    assert.equal(record.inputSha256, sha256(input));
    assert.equal(nomination.independentInputSha256, sha256(independentInput(input)));
    assert.equal(nomination.horseId, record.predictions[0].horseId);
    assert.deepEqual([...record.predictions].sort((a, b) => b.probability - a.probability || a.horseNumber - b.horseNumber), record.predictions);
    const sums = record.predictions.map(p => {
      const h = f.horses.find(h => h.horseId === p.horseId)!;
      assert.equal(p.reasons.length, 10);
      const contributions = p.reasons.map((reason, j) => {
        const feature = h.features[j % FEATURES.length];
        const raw = reason.rawValue as { value: number | null; sourceRows: unknown; weight: number; trainingMean: number };
        assert.equal(raw.value, feature.value); assert.deepEqual(raw.sourceRows, feature.sourceRows);
        assert.equal(raw.weight, artifact.weights[j]); assert.equal(raw.trainingMean, artifact.means[j % FEATURES.length]);
        const x = j < FEATURES.length ? (feature.value ?? artifact.means[j]) - artifact.means[j] : Number(feature.value === null);
        assert.ok(reason.contribution === x * artifact.weights[j]);
        for (const h of feature.sourceRows) assert.ok(h.date < record.date && h.raceId !== record.raceId);
        return reason.contribution!;
      });
      return contributions.reduce((s, v) => s + v, 0);
    });
    softmax(sums).forEach((p, i) => assert.ok(Math.abs(p - record.predictions[i].probability) < 1e-14));
    const old = cacheById.get(record.raceId)!, log = logsById.get(record.raceId)!;
    assert.equal(old.date, record.date); assert.equal(old.grade, null); assert.equal(log.date, record.date);
    const engineInput = old.horses.map(h => {
      const score = scores[h.id], saved = log.horses.find(x => x.id === h.id)!;
      const starter = spec.starters.find(x => x.horseId === h.netKeibaHorseId)!;
      assert.ok(score?.modelVersion === "v3" && saved && starter);
      assert.equal(starter.horseNumber, h.horseNumber); assert.equal(saved.horseId, starter.horseId);
      assert.deepEqual(saved.scoreCache, score);
      assert.equal(Number(record.actual.horses.find(x => x.horseId === starter.horseId)!.finalOddsRaw), h.odds);
      return { id: h.id, name: h.horse, formScore: score.formScore / 100, pedigreeScore: score.pedigreeScore / 100,
        jockeyScore: score.jockeyScore === null ? null : score.jockeyScore / 100, odds: h.odds! };
    });
    const picks = recommendations(calculateScore(engineInput).finalScores, false).map(h => old.horses.find(x => x.id === h.id)!.horseNumber);
    assert.deepEqual(picks, log.picks);
    const market = marketTopN(record.actual, 1, spec.starters.map(h => h.horseNumber))[0].horseNumber;
    rows.push({ raceId: record.raceId, date: record.date, archivedStartTime: record.actual.archivedStartTime,
      independent: observe(record.actual, record.predictions[0].horseNumber), market: observe(record.actual, market),
      vh: picks.length ? observe(record.actual, picks[0]) : null });
    reasonLogs.push({ raceId: record.raceId, horseNumber: record.predictions[0].horseNumber,
      probability: record.predictions[0].probability, reasons: record.predictions[0].reasons, scoreGap: nomination.scoreGap });
  }
  chronology.push({ window: window.name, trainingStart: training[0].date, cutoff: window.cutoff,
    candidateTrainingRaces: training.length, fittedTrainingRaces: examples.length,
    excludedTraining: excluded, predictionStart: window.start, predictionEnd: window.end,
    predictionRaces: run.records.length, overlapWithOwnTraining: 0, trainingHashVerified: true, meansVerified: true });
  console.log(`Verified saved window ${window.name}: ${run.records.length} predictions, no refit.`);
}
assert.equal(rows.length, seen.size); assert(rows.length > 0 && rows.length <= 765);
assert.deepEqual([...seen].sort(), capture.statuses.filter(s => s.status === "predicted; uncalibrated").map(s => s.raceId).sort());
const excludedStatuses = capture.statuses.filter(s => s.window !== null && s.status !== "predicted; uncalibrated");
assert.equal(rows.length + excludedStatuses.length, 792);
const flatExcluded = excludedStatuses.filter(s => flatExclusionReason(specs.get(s.raceId)!) === null);
const excludedRows: AuditRow[] = flatExcluded.map(s => {
  const spec = specs.get(s.raceId)!, truth = dataset.truthByRace[s.raceId];
  assert.equal(unsupported(features(s.raceId), spec.surface), s.status);
  return { raceId: s.raceId, date: s.date, archivedStartTime: truth.archivedStartTime, independent: null, vh: null,
    market: observe(truth, marketTopN(truth, 1, spec.starters.map(h => h.horseNumber))[0].horseNumber) };
});
// All structural checks precede aggregate performance computation. No selection changes below.
const common = rows.filter(r => r.vh !== null), groups = caseGroups(rows);
const agreement = rows.filter(r => r.independent!.horseId === r.market.horseId);
const disagreement = rows.filter(r => r.independent!.horseId !== r.market.horseId);
const legacyRows = read<AuditRow[]>(savedFiles[3]);
assert.equal(legacyRows.length, 766);
const { auditId: legacyId, sourceCommit: legacyCommit, codeHashes: legacyCode, reportSha256: legacyHash, ...legacyReport } = read<Record<string, unknown>>(savedFiles[4]);
assert.equal(sha256(legacyReport), legacyHash);
assert.equal(sha256({ sourceCommit: legacyCommit, codeHashes: legacyCode, reportSha256: legacyHash }), legacyId);
const pairedLegacy = rows.filter(r => legacyRows.some(o => o.raceId === r.raceId)).map(r =>
  ({ ...r, vh: legacyRows.find(o => o.raceId === r.raceId)!.independent }));
const report = { classificationVersion: RACE_KIND_VERSION, settings: AUDIT_SETTINGS, mode: "事後市場情報による参考分析・確定払戻精算", chronology,
  overallPredicted: { independent: describe(rows, "independent"), market: describe(rows, "market"), vh: describe(rows, "vh") },
  commonWithVh: { independent: describe(common, "independent"), market: describe(common, "market"), vh: describe(common, "vh") },
  comparisons: [compare(rows, "independent", "market"), compare(common, "independent", "vh"), compare(common, "independent", "market")],
  agreement: { independent: describe(agreement, "independent"), market: describe(agreement, "market") },
  disagreement: { independent: describe(disagreement, "independent"), market: describe(disagreement, "market"), comparison: compare(disagreement, "independent", "market") },
  legacy: { fullLegacy766: legacyReport.overall766,
    commonRaces: pairedLegacy.length, removedLegacyRaces: legacyRows.filter(o => !seen.has(o.raceId)).map(r => ({ raceId: r.raceId, date: r.date })),
    correctedOnCommon: describe(pairedLegacy, "independent"), legacyOnCommon: describe(pairedLegacy, "vh"),
    comparisonLabels: { left: "corrected", right: "legacy independent (not VH)" },
    comparison: compare(pairedLegacy, "independent", "vh"), independentValidation: false },
  exclusionImpact: { flatUnpredictableMarket: describe(excludedRows, "market"), all765FlatTargetMarket: describe([...rows, ...excludedRows], "market"),
    independentCoverage: rows.length / 765, initialTrainingCandidates: 546,
    initialFlatCandidates: dataset.races.filter(r => r.date <= WINDOWS[0].cutoff && flatExclusionReason(r) === null).length,
    developmentFlat: 1292, developmentJump: 46, unknown: 0,
    excluded: excludedStatuses.map(s => ({ ...s, raceName: specs.get(s.raceId)!.raceName, surface: specs.get(s.raceId)!.surface })) },
  caseCounts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
  examples: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.slice(0, 3)])),
  sourceHashes, savedHashes, stage0Reference: stage0Id, stage1References: capture.runIds,
  structureOrSettingsChanged: false, weightsRefittedBeforeAudit: true, auditRefitted: false, fixedEvaluationRead: false };
const codeFiles = ["scripts/audit-stage1-flat-baseline.ts", "scripts/stage1-first-audit-core.ts", "docs/STAGE1_FLAT_BASELINE_PLAN.md"];
const metadata = { sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  codeHashes: Object.fromEntries(codeFiles.map(f => [f, byteHash(f)])), reportSha256: sha256(report) };
for (const [file, hash] of Object.entries({ ...sourceHashes, ...savedHashes })) assert.equal(byteHash(file), hash);
const auditId = sha256(metadata), output = `lib/simulation-runs/stage1-flat-baseline-${auditId}`;
noLinks(output); mkdirSync(output); // exclusive, parent already exists; never overwrite.
for (const [name, value] of Object.entries({ summary: { auditId, ...metadata, ...report }, rows, cases: groups, reasons: reasonLogs })) {
  writeFileSync(join(output, `${name}.json`), canonical(value) + "\n", { flag: "wx" });
}
console.log(JSON.stringify({ output, auditId, inputAndSavedPredictionsUnchanged: true,
  overallPredicted: report.overallPredicted, commonWithVh: report.commonWithVh, comparisons: report.comparisons,
  caseCounts: report.caseCounts }, null, 2));
