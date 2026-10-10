/** Read existing development predictions and frozen tickets; no model execution. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync,mkdirSync,writeFileSync } from "node:fs";
import { canonical,sha256 } from "./simulator/canonical";
import { bytes,json,noLinks,verifyProtection } from "./stage1-feature-ablation-reference";
import { loadAxisData } from "./stage1-axis-bet-data";
import { KINDS,WAYS,type Plans,type PlanningInput,type Settled } from "./stage1-axis-bet-core";
import { diagnose,type RankingRow } from "./stage1-partner-ranking-core";
const base="lib/simulation-runs/stage1-axis-bet-audit-eb5e2856dd0d30fa08c86a61a500358fefea018cabdbfad976c1253c65d0f4ff";
const old=json<{id:string;planningHash:string;planDir:string;cohortHash:string;reportHash:string;protectedHashes:Record<string,string>;
 overall:Record<string,Record<string,{hitRaces:number}>>}&Record<string,unknown>>(base+"/summary.json");
assert.equal(old.id,base.split("-").at(-1));
assert.equal(sha256(Object.fromEntries(["races","overall","uncertainty","sensitivity","overlap","periods","axisGroups"].map(k=>[k,old[k]]))),old.reportHash);
const plan=json<{metadata:unknown;planningHash:string;planned:{raceId:string;date:string;input:PlanningInput;plans:Plans}[];excluded:unknown[]}>(old.planDir+"/plans.json");
assert.equal(plan.planningHash,old.planningHash);assert.equal(sha256({metadata:plan.metadata,planned:plan.planned,excluded:plan.excluded}),old.planningHash);
const settled=json<Settled[]>(base+"/rows.json");assert.equal(sha256(settled.map(r=>r.raceId)),old.cohortHash);assert.equal(settled.length,742);
const protectedHashes={...old.protectedHashes,...Object.fromEntries([base+"/summary.json",base+"/rows.json",base+"/explanations.json",old.planDir+"/plans.json"].map(p=>[p,bytes(p)]))};
verifyProtection(protectedHashes);
const data=loadAxisData(),records=new Map(data.records.map(r=>[r.raceId,r])),plans=new Map(plan.planned.map(r=>[r.raceId,r]));
assert.equal(plans.size,plan.planned.length);assert.equal(new Set(settled.map(r=>r.raceId)).size,742);
let tiedMarketRaces=0;
const rows:RankingRow[]=settled.map(s=>{const rec=records.get(s.raceId)!,p=plans.get(s.raceId)!;assert(rec&&p);assert.equal(p.date,rec.date);
 assert.deepEqual(p.input.vh.map(h=>h.horseId),rec.predictions.map(h=>h.horseId));
 const market=rec.actual.horses.filter(h=>rec.starters.some(t=>t.horseId===h.horseId)).sort((a,b)=>a.popularity!-b.popularity!||a.horseNumber-b.horseNumber);
 if(new Set(market.map(h=>h.popularity)).size<market.length)tiedMarketRaces++;
 assert.deepEqual(p.input.market.map(h=>h.horseId),market.map(h=>h.horseId));
 for(const w of WAYS){assert.equal(p.plans[w].axis.horseId,(w==="A"||w==="B"?p.input.vh:p.input.market)[0].horseId);
 for(const k of KINDS){assert.deepEqual(s.settlements[k][w].map(t=>({kind:t.kind,horses:t.horses,stakeYen:t.stakeYen})),p.plans[w].tickets[k]);
 assert(s.settlements[k][w].every(t=>t.status==="win"||t.status==="loss"));}}
 return {raceId:rec.raceId,date:rec.date,vh:p.input.vh.map(h=>h.horseId),market:p.input.market.map(h=>h.horseId),truth:rec.actual,plans:p.plans,settled:s};});
const report=diagnose(rows);
for(const k of KINDS)for(const w of WAYS)assert.equal(report.failure[k][w].success,old.overall[k][w].hitRaces);
verifyProtection(protectedHashes);
const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
 codeHashes=Object.fromEntries(["scripts/audit-stage1-partner-ranking.ts","scripts/stage1-partner-ranking-core.ts"].map(p=>[p,bytes(p)])),
 reportHash=sha256(report),id=sha256({sourceCommit,codeHashes,parent:old.id,reportHash}),out="lib/simulation-runs/stage1-partner-ranking-"+id;
noLinks(out);assert(!existsSync(out),"Append-only report");mkdirSync(out);
writeFileSync(out+"/summary.json",canonical({id,sourceCommit,codeHashes,parent:old.id,cohortHash:old.cohortHash,reportHash,protectedHashes,tiedMarketRaces,
 constraints:["Known development and final popularity; not unseen validation","No fitting, new prediction, ticket modification or sealed data",
 "Rank slots; same-axis exclusion before partners; top3 distinct from ticket eligibility","Unknown finish retained as no recorded win/top3, not fabricated 4+"],...report})+"\n",{flag:"wx"});
console.log(JSON.stringify({id,out,reportHash,tiedMarketRaces,protectedFiles:Object.keys(protectedHashes).length,ranks:report.ranks,failure:report.failure,top5:report.top5,
 axisConditional:report.axisConditional,undervalued:report.undervalued}));
