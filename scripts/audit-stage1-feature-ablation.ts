/** Evaluate only fixed saved A/B/C/D predictions; never retrain or tune. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, sha256, developmentDate } from "./simulator/canonical";
import { loadRun } from "./simulator/store";
import { marketTopN } from "./simulator/runner";
import { observe } from "./stage1-first-audit-core";
import type { AuditRow } from "./stage1-first-audit-core";
import { MODELS, accounts, comparisons, sensitivity } from "./stage1-feature-ablation-audit-core";
import type { Row, Key } from "./stage1-feature-ablation-audit-core";
import { BASE_RUNS, references, verifyProtection, verifyCohort, json, bytes, noLinks } from "./stage1-feature-ablation-reference";
import type { Capture } from "./stage1-feature-ablation-reference";
import { configuration, featureNames } from "./stage1-feature-ablation-model";
import { fingerprints, WINDOWS } from "./run-stage1-feature-ablation";

if(process.argv.length!==2) throw new Error("No custom input/selection/tuning arguments");
const pointerPath="lib/simulation-runs/stage1-feature-ablation-capture.json";
const pointer=json<{codeSha256:string;simulatorSha256:string;reports:{variant:"B"|"C";runIds:string[];predictions:number}[]}>(pointerPath);
assert.deepEqual(pointer.reports.map(r=>r.variant),["B","C"]);assert.equal(pointer.codeSha256,fingerprints().codeSha256);
assert.equal(pointer.simulatorSha256,fingerprints().simulatorSha256);
const baseline=references(),protectedHashes:Record<string,string>={...baseline.protectedHashes,[pointerPath]:bytes(pointerPath)};
const runIds={A:[...BASE_RUNS.A],B:pointer.reports[0].runIds,C:pointer.reports[1].runIds,D:[...BASE_RUNS.D]};
const captures:Record<typeof MODELS[number],Capture>={A:baseline.captures.A,D:baseline.captures.D,
 B:json<Capture>("lib/simulation-runs/"+runIds.B[0]+"/stage1-capture.json"),
 C:json<Capture>("lib/simulation-runs/"+runIds.C[0]+"/stage1-capture.json")};
for(const variant of ["B","C"] as const) {
 assert.equal(runIds[variant].length,3);assert.equal(pointer.reports.find(r=>r.variant===variant)!.predictions,742);
 const c=captures[variant];assert.deepEqual(c.sourceHashes,baseline.captures.D.sourceHashes);
 assert.deepEqual(c.statuses,baseline.captures.D.statuses);assert.deepEqual(c.runIds,runIds[variant]);
 c.artifacts.forEach((a,i)=>{
  const old=baseline.captures.D.artifacts[i];
  assert.deepEqual(a.settings,configuration(variant));assert.deepEqual(a.features,featureNames(variant));
  assert.deepEqual(a.trainingRaceIds,old.trainingRaceIds);assert.deepEqual(a.excluded,old.excluded);
  assert.equal(a.trainedThroughDate,old.trainedThroughDate);assert.deepEqual(a.means.slice(0,5),old.means.slice(0,5));
  assert.equal(a.weights.length,12);assert.equal(a.means.length,6);
 });
}
const priorPath="lib/simulation-runs/stage1-v2-audit-3040df79e98cfb6b6ee769f4189a6c6f49442e7437559af55689d5da4efa3ca1/rows.json";
const prior=json<AuditRow[]>(priorPath),priorById=new Map(prior.map(r=>[r.raceId,r]));
protectedHashes[priorPath]=bytes(priorPath);
const rows=new Map<string,Row>();
type Quality={key:Key;name:string;nominee:boolean;value:number|null;missingReason:string|null;contribution:number;missingContribution:number};
const quality:Quality[]=[];
const baseValues=new Map<string,(number|null)[]>();
const addedValues=new Map<string,{B?:number|null;C?:number|null}>();
for(const key of MODELS) {
 const capture=captures[key];
 runIds[key].forEach((id,i)=>{
  const run=loadRun(id);verifyCohort(run,baseline.runs.D[i]);
  assert.equal(run.seed,0);assert.equal(run.model.trainedThroughDate,WINDOWS[i].cutoff);
  const artifact=capture.artifacts[i];
  assert.equal((run.model.config as {artifactSha256:string}).artifactSha256,sha256(artifact));
  assert.equal(run.model.version,artifact.settings.version);
  if(key==="B"||key==="C") {assert.equal(run.model.codeSha256,pointer.codeSha256);assert.equal(run.simulatorSha256,pointer.simulatorSha256);}
  for(const file of ["run","manifest","stage1-capture"]) {
   if(file==="stage1-capture"&&i!==0)continue;
   const path="lib/simulation-runs/"+id+"/"+file+".json";protectedHashes[path]=bytes(path);
  }
  const n=artifact.features.length;
  for(const record of run.records) {
   developmentDate(record.date);assert(record.tickets.length===0);
   assert(!artifact.trainingRaceIds.includes(record.raceId));
   const old=priorById.get(record.raceId)!;assert(old && old.independent && old.vh);
   const pick=observe(record.actual,record.predictions[0].horseNumber);
   const market=observe(record.actual,marketTopN(record.actual,1,record.starters.map(h=>h.horseNumber))[0].horseNumber);
   assert.deepEqual(market,old.market);
   if(key==="A")assert.deepEqual(pick,old.vh);if(key==="D")assert.deepEqual(pick,old.independent);
   if(!rows.has(record.raceId))rows.set(record.raceId,{raceId:record.raceId,date:record.date,archivedStartTime:record.actual.archivedStartTime,selections:{market} as Row["selections"]});
   const row=rows.get(record.raceId)!;assert(!row.selections[key]);row.selections[key]=pick;
   const scores:number[]=[];
   for(const p of record.predictions) {
    assert.equal(p.reasons.length,2*n);
    const values:(number|null)[]=[];
    let score=0;
    p.reasons.forEach((reason,j)=>{
     const f=j%n;assert.equal(reason.name,j<n?artifact.features[f]:artifact.features[f]+":missing");
     const raw=reason.rawValue as {value:number|null;transformed:number;trainingMean:number;weight:number;missingReason:string|null};
     assert.equal(raw.weight,artifact.weights[j]);assert.equal(raw.trainingMean,artifact.means[f]);
     const x=j<n?(raw.value??artifact.means[f])-artifact.means[f]:Number(raw.value===null);
     assert.equal(raw.transformed,x);assert(Math.abs(reason.contribution!-x*artifact.weights[j])<1e-14);
     if(j<n)values.push(raw.value);score+=reason.contribution!;
    });
    scores.push(score);
    const k=record.raceId+"/"+p.horseId;
    if(key==="A")baseValues.set(k,values.slice(0,5));else assert.deepEqual(values.slice(0,5),baseValues.get(k));
    if(key==="B"||key==="C")addedValues.set(k,{...addedValues.get(k),[key]:values[5]});
    if(key==="D"){assert.equal(values[5],addedValues.get(k)!.B);assert.equal(values[6],addedValues.get(k)!.C);}
    for(const name of ["cornerPosition","weightChange"]) {
     const index=artifact.features.indexOf(name);if(index<0)continue;
     const raw=p.reasons[index].rawValue as {value:number|null;missingReason:string|null};
     quality.push({key,name,nominee:p.rank===1,value:raw.value,missingReason:raw.missingReason,
      contribution:p.reasons[index].contribution!,missingContribution:p.reasons[index+n].contribution!});
    }
   }
   const mx=Math.max(...scores),den=scores.reduce((s,x)=>s+Math.exp(x-mx),0);
   record.predictions.forEach((p,j)=>assert(Math.abs(p.probability-Math.exp(scores[j]-mx)/den)<1e-14));
   for(let j=1;j<record.predictions.length;j++)assert(scores[j-1]>=scores[j]-1e-14);
  }
 });
 console.log("Verified "+key+": 742 saved predictions");
}
const cohort=[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId));
assert.equal(cohort.length,742);assert(cohort.every(r=>Object.keys(r.selections).length===5));
assert.deepEqual(cohort.map(r=>r.raceId).sort(),prior.map(r=>r.raceId).sort());
const material=MODELS.flatMap(key=>[false,true].flatMap(nomineesOnly=>["cornerPosition","weightChange"].map(name=>{
 const xs=quality.filter(q=>q.key===key&&q.name===name&&(!nomineesOnly||q.nominee));
 if(!xs.length)return {key,name,nomineesOnly,active:false,n:nomineesOnly?742:10583,used:0,missing:null};
 const missing=xs.filter(q=>q.value===null);
 return {key,name,nomineesOnly,active:true,n:xs.length,used:xs.length-missing.length,missing:missing.length,
  usedRate:(xs.length-missing.length)/xs.length,missingRate:missing.length/xs.length,
  reasons:Object.fromEntries([...new Set(missing.map(q=>q.missingReason))].map(k=>[k!,missing.filter(q=>q.missingReason===k).length])),
  meanContribution:xs.reduce((s,q)=>s+q.contribution,0)/xs.length,
  meanAbsContribution:xs.reduce((s,q)=>s+Math.abs(q.contribution),0)/xs.length,
  meanMissingContribution:xs.reduce((s,q)=>s+q.missingContribution,0)/xs.length};
})));
for(const key of ["B","C","D"] as const) {
 const active=material.filter(q=>q.key===key&&q.active&&!q.nomineesOnly);
 active.forEach(q=>{assert.equal(q.n,10583);assert.equal(q.used,q.name==="cornerPosition"?9582:9888);});
}
const report={mode:"independent retraining B/C; saved A/D; known development; final market reference only",
 runIds,settings:{stakeYen:1000,bootstrapIterations:10000,rateSeed:20261010,roiSeed:20261009},
 overall:accounts(cohort),comparisons:comparisons(cohort),sensitivity:sensitivity(cohort),material,
 chronology:WINDOWS.map((w,i)=>({...w,training:captureTraining(i),predictions:baseline.runs.D[i].records.length})),
 coefficients:Object.fromEntries(MODELS.map(k=>[k,captures[k].artifacts.map(a=>({cutoff:a.trainedThroughDate,features:a.features,means:a.means,weights:a.weights,trainingSha256:a.trainingSha256}))])),
 agreement:Object.fromEntries(MODELS.map(k=>[k,{same:cohort.filter(r=>r.selections[k].horseId===r.selections.market.horseId).length,
  sameAccounts:accounts(cohort.filter(r=>r.selections[k].horseId===r.selections.market.horseId)),
  differentAccounts:accounts(cohort.filter(r=>r.selections[k].horseId!==r.selections.market.horseId))}])),
 protectedHashes,fixedEvaluationRead:false};
function captureTraining(i:number){return Object.fromEntries(MODELS.map(k=>[k,{count:captures[k].artifacts[i].trainingRaceIds.length,idsSha256:sha256(captures[k].artifacts[i].trainingRaceIds)}]));}
assert.equal(report.overall.A.profitYen,-228300);assert.equal(report.overall.D.profitYen,-182200);
verifyProtection(protectedHashes);
const codeFiles=["scripts/audit-stage1-feature-ablation.ts","scripts/stage1-feature-ablation-audit-core.ts",
 "scripts/stage1-feature-ablation-reference.ts","docs/STAGE1_FEATURE_ABLATION_PLAN.md"];
const metadata={sourceCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
 codeHashes:Object.fromEntries(codeFiles.map(p=>[p,bytes(p)])),reportSha256:sha256(report)};
const auditId=sha256(metadata),output="lib/simulation-runs/stage1-feature-ablation-"+auditId;
noLinks(output);mkdirSync(output);
writeFileSync(join(output,"summary.json"),canonical({auditId,...metadata,...report})+"\n",{flag:"wx"});
writeFileSync(join(output,"rows.json"),canonical(cohort)+"\n",{flag:"wx"});
console.log(JSON.stringify({auditId,output,overall:report.overall,comparisons:report.comparisons.map(c=>({left:c.left,right:c.right,changedCount:c.changedCount,win:c.win,roiCI:c.money.pairedRoiDifference95CI}))},null,2));
