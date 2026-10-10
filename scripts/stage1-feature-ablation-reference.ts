/** Fixed identities and read-only protection for the four-model experiment. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRun } from "./simulator/store";
import { sha256 } from "./simulator/canonical";
import type { Run } from "./simulator/types";
export const BASE_RUNS = {
 A: ["d55a152689d1c1956b430c3b61e99447d08e46c6ef8de117077e8b16a3d30711","080ee59826d8d95ca7cc2475a2d2829b3aeaa48feddc8d1d0d77553558c2d70d","d993d9b20686d1268123606e3e79d3889bc1ee8f50c5a782981388d8bdf112d3"],
 D: ["34b2243bf3b35bb1ee2a73bc16b2625771142c6b120d215a44df613a56ec1de5","38287a768f3ef96f2f44d5418acf2df921a098966114e23bc54b6e092decec13","5c8d953580d0f32a5883f0a994168f427d5cf42013883b7f7dd80e0235c61483"]
} as const;
export function noLinks(path: string) {
 assert(!path.includes("..") && !path.includes(".sealed-data") && !path.startsWith("/") && !path.includes(":"));
 let cursor=process.cwd();
 for(const part of path.split("/")) {cursor=join(cursor,part);assert(!lstatSync(cursor,{throwIfNoEntry:false})?.isSymbolicLink(),"Linked path");}
}
export function bytes(path: string) {noLinks(path);return createHash("sha256").update(readFileSync(path)).digest("hex");}
export function json<T>(path: string): T {noLinks(path);return JSON.parse(readFileSync(path,"utf8")) as T;}
export type Capture = {runIds:string[];sourceHashes:Record<string,string>;artifacts:{
 trainingRaceIds:string[];excluded:{raceId:string;reason:string}[];trainedThroughDate:string;settings:{version:string;iterations:number;learningRate:number;l2:number;temperature:number;recentRuns:number;distanceBandMetres:number;calibration:string;tieBreak:string};features:string[];weights:number[];means:number[];trainingSha256:string;
 }[];statuses:{raceId:string;date:string;status:string;window:string|null}[]};
export function references() {
 // Verify complete files first; retain only the reference fields needed below.
 // Avoid holding six large explanation trees alongside two new training runs.
 const compact = (id:string) => {const run=loadRun(id);return {...run,records:run.records.map(r=>({...r,predictions:r.predictions.map(p=>({...p,reasons:[]}))}))};};
 const runs={A:BASE_RUNS.A.map(compact),D:BASE_RUNS.D.map(compact)};
 const captures={A:json<Capture>("lib/simulation-runs/"+BASE_RUNS.A[0]+"/stage1-capture.json"),D:json<Capture>("lib/simulation-runs/"+BASE_RUNS.D[0]+"/stage1-capture.json")};
 for(const key of ["A","D"] as const) {
  assert.deepEqual(captures[key].runIds,BASE_RUNS[key]);
  assert.equal(runs[key].reduce((s,r)=>s+r.records.length,0),742);
  for(const run of runs[key]) assert.deepEqual(run.sourceHashes,captures[key].sourceHashes);
 }
 for(let i=0;i<3;i++) {
  assert.deepEqual(runs.A[i].records.map(r=>r.raceId),runs.D[i].records.map(r=>r.raceId));
  assert.deepEqual(captures.A.artifacts[i].trainingRaceIds,captures.D.artifacts[i].trainingRaceIds);
  assert.deepEqual(captures.A.artifacts[i].excluded,captures.D.artifacts[i].excluded);
  assert.equal(captures.D.artifacts[i].trainingRaceIds.length,[513,769,1090][i]);
  assert.equal(runs.D[i].records.length,[256,322,164][i]);
  runs.A[i].records.forEach((record,j)=>assert.equal(sha256(record.actual),sha256(runs.D[i].records[j].actual)));
 }
 const files=["scripts/stage1-independent.ts","scripts/stage1-independent-v2.ts","scripts/run-stage1-independent.ts","scripts/run-stage1-v2.ts","scripts/stage1-v2-input.ts","scripts/simulator/stage1-v2-runner.ts",
 ...Object.keys(captures.D.sourceHashes),"lib/backfill/races-cache.json","lib/backfill/scores-cache.json","lib/backfill/horses.json",...Object.values(BASE_RUNS).flat().flatMap(id=>["run","manifest"].map(n=>"lib/simulation-runs/"+id+"/"+n+".json")),
 "lib/simulation-runs/"+BASE_RUNS.A[0]+"/stage1-capture.json","lib/simulation-runs/"+BASE_RUNS.D[0]+"/stage1-capture.json"];
 const protectedHashes=Object.fromEntries(files.map(p=>[p,bytes(p)]));
 for(const [path,hash] of Object.entries(captures.D.sourceHashes)) assert.equal(bytes(path),hash,path);
 return {runs,captures,protectedHashes};
}
export function verifyProtection(hashes:Record<string,string>) {for(const [path,hash] of Object.entries(hashes)) assert.equal(bytes(path),hash,path);}
export function verifyCohort(actual: Run, expected: Run) {
 assert.deepEqual(actual.records.map(r=>r.raceId),expected.records.map(r=>r.raceId));
 assert.equal(actual.model.trainedThroughDate,expected.model.trainedThroughDate);
 actual.records.forEach((r,i)=>{
  const old=expected.records[i];assert.equal(r.date,old.date);assert.equal(sha256(r.actual),sha256(old.actual));
  assert.deepEqual(r.predictions.map(p=>[p.horseId,p.horseNumber]).sort(),old.predictions.map(p=>[p.horseId,p.horseNumber]).sort());
  assert(actual.model.trainedThroughDate!<r.date);
  for(const p of r.predictions) for(const reason of p.reasons) {
   assert(Number.isFinite(reason.contribution));
   const raw=reason.rawValue as {sourceRows:{date:string;raceId:string|null}[]};
   for(const past of raw.sourceRows) assert(past.date<r.date && past.raceId!==r.raceId);
  }
 });
}
