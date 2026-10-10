import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { canonical, frozenClone, sha256 } from "./canonical";
import type { Run } from "./types";

const SOURCES = ["types.ts", "canonical.ts", "input.ts", "race-kind.ts", "runner.ts", "settlement.ts", "store.ts"];
export function simulatorFingerprint(): string {
  return sha256(Object.fromEntries(SOURCES.map((file) => [file,
    createHash("sha256").update(readFileSync(join(process.cwd(), "scripts", "simulator", file))).digest("hex")] )));
}
function noLinks(path: string) {
  const root = resolve(process.cwd());
  let cursor = root;
  for (const part of ["", ...relative(root, path).split(/[\\/]/)]) {
    if (part) cursor = join(cursor, part);
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Linked output path rejected");
  }
}
function runPath(runId: string) {
  if (!/^[a-f0-9]{64}$/.test(runId)) throw new Error("Invalid run ID");
  const path = resolve(process.cwd(), "lib", "simulation-runs", runId);
  noLinks(path);
  return path;
}
export function verifyRun(run: Run) {
  const { runId, ...payload } = run;
  if (sha256(payload) !== runId || run.schemaVersion !== 1) throw new Error("Run content hash mismatch");
}
/** Append-only. Never accepts arbitrary output paths or overwrites an existing run. */
export function saveRun(run: Run): string {
  verifyRun(run);
  const path = runPath(run.runId), parent = resolve(process.cwd(), "lib", "simulation-runs");
  noLinks(parent);
  mkdirSync(parent, { recursive: true });
  mkdirSync(path); // exclusive allocation; duplicate IDs and incomplete runs fail closed.
  writeFileSync(join(path, "run.json"), canonical(run) + "\n", { flag: "wx" });
  writeFileSync(join(path, "manifest.json"), canonical({ schemaVersion: 1,
    runId: run.runId, runSha256: sha256(run), inputSha256: run.inputSha256, truthSha256: run.truthSha256,
    simulatorVersion: run.simulatorVersion, simulatorSha256: run.simulatorSha256,
    model: run.model, policy: run.policy, seed: run.seed, sourceHashes: run.sourceHashes,
    raceCount: run.records.length, constraints: run.constraints, complete: true }) + "\n", { flag: "wx" });
  return path;
}
export function loadRun(runId: string): Run {
  const path = runPath(runId);
  noLinks(join(path, "manifest.json")); noLinks(join(path, "run.json"));
  const manifest = JSON.parse(readFileSync(join(path, "manifest.json"), "utf8"));
  const run = JSON.parse(readFileSync(join(path, "run.json"), "utf8")) as Run;
  verifyRun(run);
  if (manifest.complete !== true || manifest.runId !== runId || run.runId !== runId || manifest.runSha256 !== sha256(run)) {
    throw new Error("Incomplete/corrupt saved run");
  }
  return frozenClone(run);
}
