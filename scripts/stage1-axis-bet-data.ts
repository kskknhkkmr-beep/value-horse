/** Read-only development preflight. No generation, fitting or performance calculation. */
import assert from "node:assert/strict";
import { sha256,developmentDate } from "./simulator/canonical";
import { classifyRaceKind } from "./simulator/race-kind";
import type { Run,Payout,Truth } from "./simulator/types";
import { json,bytes,verifyProtection,BASE_RUNS } from "./stage1-feature-ablation-reference";
type RawHorse={horseId:string;horseNumber:number;preRace:{carriedWeight:number|null};
 result:{positionRaw:string|null;raceTimeRaw:string|null;marginRaw:string|null;final3fRaw:string|null;
 cornerPositionsRaw:string|null;oddsRaw:string|null;popularity:number|null}};
type RawDetail={date:string;preRace:{class:{raw:string|null;grade:string|null}};horses:RawHorse[];labels:{payouts:Record<string,Payout>}};
export function loadAxisData() {
 const prior="lib/simulation-runs/stage1-place-axis-audit-cdf7b536284b5c42781dd7bc60fddebc252247fd7500d2d2862e59f962f170c7";
 const proof=json<{auditId:string;sourceCommit:string;codeHashes:Record<string,string>;reportSha256:string;protectedHashes:Record<string,string>}>(prior+"/summary.json");
 const {auditId,sourceCommit,codeHashes,reportSha256,...payload}=proof;
 assert.equal(sha256(payload),reportSha256);assert.equal(sha256({sourceCommit,codeHashes,reportSha256}),auditId);
 const protectedHashes={...proof.protectedHashes,[prior+"/summary.json"]:bytes(prior+"/summary.json")};
 verifyProtection(protectedHashes);
 const raw=json<{races:Record<string,{date:string;surface:string;raceName:string;horses:{horseId:string;horseNumber:number}[]}>}>("lib/backfill/races.json").races;
 const details=json<{races:Record<string,RawDetail>}>("lib/backfill-stage1/race-details-raw.json").races;
 assert.equal(Object.keys(raw).length,1338);assert.equal(Object.keys(details).length,1338);
 const records:Run["records"]=[],seen=new Set<string>(),status:Record<string,number>={},names=new Set<string>();
 let horses=0,extraCancelledResults=0;
 for(const id of BASE_RUNS.D) {
  const run=json<Run>("lib/simulation-runs/"+id+"/run.json");
  const manifest=json<{complete:boolean;runId:string;runSha256:string}>("lib/simulation-runs/"+id+"/manifest.json");
  assert.equal(manifest.complete,true);assert.equal(manifest.runId,id);assert.equal(run.runId,id);
  assert.equal(manifest.runSha256,sha256(run));
  const {runId,...runPayload}=run;assert.equal(sha256(runPayload),runId);
  for(const rec of run.records) {
   developmentDate(rec.date);assert(!seen.has(rec.raceId));seen.add(rec.raceId);
   const src=raw[rec.raceId],d=details[rec.raceId];assert(src&&d);assert.equal(src.date,rec.date);assert.equal(d.date,rec.date);
   assert(run.model.trainedThroughDate && run.model.trainedThroughDate<rec.date);
   assert(["芝","ダ"].includes(classifyRaceKind({surface:src.surface,raceName:src.raceName,classRaw:d.preRace.class.raw,grade:d.preRace.class.grade}).kind));
   const a=new Map(rec.starters.map(h=>[h.horseId,h.horseNumber]));
   assert.equal(a.size,rec.starters.length);assert.equal(new Set(a.values()).size,a.size);
   assert.deepEqual([...a].sort(),src.horses.map(h=>[h.horseId,h.horseNumber]).sort());
   assert.equal(rec.predictions.length,a.size);assert.equal(new Set(rec.predictions.map(p=>p.horseId)).size,a.size);
   const t=new Map(rec.actual.horses.map(h=>[h.horseId,h.horseNumber]));
   assert.equal(t.size,rec.actual.horses.length);assert.equal(new Set(t.values()).size,t.size);
   const expected:Truth["horses"]=d.horses.map(h=>({horseId:h.horseId,horseNumber:h.horseNumber,
    positionRaw:h.result.positionRaw,raceTimeRaw:h.result.raceTimeRaw,marginRaw:h.result.marginRaw,final3fRaw:h.result.final3fRaw,
    cornerPositionsRaw:h.result.cornerPositionsRaw,finalOddsRaw:h.result.oddsRaw,popularity:h.result.popularity}));
   assert.equal(sha256(rec.actual.horses),sha256(expected));assert.equal(rec.actual.raceId,rec.raceId);assert.equal(rec.actual.date,rec.date);
   assert.deepEqual(rec.predictions.map(p=>p.rank),Array.from({length:a.size},(_,i)=>i+1));
   assert(Math.abs(rec.predictions.reduce((n,p)=>n+p.probability,0)-1)<1e-6);
   const scores=rec.predictions.map(p=>p.reasons.reduce((n,r)=>n+r.contribution!,0)),max=Math.max(...scores),
    denominator=scores.reduce((n,s)=>n+Math.exp(s-max),0);
   for(const [i,p]of rec.predictions.entries()){
    assert.equal(a.get(p.horseId),p.horseNumber);assert.equal(t.get(p.horseId),p.horseNumber);
    assert(Number.isFinite(p.probability)&&p.probability>=0&&p.probability<=1);
    assert(Math.abs(p.probability-Math.exp(scores[i]-max)/denominator)<1e-10,"Score/probability mismatch");
    if(i){const old=rec.predictions[i-1];assert(old.probability>p.probability||old.probability===p.probability&&old.horseNumber<p.horseNumber);}
    for(const reason of p.reasons){names.add(reason.name);assert(Number.isFinite(reason.contribution));
     assert(!/odds|popularity|payout|result/i.test(reason.name));
     const r=reason.rawValue as {sourceRows?:{date:string;raceId:string|null}[]};
     for(const h of r.sourceRows??[])assert(h.date<rec.date&&h.raceId!==rec.raceId);}
   }
   for(const h of rec.starters)assert.equal(h.carriedWeight,d.horses.find(t=>t.horseId===h.horseId)!.preRace.carriedWeight);
   for(const h of rec.actual.horses)if(!a.has(h.horseId)){assert(/^(取|除)/.test(h.positionRaw??""));extraCancelledResults++;}
   for(const kind of ["wide","sanfuku"]){
    const p=rec.actual.payouts[kind as "wide"|"sanfuku"];assert.equal(sha256(p),sha256(d.labels.payouts[kind]));
    status[kind+"/"+p.status]=(status[kind+"/"+p.status]??0)+1;
    if(p.status==="ok"){assert(p.entries.length);const keys=new Set<string>();
     for(const e of p.entries){assert.equal(e.combo?.length,kind==="wide"?2:3);assert.equal(new Set(e.combo).size,e.combo!.length);
      assert(e.combo!.every(n=>[...t.values()].includes(n)));assert(Number.isSafeInteger(e.payout)&&e.payout>0);
      const key=[...e.combo!].sort((a,b)=>a-b).join("-");assert(!keys.has(key));keys.add(key);}
     assert.equal(p.rawCombination?.trim().split(/\s+/).length,p.entries.length);assert.equal(p.rawPayout?.trim().split(/\s+/).length,p.entries.length);
    }
   }
   records.push(rec);horses+=a.size;
  }
 }
 assert.equal(records.length,742);assert.equal(horses,10583);verifyProtection(protectedHashes);
 return {records,protectedHashes,audit:{races:records.length,horses,extraCancelledResults,status,reasonNames:[...names],
  majorMismatch:0,performanceCalculated:false,sourceRunIds:BASE_RUNS.D}};
}
