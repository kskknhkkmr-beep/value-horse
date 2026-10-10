/** Saved development selections only. No model imports, fitting or prediction. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync,mkdirSync,writeFileSync } from "node:fs";
import { canonical,developmentDate,sha256 } from "./simulator/canonical";
import { settleTicket } from "./simulator/settlement";
import type { Run } from "./simulator/types";
import type { AuditRow } from "./stage1-first-audit-core";
import { BASE_RUNS,bytes,json,noLinks,verifyProtection,type Capture } from "./stage1-feature-ablation-reference";
import { cohort,type Row,type Pick } from "./stage1-place-axis-core";
if(process.argv.length!==3 || process.argv[2]!=="--retrospective-confirmed-payouts")throw new Error("Explicit retrospective mode required");
const flat="lib/simulation-runs/stage1-flat-baseline-95baa04f1c4e1f1fc8bcb8c5aab84e114b406a159a975cbdb8287dee055b16ea";
const ablation="lib/simulation-runs/stage1-feature-ablation-97b87090839c7c415a8f00bc7b3217efb4ba92e9b4a0972320c190d4b9ed18db";
const stage0="lib/simulation-runs/stage0-audit-60a3f5fa66139c692759757d1a205d9891d2f6d60384d50d515585528baedad8";
type Proof={protectedHashes:Record<string,string>;savedHashes:Record<string,string>;sourceHashes:Record<string,string>};
const flatProof=json<Proof>(flat+"/summary.json"),ablationProof=json<Proof>(ablation+"/summary.json");
const protectedHashes={...flatProof.savedHashes,...flatProof.sourceHashes,...ablationProof.protectedHashes};
for(const path of [flat+"/summary.json",flat+"/rows.json",ablation+"/summary.json",ablation+"/rows.json"])protectedHashes[path]=bytes(path);
verifyProtection(protectedHashes);
type Log={raceId:string;date:string;picks:number[];horses:{id:number;horseId:string;horseNumber:number;confirmedPlaceSettlement:Pick["fuku"]}[]};
const logs=json<Log[]>(stage0+"/logs.json"),byLog=new Map(logs.map(r=>[r.raceId,r]));
assert.equal(logs.length,1338);assert.equal(byLog.size,1338);
const base=json<AuditRow[]>(flat+"/rows.json"),byBase=new Map(base.map(r=>[r.raceId,r]));
assert.equal(base.length,742);assert.equal(byBase.size,742);
const cap=json<Capture & {classification:{races:{raceId:string;date:string;kind:string}[]}}>("lib/simulation-runs/"+BASE_RUNS.D[0]+"/stage1-capture.json");
assert.equal(cap.statuses.length,1338);
const classification=new Map(cap.classification.races.map(r=>[r.raceId,r]));
assert.equal(classification.size,1338);
const flatRace=(raceId:string)=>["芝","ダ"].includes(classification.get(raceId)?.kind??"");
const flatCount=cap.statuses.filter(s=>flatRace(s.raceId)).length;
const initialFlat=cap.statuses.filter(s=>flatRace(s.raceId) && s.status==="initial training period; no out-of-sample prediction").length;
const noPrediction=cap.statuses.filter(s=>flatRace(s.raceId) && s.status==="all horses lack valid prior finishes").length;
assert.equal(flatCount,1292);assert.equal(initialFlat,527);assert.equal(noPrediction,23);
assert.equal(cap.classification.races.filter(r=>r.kind==="障").length,46);
assert.equal(cap.classification.races.filter(r=>r.kind==="unknown").length,0);
const rows:Row[]=[],rankCoverage:{raceId:string;starters:number;predictions:number;allReasons:boolean;allContributions:boolean}[]=[];
const payoutCoverage:Record<string,number>={},twoPlaceRows:string[]=[],thirdNotPaid:{raceId:string;key:string;horseNumber:number}[]=[];
for(const id of BASE_RUNS.D) {
 const run=json<Run>("lib/simulation-runs/"+id+"/run.json");assert.equal(run.runId,id);
 for(const [path,hash] of Object.entries(run.sourceHashes))assert.equal(bytes(path),hash);
 for(const record of run.records) {
  developmentDate(record.date);assert(run.model.trainedThroughDate!<record.date);assert(flatRace(record.raceId));
  assert.equal(classification.get(record.raceId)?.date,record.date);
  const old=byBase.get(record.raceId);assert(old);assert.equal(record.date,old.date);
  const actual=record.actual;assert.equal(actual.raceId,record.raceId);assert.equal(actual.date,record.date);
  assert.equal(new Set(record.predictions.map(p=>p.horseId)).size,record.starters.length);
  assert.deepEqual(record.predictions.map(p=>p.rank),Array.from({length:record.starters.length},(_,i)=>i+1));
  const starterIds=new Set(record.starters.map(s=>s.horseId));
  for(const p of record.predictions) {
   assert(starterIds.has(p.horseId));assert(Number.isFinite(p.probability));assert(p.probability>=0 && p.probability<=1);
   assert.equal(record.starters.find(s=>s.horseId===p.horseId)?.horseNumber,p.horseNumber);
   for(const reason of p.reasons){const raw=reason.rawValue as {sourceRows?:{date:string;raceId:string|null}[]};
    for(const history of raw?.sourceRows??[])assert(history.date<record.date && history.raceId!==record.raceId);}
  }
  rankCoverage.push({raceId:record.raceId,starters:record.starters.length,predictions:record.predictions.length,
   allReasons:record.predictions.every(p=>p.reasons.length>0),allContributions:record.predictions.every(p=>p.reasons.every(r=>Number.isFinite(r.contribution)))});
  for(const kind of ["fuku","wide","sanfuku"] as const){const payout=actual.payouts[kind];const key=kind+"/"+payout.status;payoutCoverage[key]=(payoutCoverage[key]??0)+1;
   if(kind==="fuku" && payout.entries.length===2)twoPlaceRows.push(record.raceId);}
  const pick=(n:number):Pick=>{const h=actual.horses.find(h=>h.horseNumber===n);assert(h);assert(starterIds.has(h.horseId));
   return {horseId:h.horseId,horseNumber:n,positionRaw:h.positionRaw,popularity:h.popularity,
    tan:settleTicket({kind:"tan",horses:[n],stakeYen:1000},actual),fuku:settleTicket({kind:"fuku",horses:[n],stakeYen:1000},actual)}};
  const log=byLog.get(record.raceId);assert(log);assert.equal(log.date,record.date);
  // Stage 0 saved picks are horse NUMBERS, not engine IDs (audit-stage0.ts).
  const a=log.picks.length?log.horses.find(h=>h.horseNumber===log.picks[0]):null;
  if(log.picks.length)assert(a);
  const b=pick(record.predictions[0].horseNumber),c=pick(old.market.horseNumber);
  assert.equal(c.popularity,1);assert.equal(b.horseId,actual.horses.find(h=>h.horseNumber===b.horseNumber)!.horseId);
  assert.deepEqual(c.tan,old.market.settlement);
  const picks:Row["picks"]={B:b,C:c};
  if(a){assert(old.vh);assert.equal(a.horseId,old.vh.horseId);picks.A=pick(a.horseNumber);assert.deepEqual(picks.A.tan,old.vh.settlement);assert.deepEqual(picks.A.fuku,a.confirmedPlaceSettlement);}
  else assert.equal(old.vh,null);
  for(const [key,p] of Object.entries(picks))if(p!.positionRaw==="3" && p!.fuku.status==="loss")thirdNotPaid.push({raceId:record.raceId,key,horseNumber:p!.horseNumber});
  rows.push({raceId:record.raceId,date:record.date,archivedStartTime:actual.archivedStartTime,picks});
 }
}
assert.equal(rows.length,742);assert.equal(new Set(rows.map(r=>r.raceId)).size,742);
const reference=json<{raceId:string;selections:{D:{horseId:string;positionRaw:string;settlement:Pick["tan"]};market:{horseId:string;positionRaw:string;settlement:Pick["tan"]}}}[]>(ablation+"/rows.json");
const refById=new Map(reference.map(r=>[r.raceId,r]));
for(const r of rows){const ref=refById.get(r.raceId);assert(ref);for(const [key,prior] of [["B",ref.selections.D],["C",ref.selections.market]] as const){assert.equal(r.picks[key]!.horseId,prior.horseId);assert.equal(r.picks[key]!.positionRaw,prior.positionRaw);assert.deepEqual(r.picks[key]!.tan,prior.settlement);}}
const common=rows.filter(r=>r.picks.A);assert.equal(common.length,679);
const codeFiles=["scripts/audit-stage1-place-axis.ts","scripts/stage1-place-axis-core.ts","docs/STAGE1_PLACE_AND_AXIS_AUDIT_PLAN.md"];
const metadata={sourceCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),codeHashes:Object.fromEntries(codeFiles.map(p=>[p,bytes(p)]))};
const result={mode:"retrospective confirmed payouts; NOT deployable EV",fixedEvaluationRead:false,modelChanged:false,
 labels:{A:"Stage 0 EV-selected VH (NOT ablation A)",B:"Stage 1 v2",C:"final market favorite"},
 exclusions:{development:cap.statuses.length,flat:flatCount,jumps:46,unknown:0,flatInitialLearning:initialFlat,flatNoPrediction:noPrediction,
  missingStage0:rows.filter(r=>!r.picks.A).map(r=>({raceId:r.raceId,date:r.date,reason:"Saved Stage 0 has no eligible recommendation"})),
  savedStatuses:cap.statuses.reduce<Record<string,number>>((o,s)=>{o[s.status]=(o[s.status]??0)+1;return o},{})},
 main:cohort(common,["A","B","C"]),auxiliary:cohort(rows,["B","C"]),
 rankCoverage,payoutCoverage,twoPlaceRows,thirdNotPaid,protectedHashes};
verifyProtection(protectedHashes);
const reportSha256=sha256(result),auditId=sha256({...metadata,reportSha256}),out="lib/simulation-runs/stage1-place-axis-audit-"+auditId;
noLinks(out);assert(!existsSync(out),"Append-only; existing report must not be overwritten");
mkdirSync(out);writeFileSync(out+"/summary.json",canonical({auditId,...metadata,reportSha256,...result})+"\n");
writeFileSync(out+"/rows.json",canonical(rows)+"\n");
console.log(JSON.stringify({auditId,reportSha256,out,mainRaces:common.length,auxiliaryRaces:rows.length,
 unresolved:result.main.unresolved.length+result.auxiliary.unresolved.length,payoutCoverage,
 rankRows:rankCoverage.length,rankHorses:rankCoverage.reduce((n,r)=>n+r.predictions,0),twoPlaceRaces:twoPlaceRows.length},null,2));
