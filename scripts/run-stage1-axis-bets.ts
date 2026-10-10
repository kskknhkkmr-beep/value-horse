/** Explicit read-only audit, then append-only retrospective betting evaluation. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync,mkdirSync,writeFileSync } from "node:fs";
import { canonical,sha256 } from "./simulator/canonical";
import { loadAxisData } from "./stage1-axis-bet-data";
import { generate,settle,exclusion,report,WAYS,KINDS,type PlanningInput,type Plans } from "./stage1-axis-bet-core";
import { bytes,json,noLinks,verifyProtection } from "./stage1-feature-ablation-reference";
const mode=process.argv[2];assert(process.argv.length===3 && ["--audit-only","--retrospective"].includes(mode),"Explicit mode required");
const data=loadAxisData();console.log(JSON.stringify({preflight:data.audit}));
if(mode==="--retrospective"){
 const design="docs/STAGE1_AXIS_BET_DESIGN.md";
 const files=[design,"scripts/stage1-axis-bet-core.ts","scripts/stage1-axis-bet-data.ts","scripts/run-stage1-axis-bets.ts"];
 const metadata={designVersion:"axis-bet-design-v1",sourceCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
  codeHashes:Object.fromEntries(files.map(p=>[p,bytes(p)])),seed:20261011,sourceRunIds:data.audit.sourceRunIds};
 const planned:{raceId:string;date:string;input:PlanningInput;plans:Plans}[]=[],excluded:unknown[]=[];
 for(const r of data.records){
  const horses=r.starters.map(h=>({horseId:h.horseId,horseNumber:h.horseNumber}));
  const market=r.actual.horses.filter(h=>horses.some(s=>s.horseId===h.horseId));
  if(market.some(h=>h.popularity===null||!Number.isInteger(h.popularity)||h.popularity!<1||
    !h.finalOddsRaw||!/^\d+(?:\.\d+)?$/.test(h.finalOddsRaw)||Number(h.finalOddsRaw)<=0)||
    !market.some(h=>h.popularity===1)){
   excluded.push({raceId:r.raceId,date:r.date,reason:"Incomplete final market reference"});continue;
  }
  const input:PlanningInput={raceId:r.raceId,date:r.date,starters:horses,
   vh:r.predictions.map(p=>({horseId:p.horseId,horseNumber:p.horseNumber})),
   market:[...market].sort((a,b)=>a.popularity!-b.popularity!||a.horseNumber-b.horseNumber)
    .map(h=>({horseId:h.horseId,horseNumber:h.horseNumber}))};
  const plans=generate(input);if(!plans){excluded.push({raceId:r.raceId,date:r.date,reason:"Fewer than five starters"});continue;}
  assert.deepEqual(plans,generate(input));planned.push({raceId:r.raceId,date:r.date,input,plans});
 }
 const planningHash=sha256({metadata,planned,excluded}),planDir="lib/simulation-runs/stage1-axis-bet-plans-"+planningHash;
 noLinks(planDir);assert(!existsSync(planDir),"Append-only: existing plan must not be overwritten");mkdirSync(planDir);
 writeFileSync(planDir+"/plans.json",canonical({metadata,planningHash,planned,excluded})+"\n",{flag:"wx"});
 const saved=json<{planned:typeof planned}>(planDir+"/plans.json");assert.equal(sha256(saved.planned),sha256(planned));
 // All planned tickets are durably frozen BEFORE any settlement or performance call.
 const truth=new Map(data.records.map(r=>[r.raceId,r.actual]));
 const allRows=saved.planned.map(p=>settle(p.plans,truth.get(p.raceId)!)),rows=allRows.filter(r=>!exclusion(r).length);
 for(const r of allRows)if(exclusion(r).length)excluded.push({raceId:r.raceId,date:r.date,reason:"Shared unresolved/refund exclusion",issues:exclusion(r)});
 const rawCounts:Record<string,number>={};for(const r of allRows)for(const k of KINDS)for(const w of WAYS)for(const s of r.settlements[k][w]){
  const key=k+"/"+w+"/"+s.status;rawCounts[key]=(rawCounts[key]??0)+1;}
 const result=report(rows),settledById=new Map(allRows.map(r=>[r.raceId,r]));
 const explanation=saved.planned.map(p=>{const actual=truth.get(p.raceId)!;return {raceId:p.raceId,plans:p.plans,settlements:settledById.get(p.raceId)!.settlements,
  reasons:WAYS.map(w=>({way:w,axisPosition:actual.horses.find(h=>h.horseId===p.plans[w].axis.horseId)!.positionRaw,
   partnerCoverage:Object.fromEntries(KINDS.map(k=>[k,p.plans[w].partners[k].map(h=>({horseId:h.horseId,
    positionRaw:actual.horses.find(t=>t.horseId===h.horseId)!.positionRaw,
    inConfirmedCombinations:actual.payouts[k].entries.filter(e=>e.combo?.includes(h.horseNumber)).length}))]))}))};});
 verifyProtection(data.protectedHashes);
 const cohortHash=sha256(rows.map(r=>r.raceId)),reportHash=sha256(result),id=sha256({...metadata,planningHash,cohortHash,reportHash}),
  out="lib/simulation-runs/stage1-axis-bet-audit-"+id;
 noLinks(out);assert(!existsSync(out),"Append-only report");mkdirSync(out);
 const summary={id,...metadata,planningHash,planDir,cohortHash,reportHash,audit:data.audit,excluded,rawCounts,protectedHashes:data.protectedHashes,
  constraints:["Retrospective final popularity and confirmed payouts; not deployable EV","Known development; not unseen validation",
   "Common resolved/no-refund cohort; archived planned off-times","No retraining, prediction overwrite or sealed data"],
  ...result};
 writeFileSync(out+"/summary.json",canonical(summary)+"\n",{flag:"wx"});
 writeFileSync(out+"/rows.json",canonical(rows)+"\n",{flag:"wx"});
 writeFileSync(out+"/explanations.json",canonical(explanation)+"\n",{flag:"wx"});
 console.log(JSON.stringify({id,out,planningHash,cohortHash,reportHash,races:rows.length,excluded:excluded.length,overall:result.overall}));
}
