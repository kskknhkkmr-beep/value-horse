/** Frozen-v2 prediction audit only. No training, tuning or external data access. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { canonical, sha256 } from "./simulator/canonical";
import { loadDevelopment } from "./simulator/input";
import { loadRun } from "./simulator/store";
import { marketTopN } from "./simulator/runner";
import { flatExclusionReason } from "./simulator/race-kind";
import { prepareInputV2 } from "./stage1-v2-input";
import { derive, independentInput, trainingExample, unsupported, FEATURES, SETTINGS, softmax } from "./stage1-independent-v2";
import type { Example } from "./stage1-independent-v2";
import { WINDOWS, fingerprints } from "./run-stage1-v2";
import type { execute } from "./run-stage1-v2";
import { observe, describe, compare, caseGroups } from "./stage1-first-audit-core";
import type { AuditRow, Strategy } from "./stage1-first-audit-core";
import { pairedRateCI } from "./stage1-v2-audit-core";
if(process.argv.length!==4||process.argv[2]!=="--retrospective-final-odds"||!/^--capture=[a-f0-9]{64}$/.test(process.argv[3])) throw new Error("Only explicit retrospective mode and immutable capture ID");
const firstId=process.argv[3].slice(10);
const baselineDir="lib/simulation-runs/stage1-flat-baseline-95baa04f1c4e1f1fc8bcb8c5aab84e114b406a159a975cbdb8287dee055b16ea";
const paths=[`lib/simulation-runs/${firstId}/stage1-capture.json`,`${baselineDir}/summary.json`,`${baselineDir}/rows.json`];
function noLinks(path:string){let p=process.cwd();for(const part of path.split(/[\\/]/)){if(part===".."||part==="")throw new Error("Invalid path");p=join(p,part);if(lstatSync(p,{throwIfNoEntry:false})?.isSymbolicLink())throw new Error("Linked path");}}
const bytesHash=(f:string)=>{noLinks(f);return createHash("sha256").update(readFileSync(f)).digest("hex");};
function read<T>(f:string):T{if(!paths.includes(f))throw new Error("Not allowlisted");noLinks(f);return JSON.parse(readFileSync(f,"utf8")) as T;}
loadRun(firstId);
type Capture=Omit<ReturnType<typeof execute>,"runs">&{runIds:string[];performanceEvaluated:boolean};
const capture=read<Capture>(paths[0]),data=loadDevelopment();
assert.deepEqual(capture.sourceHashes,data.sourceHashes);assert.deepEqual(capture.windows,WINDOWS);assert.deepEqual(capture.settings,SETTINGS);
assert.deepEqual(capture.classification,data.classification);assert.equal(capture.runIds[0],firstId);
assert.equal(capture.statuses.length,1338);assert.equal(new Set(capture.statuses.map(s=>s.raceId)).size,1338);
assert.equal(data.races.filter(r=>flatExclusionReason(r)===null).length,1292);
const {auditId:baseId,sourceCommit:baseCommit,codeHashes:baseCode,reportSha256:baseHash,...baseReport}=read<Record<string,unknown>>(paths[1]);
assert.equal(sha256(baseReport),baseHash);assert.equal(sha256({sourceCommit:baseCommit,codeHashes:baseCode,reportSha256:baseHash}),baseId);
const sourceHashes=baseReport.sourceHashes as Record<string,string>;
assert.deepEqual(Object.keys(sourceHashes).sort(),["lib/backfill/races.json","lib/backfill-stage1/race-details-raw.json","lib/backfill-stage1/horse-history-raw.json","lib/backfill/races-cache.json","lib/backfill/scores-cache.json","lib/backfill/horses.json"].sort());
for(const [f,h] of Object.entries(sourceHashes))assert.equal(bytesHash(f),h);
const baseRows=read<AuditRow[]>(paths[2]);assert.equal(baseRows.length,742);assert.equal(new Set(baseRows.map(r=>r.raceId)).size,742);
const savedHashes=Object.fromEntries(paths.map(p=>[p,bytesHash(p)]));
const specs=new Map(data.races.map(r=>[r.raceId,r])),baseById=new Map(baseRows.map(r=>[r.raceId,r]));
const featured=new Map(data.races.filter(r=>flatExclusionReason(r)===null).map(r=>[r.raceId,derive(independentInput(prepareInputV2(r,data.historyByHorse)))]));
const hashes=fingerprints(),rows:AuditRow[]=[],legacyVhRows:AuditRow[]=[],chronology:unknown[]=[],quality:unknown[]=[],reasonLogs:unknown[]=[];
const seen=new Set<string>();
for(const [i,w] of WINDOWS.entries()){
  const artifact=capture.artifacts[i];assert.deepEqual(artifact.settings,SETTINGS);assert.deepEqual(artifact.features,FEATURES);assert.equal(artifact.trainedThroughDate,w.cutoff);
  const examples:Example[]=[],excluded:typeof artifact.excluded=[];
  for(const r of [...data.races].filter(r=>r.date<=w.cutoff).sort((a,b)=>a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId))){
    const reason=flatExclusionReason(r)??unsupported(featured.get(r.raceId)!,r.surface);
    if(reason){excluded.push({raceId:r.raceId,reason});continue;}
    const e=trainingExample(featured.get(r.raceId)!,data.truthByRace[r.raceId],w.cutoff);
    if(typeof e==="string")excluded.push({raceId:r.raceId,reason:e});else examples.push(e);
  }
  assert.deepEqual(artifact.excluded,excluded);assert.equal(sha256(examples),artifact.trainingSha256);assert.deepEqual(artifact.trainingRaceIds,examples.map(e=>e.input.raceId));
  const means=FEATURES.map((_,j)=>{const a=examples.flatMap(e=>e.input.horses.map(h=>h.features[j].value)).filter((v):v is number=>v!==null);return a.reduce((x,y)=>x+y,0)/a.length;});
  assert.deepEqual(artifact.means,means);
  const run=loadRun(capture.runIds[i]);assert.equal(run.model.codeSha256,hashes.codeSha256);assert.equal(run.simulatorSha256,hashes.simulatorSha256);
  assert.equal((run.model.config as {artifactSha256:string}).artifactSha256,sha256(artifact));assert.deepEqual(run.sourceHashes,data.sourceHashes);
  for(const name of ["run.json","manifest.json"])savedHashes[`lib/simulation-runs/${run.runId}/${name}`]=bytesHash(`lib/simulation-runs/${run.runId}/${name}`);
  for(const record of run.records){
    assert(!seen.has(record.raceId));seen.add(record.raceId);assert(record.date>w.cutoff&&record.date>=w.start&&record.date<=w.end);
    assert(!artifact.trainingRaceIds.includes(record.raceId));assert.equal(record.tickets.length,0);
    const spec=specs.get(record.raceId)!;assert.equal(flatExclusionReason(spec),null);assert.equal(spec.date,record.date);
    assert.deepEqual(record.actual,data.truthByRace[record.raceId]);
    const input=prepareInputV2(spec,data.historyByHorse),f=featured.get(record.raceId)!;assert.equal(record.inputSha256,sha256(input));
    const nomination=capture.nominations.find(n=>n.raceId===record.raceId)!;assert.equal(nomination.independentInputSha256,sha256(independentInput(input)));
    assert.equal(nomination.horseId,record.predictions[0].horseId);
    const sums=record.predictions.map(p=>{
      const h=f.horses.find(h=>h.horseId===p.horseId)!;assert.equal(p.reasons.length,14);
      return p.reasons.reduce((sum,r,j)=>{const x=h.features[j%7],raw=r.rawValue as {value:number|null;sourceRows:unknown;weight:number;trainingMean:number};
        assert.equal(raw.value,x.value);assert.deepEqual(raw.sourceRows,x.sourceRows);assert.equal(raw.weight,artifact.weights[j]);assert.equal(raw.trainingMean,artifact.means[j%7]);
        const v=j<7?(x.value??artifact.means[j])-artifact.means[j]:Number(x.value===null);assert(r.contribution===v*artifact.weights[j]);
        for(const prior of x.sourceRows)assert(prior.date<record.date&&prior.raceId!==record.raceId);
        return sum+r.contribution!;},0);
    });
    softmax(sums).forEach((p,j)=>assert(Math.abs(p-record.predictions[j].probability)<1e-14));
    const old=baseById.get(record.raceId);assert(old?.independent);assert.equal(old.date,record.date);
    assert.deepEqual(observe(record.actual,old.independent.horseNumber),old.independent);
    assert.deepEqual(observe(record.actual,old.market.horseNumber),old.market);
    if(old.vh)assert.deepEqual(observe(record.actual,old.vh.horseNumber),old.vh);
    const market=marketTopN(record.actual,1,spec.starters.map(h=>h.horseNumber))[0].horseNumber;
    const row:AuditRow={raceId:record.raceId,date:record.date,archivedStartTime:record.actual.archivedStartTime,
      independent:observe(record.actual,record.predictions[0].horseNumber),market:observe(record.actual,market),vh:old.independent};
    rows.push(row);legacyVhRows.push({...row,vh:old.vh});
    reasonLogs.push({raceId:row.raceId,horseNumber:record.predictions[0].horseNumber,reasons:record.predictions[0].reasons});
    for(const horse of record.predictions)for(const j of [5,6]){
      const r=horse.reasons[j],raw=r.rawValue as {value:number|null;missingReason:string|null;details:unknown};
      quality.push({raceId:row.raceId,horseId:horse.horseId,nominee:horse.rank===1,name:r.name,
        value:raw.value,missingReason:raw.missingReason,details:raw.details,contribution:r.contribution,missingContribution:horse.reasons[j+7].contribution});
    }
  }
  chronology.push({window:w.name,cutoff:w.cutoff,trainingRaces:examples.length,excludedTraining:excluded,predictionRaces:run.records.length,overlap:0,trainingHashVerified:true,meansVerified:true});
  console.log(`Verified v2 ${w.name}: ${run.records.length} predictions`);
}
assert.deepEqual([...seen].sort(),baseRows.map(r=>r.raceId).sort());assert.equal(rows.length,742);
assert.deepEqual([...seen].sort(),capture.statuses.filter(s=>s.status==="predicted; uncalibrated").map(s=>s.raceId).sort());
const summary=(group:AuditRow[])=>({v2:describe(group,"independent"),baseline:describe(group,"vh"),market:describe(group,"market")});
const paired=(group:AuditRow[],left:Strategy,right:Strategy)=>({accountingBootstrap:compare(group,left,right),win:pairedRateCI(group,left,right),place:pairedRateCI(group,left,right,"place")});
const agree=rows.filter(r=>r.independent!.horseId===r.market.horseId),disagree=rows.filter(r=>r.independent!.horseId!==r.market.horseId);
const qs=quality as {name:string;nominee:boolean;value:number|null;missingReason:string|null;contribution:number;missingContribution:number}[];
const material=[false,true].flatMap(nomineesOnly=>["cornerPosition","weightChange"].map(name=>{
 const a=qs.filter(x=>x.name===name&&(!nomineesOnly||x.nominee));
 return {name,nomineesOnly,n:a.length,used:a.filter(x=>x.value!==null).length,missing:a.filter(x=>x.value===null).length,
 missingReasons:Object.fromEntries([...new Set(a.filter(x=>x.value===null).map(x=>x.missingReason))].map(k=>[k!,a.filter(x=>x.missingReason===k).length])),
 meanContribution:a.reduce((s,x)=>s+x.contribution,0)/a.length,meanAbsoluteContribution:a.reduce((s,x)=>s+Math.abs(x.contribution),0)/a.length,
 meanMissingContribution:a.reduce((s,x)=>s+x.missingContribution,0)/a.length};
}));
const properScores={baseline:{logLoss:0,brier:0},v2:{logLoss:0,brier:0}};
const baseRuns=(baseReport.stage1References as string[]).map(loadRun);
const newRuns=capture.runIds.map(loadRun);
let properScoreRaces=0; const properScoreExcluded:string[]=[];
for(const r of rows){
 const winners=data.truthByRace[r.raceId].horses.filter(h=>h.positionRaw==="1");
 if(winners.length!==1){properScoreExcluded.push(r.raceId);continue;} properScoreRaces++;
 for(const [key,runs] of [["baseline",baseRuns],["v2",newRuns]] as const){
 const record=runs.flatMap(run=>run.records).find(x=>x.raceId===r.raceId)!;
 const p=record.predictions.find(p=>p.horseId===winners[0].horseId)!.probability;
 properScores[key].logLoss+=-Math.log(p);
 properScores[key].brier+=record.predictions.reduce((s,p)=>s+(p.probability-Number(p.horseId===winners[0].horseId))**2,0);
 }
}
for(const x of Object.values(properScores)){x.logLoss/=properScoreRaces;x.brier/=properScoreRaces;}
const groups=caseGroups(rows),legacyCommon=legacyVhRows.filter(r=>r.vh!==null);
const report={mode:"retrospective final market / confirmed payouts",settings:SETTINGS,featureNames:FEATURES,
 strategyLabels:{independent:"v2",vh:"baseline independent (not Stage 0 VH)",market:"final market"},
 overall:summary(rows),comparisons:[paired(rows,"independent","vh"),paired(rows,"independent","market")],
 agreement:summary(agree),disagreement:summary(disagree),disagreementComparison:paired(disagree,"independent","market"),
 oldVhCommon:{v2:describe(legacyCommon,"independent"),oldVh:describe(legacyCommon,"vh"),baseline:describe(rows.filter(r=>legacyCommon.some(x=>x.raceId===r.raceId)),"vh"),market:describe(legacyCommon,"market")},
 material,properScores,properScoreRaces,properScoreExcluded,chronology,statusCounts:Object.fromEntries([...new Set(capture.statuses.map(s=>s.status))].map(k=>[k,capture.statuses.filter(s=>s.status===k).length])),
 excluded:capture.statuses.filter(s=>s.window!==null&&s.status!=="predicted; uncalibrated"),caseCounts:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length])),
 examples:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.slice(0,3)])),sourceHashes,savedHashes,runIds:capture.runIds,baselineAudit:baseId,fixedEvaluationRead:false};
const codeFiles=["scripts/audit-stage1-v2.ts","scripts/stage1-v2-audit-core.ts","docs/STAGE1_V2_PLAN.md"];
const metadata={sourceCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),codeHashes:Object.fromEntries(codeFiles.map(f=>[f,bytesHash(f)])),reportSha256:sha256(report)};
for(const [f,h] of Object.entries({...sourceHashes,...savedHashes}))assert.equal(bytesHash(f),h);
const auditId=sha256(metadata),output=`lib/simulation-runs/stage1-v2-audit-${auditId}`;noLinks(output);mkdirSync(output);
for(const [name,value] of Object.entries({summary:{auditId,...metadata,...report},rows,reasons:reasonLogs,materialRows:quality}))writeFileSync(join(output,`${name}.json`),canonical(value)+"\n",{flag:"wx"});
console.log(JSON.stringify({auditId,output,overall:report.overall,comparisons:report.comparisons,material},null,2));
