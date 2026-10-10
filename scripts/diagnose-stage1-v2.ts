/** Saved-742R diagnosis only. No raw feature generation, fitting or tuning. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, sha256, developmentDate } from "./simulator/canonical";
import { loadRun } from "./simulator/store";
import { observe, compare } from "./stage1-first-audit-core";
import type { AuditRow } from "./stage1-first-audit-core";
import { pairedRateCI } from "./stage1-v2-audit-core";
import { MASKS, ranking, contributionGap, changedPick, profitDelta, pairedAccounts, outcomeGroups,
  commonSensitivity, firstExamples } from "./stage1-v2-diagnosis-core";
import type { Mask } from "./stage1-v2-diagnosis-core";

if (process.argv.length !== 2) throw new Error("No custom paths, masks or selection arguments");
const prior = "lib/simulation-runs/stage1-v2-audit-3040df79e98cfb6b6ee769f4189a6c6f49442e7437559af55689d5da4efa3ca1";
const SOURCES = ["lib/backfill/races.json", "lib/backfill-stage1/race-details-raw.json",
  "lib/backfill-stage1/horse-history-raw.json", "lib/backfill/races-cache.json",
  "lib/backfill/scores-cache.json", "lib/backfill/horses.json"];
const RUNS = ["34b2243bf3b35bb1ee2a73bc16b2625771142c6b120d215a44df613a56ec1de5",
  "38287a768f3ef96f2f44d5418acf2df921a098966114e23bc54b6e092decec13",
  "5c8d953580d0f32a5883f0a994168f427d5cf42013883b7f7dd80e0235c61483"];
function noLinks(path: string) {
  assert(!path.includes("..") && !path.includes(".sealed-data") && !path.startsWith("/") && !path.includes(":"));
  let cursor = process.cwd();
  for (const part of path.split("/")) { cursor = join(cursor,part); assert(!lstatSync(cursor,{throwIfNoEntry:false})?.isSymbolicLink(),"Linked path"); }
}
function bytes(path: string) { noLinks(path); return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function json<T>(path: string): T { noLinks(path); return JSON.parse(readFileSync(path,"utf8")) as T; }
type Prior = { auditId: string; sourceCommit: string; codeHashes: Record<string,string>; reportSha256: string;
  runIds: string[]; sourceHashes: Record<string,string>; savedHashes: Record<string,string>; settings: { temperature: number };
  material: unknown; overall: { v2: {profitYen:number}; baseline: {profitYen:number} } };
const summary = json<Prior>(prior + "/summary.json"), rows = json<AuditRow[]>(prior + "/rows.json");
const { auditId, sourceCommit, codeHashes, reportSha256, ...oldReport } = summary;
assert.equal(sha256(oldReport),reportSha256);
assert.equal(sha256({sourceCommit,codeHashes,reportSha256}),auditId);
assert.deepEqual(summary.runIds,RUNS); assert.equal(summary.settings.temperature,1);
assert.equal(rows.length,742); assert.equal(new Set(rows.map(r=>r.raceId)).size,742);
assert(rows.every(r=>r.independent && r.vh));
assert.deepEqual(Object.keys(summary.sourceHashes).sort(),[...SOURCES].sort());
const protectedHashes: Record<string,string> = { ...summary.sourceHashes };
for(const [path,hash] of Object.entries(summary.savedHashes)) {
  assert(/^lib\/simulation-runs\/(?:[a-f0-9]{64}|stage1-flat-baseline-[a-f0-9]{64})\/(?:stage1-capture|summary|rows|run|manifest)\.json$/.test(path));
  protectedHashes[path]=hash;
}
for(const path of [prior+"/summary.json",prior+"/rows.json",
  "scripts/stage1-independent.ts","scripts/stage1-independent-v2.ts","scripts/run-stage1-v2.ts",
  "scripts/stage1-v2-input.ts","scripts/simulator/stage1-v2-runner.ts","docs/STAGE1_V2_RESULTS.md"]) protectedHashes[path]=bytes(path);
for(const [path,hash] of Object.entries(protectedHashes)) assert.equal(bytes(path),hash,path);
const byId=new Map(rows.map(r=>[r.raceId,r])),seen=new Set<string>(),gaps: unknown[]=[],quality: {
  name:string;nominee:boolean;value:number|null;missingReason:string|null;contribution:number;missingContribution:number}[]=[];
const counterfactuals:Record<Mask,AuditRow[]>={none:[],withoutCorner:[],withoutWeight:[]};
const decisions: unknown[]=[];
for(const id of RUNS) {
 const run=loadRun(id);
 assert.equal(run.model.version,"stage1-independent-position-weight-v2");
 for(const record of run.records) {
  developmentDate(record.date); assert(!seen.has(record.raceId));seen.add(record.raceId);
  assert(run.model.trainedThroughDate !== null && run.model.trainedThroughDate < record.date);
  const saved=byId.get(record.raceId)!;assert(saved && saved.date===record.date);
  assert.deepEqual(observe(record.actual,saved.independent!.horseNumber),saved.independent);
  assert.deepEqual(observe(record.actual,saved.vh!.horseNumber),saved.vh);
  for(const p of record.predictions) for(const reason of p.reasons) {
   const raw=reason.rawValue as {sourceRows:{date:string;raceId:string|null}[]};
   for(const past of raw.sourceRows) assert(past.date<record.date && past.raceId!==record.raceId);
  }
  const variants: Record<string,unknown>={};
  for(const mask of MASKS) {
   const ranked=ranking(record.predictions,mask);
   if(mask==="none") {
    assert.deepEqual(ranked.map(p=>p.horseId),record.predictions.map(p=>p.horseId));
    ranked.forEach((p,j)=>assert(Math.abs(p.probability-record.predictions[j].probability)<1e-14));
   }
   const choice=ranked[0]; variants[mask]=choice;
   counterfactuals[mask].push({...saved,independent:observe(record.actual,choice.horseNumber),vh:saved.independent});
  }
  decisions.push({raceId:record.raceId,date:record.date,choices:variants});
  if(changedPick(saved)) {
   const previous=record.predictions.find(p=>p.horseId===saved.vh!.horseId)!;
   const gap=contributionGap(record.predictions[0],previous);assert(gap.total>=-1e-14);
   gaps.push({raceId:record.raceId,date:record.date,...gap});
  }
  for(const p of record.predictions) for(const j of [5,6]) {
   const r=p.reasons[j],raw=r.rawValue as {value:number|null;missingReason:string|null};
   quality.push({name:r.name,nominee:p.rank===1,value:raw.value,missingReason:raw.missingReason,
    contribution:r.contribution!,missingContribution:p.reasons[j+7].contribution!});
  }
 }
}
assert.deepEqual([...seen].sort(),rows.map(r=>r.raceId).sort());
const material=[false,true].flatMap(nomineesOnly=>["cornerPosition","weightChange"].map(name=>{
 const a=quality.filter(q=>q.name===name&&(!nomineesOnly||q.nominee));
 return {name,nomineesOnly,n:a.length,used:a.filter(q=>q.value!==null).length,missing:a.filter(q=>q.value===null).length,
  missingReasons:Object.fromEntries([...new Set(a.filter(q=>q.value===null).map(q=>q.missingReason))].map(k=>[k!,a.filter(q=>q.missingReason===k).length])),
  meanContribution:a.reduce((s,q)=>s+q.contribution,0)/a.length,
  meanAbsoluteContribution:a.reduce((s,q)=>s+Math.abs(q.contribution),0)/a.length,
  meanMissingContribution:a.reduce((s,q)=>s+q.missingContribution,0)/a.length};
}));
assert.deepEqual(material,summary.material);
const changed=rows.filter(changedPick),same=rows.filter(r=>!changedPick(r));
const groups=outcomeGroups(changed);
const paired=(xs:AuditRow[])=>({win:pairedRateCI(xs,"independent","vh"),money:compare(xs,"independent","vh")});
const ablations=MASKS.filter(m=>m!=="none").map(mask=>{
 const xs=counterfactuals[mask];
 return {mask,accounts:pairedAccounts(xs),comparison:paired(xs),pickChanges:xs.filter(changedPick).length};
});
const signed=(xs:AuditRow[])=>({n:xs.length,sumDelta:xs.reduce((s,r)=>s+profitDelta(r),0)});
const report={priorAuditId:auditId,runIds:RUNS,mode:"saved fixed-v2 score removal; no retraining; retrospective final market",
 overall:pairedAccounts(rows),changed:pairedAccounts(changed),same:pairedAccounts(same),
 groups:Object.fromEntries(Object.entries(groups).map(([k,xs])=>[k,pairedAccounts(xs)])),
 signedChanges:{positive:signed(changed.filter(r=>profitDelta(r)>0)),negative:signed(changed.filter(r=>profitDelta(r)<0)),
  zero:signed(changed.filter(r=>profitDelta(r)===0))},
 comparisons:{overall:paired(rows),changed:paired(changed)},
 sensitivity:["v2Payout","eitherPayout","positiveDelta"].flatMap(b=>commonSensitivity(rows,b as "v2Payout"|"eitherPayout"|"positiveDelta")),
 windows:[{name:"A",start:"2026-04-04",end:"2026-04-26"},{name:"B",start:"2026-05-02",end:"2026-05-31"},{name:"C",start:"2026-06-06",end:"2026-06-21"}]
  .map(w=>({...w,accounts:pairedAccounts(rows.filter(r=>r.date>=w.start&&r.date<=w.end)),
   changed:rows.filter(r=>r.date>=w.start&&r.date<=w.end&&changedPick(r)).length})),
 ablations,material,examples:firstExamples(rows),gapSummary:(gaps as {legacy:number;corner:number;weight:number;total:number}[])
  .reduce<{n:number;legacy:number;corner:number;weight:number;total:number}>((a,g)=>({n:a.n+1,legacy:a.legacy+g.legacy,corner:a.corner+g.corner,weight:a.weight+g.weight,total:a.total+g.total}),{n:0,legacy:0,corner:0,weight:0,total:0}),
 protectedHashes,fixedEvaluationRead:false};
assert.equal(report.overall.profitDifference,46100);
assert.equal(report.overall.v2.profitYen,summary.overall.v2.profitYen);
assert.equal(report.overall.previous.profitYen,summary.overall.baseline.profitYen);
assert.equal(report.same.profitDifference,0);
assert.equal(report.changed.profitDifference,report.overall.profitDifference);
for(const [path,hash] of Object.entries(protectedHashes)) assert.equal(bytes(path),hash,path);
const codeFiles=["scripts/diagnose-stage1-v2.ts","scripts/stage1-v2-diagnosis-core.ts","docs/STAGE1_V2_DIAGNOSIS_PLAN.md"];
const metadata={sourceCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
 codeHashes:Object.fromEntries(codeFiles.map(p=>[p,bytes(p)])),reportSha256:sha256(report)};
const diagnosisId=sha256(metadata),output="lib/simulation-runs/stage1-v2-diagnosis-"+diagnosisId;
noLinks(output);mkdirSync(output);
for(const [name,value] of Object.entries({summary:{diagnosisId,...metadata,...report},gaps,counterfactuals:decisions}))
 writeFileSync(join(output,name+".json"),canonical(value)+"\n",{flag:"wx"});
console.log(JSON.stringify({diagnosisId,output,changed:report.changed,groups:report.groups,signed:report.signedChanges,
 comparisons:report.comparisons,ablations:report.ablations},null,2));
