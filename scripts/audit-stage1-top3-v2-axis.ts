/** Audit saved forecasts only. No model function is imported or executed. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync,mkdirSync,writeFileSync } from "node:fs";
import { bytes,json,noLinks,verifyProtection } from "./stage1-feature-ablation-reference";
import { sha256,isoDate } from "./simulator/canonical";
import { classifyRaceKind } from "./simulator/race-kind";
import { outcome } from "./stage1-partner-ranking-core";
import { diagnose,validate,type AxisRow } from "./stage1-top3-v2-axis-core";
import type { Forecast } from "./run-stage1-top3";
import type { Artifact } from "./stage1-top3-v2";
import type { Row as SavedRow } from "./stage1-top3-v2-audit";
import type { History,Payout } from "./simulator/types";
const BASE="lib/simulation-runs/stage1-top3-v2-9ba64d047cfb624b266ceabe8cc27c41a05c95ee22d7e5a29f2add28a80f2acb";
const PARTNER="lib/simulation-runs/stage1-top3-v2-partners-470704caf6472c129d555200e445d06ade84dc9862a3a129bcbb406450bf1640/summary.json";
const DOC="docs/STAGE1_TOP3_V2_AXIS_FAILURE_AUDIT.md";
const CODE=["scripts/audit-stage1-top3-v2-axis.ts","scripts/stage1-top3-v2-axis-core.ts","scripts/stage1-top3-v2-axis.test.ts"];
type Summary={reportSha256:string;sourceHashes:Record<string,string>;protectedHashes:Record<string,string>;report:{rows:SavedRow[]}};
function main(){assert.equal(process.argv.length,2);
 const old=json<Summary>(BASE+"/summary.json"),rows=old.report.rows;
 assert.equal(old.reportSha256,"a36f2d01e6686b9000e2be648a42ed0d7e361b581b782e39ea43ef1e2c3fc9b7");assert.equal(sha256(old.report),old.reportSha256);
 assert.equal(rows.length,742);assert.equal(rows.filter(r=>r.outcomes.C[0].top3).length,387);assert.equal(rows.filter(r=>!r.outcomes.C[0].top3).length,355);
 assert.equal(rows.filter(r=>r.outcomes.D[0].top3).length,487);assert.equal(sha256(rows.map(r=>r.raceId)),"087f212b172c902c2fdb570d3b340826d0db1ad07a317cb354376f38c05c89aa");
 console.log("Initial consistency: 742 races, 387 success, 355 failure, market 487; continuing saved-output audit");
 const partner=json<{protectedHashes:Record<string,string>}>(PARTNER),protectedHashes={...old.protectedHashes,...old.sourceHashes,...partner.protectedHashes,
  [PARTNER]:bytes(PARTNER),[BASE+"/summary.json"]:bytes(BASE+"/summary.json")};verifyProtection(protectedHashes);
 const codeHashes=Object.fromEntries(CODE.map(p=>[p,bytes(p)])),specHash=bytes(DOC),sourceCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
 const id=sha256({codeHashes,parent:old.reportSha256,specHash}),out="lib/simulation-runs/stage1-top3-v2-axis-"+id;noLinks(out);assert(!existsSync(out),"Append-only audit exists");
 const source=json<{races:Record<string,{date:string;surface:string;distance:number}>}>("lib/backfill/races.json").races;
 const details=json<{races:Record<string,{netKeibaRaceId:string;date:string;raceName:string;preRace:{class:{raw:string|null;structured:string|null;grade:string|null}};
  horses:{horseId:string;horseNumber:number;horse:string;result:{positionRaw:string|null;popularity:number|null}}[];labels:{payouts:{fuku:Payout}}}>}>("lib/backfill-stage1/race-details-raw.json").races;
 const histories=json<{horses:Record<string,{horseId:string;rows:History[]}>}>("lib/backfill-stage1/horse-history-raw.json").horses;
 const models=json<Artifact[]>(BASE+"/models.json"),artifacts=new Map(models.map(a=>[sha256(a),a]));assert.equal(artifacts.size,3);
 const forecasts=json<{forecasts:Forecast[]}>(BASE+"/predictions.json").forecasts;assert.equal(forecasts.length,742);const forecastById=new Map(forecasts.map(f=>[f.raceId,f]));assert.equal(forecastById.size,742);
 const audited:AxisRow[]=rows.map(r=>{const f=forecastById.get(r.raceId),s=source[r.raceId],d=details[r.raceId];assert(f&&s&&d&&f.date===r.date&&d.date===r.date&&s.date===r.date);
  const artifact=artifacts.get(f.artifactSha256);assert(artifact&&artifact.trainedThroughDate<r.date&&!artifact.trainingRaceIds.includes(r.raceId));assert.equal(artifact.settings.version,"stage1-independent-top3-v2");
  const surface=classifyRaceKind({surface:s.surface,raceName:d.raceName,classRaw:d.preRace.class.raw,grade:d.preRace.class.grade}).kind;assert(surface==="芝"||surface==="ダ");
  assert.deepEqual(f.predictions.map(p=>({horseId:p.horseId,horseNumber:p.horseNumber})),r.orders.C);
  assert.equal(new Set(d.horses.map(h=>h.horseId)).size,d.horses.length);assert.equal(new Set(d.horses.map(h=>h.horseNumber)).size,d.horses.length);
  const counts=f.predictions.map((p,i)=>{assert.equal(p.rank,i+1);assert.equal(p.probabilityEvent,"top3");assert.equal(p.calibrationStatus,"uncalibrated");assert.equal(p.reasons.length,26);
   assert(Math.abs(p.rawLogit-p.intercept-p.reasons.reduce((n,x)=>n+x.contribution,0))<1e-10);assert(Math.abs(p.rawTop3Probability-1/(1+Math.exp(-p.rawLogit)))<1e-12);
   if(i)assert(f.predictions[i-1].rawLogit>=p.rawLogit);assert.deepEqual(p.reasons.slice(0,13).map(x=>x.name),artifact.features);
   for(const reason of p.reasons)for(const past of reason.sourceRows)assert(isoDate(past.date)<r.date&&past.raceId!==r.raceId,"Leaked saved reason");
   const h=histories[p.horseId];assert(h&&h.horseId===p.horseId);
   const past=h.rows.filter(h=>isoDate(h.date)<r.date&&h.netKeibaRaceId!==r.raceId),flat=past.filter(h=>["芝","ダ"].includes(classifyRaceKind({surface:h.surface,raceName:h.raceName}).kind));
   const valid=flat.filter(h=>Number.isInteger(h.position)&&Number.isInteger(h.fieldSize)&&h.fieldSize!>=2&&h.position!>=1&&h.position!<=h.fieldSize!&&
    h.positionRaw!==null&&/^\d+$/.test(h.positionRaw)&&Number(h.positionRaw)===h.position);
   assert.equal(p.reasons[3].sourceRows.length,flat.length);assert.equal(p.reasons[0].sourceRows.length,Math.min(valid.length,3));
   const missingCount=p.reasons.slice(0,13).filter(x=>x.value===null).length;
   p.reasons.slice(13).forEach((x,i)=>assert.equal(x.transformed,Number(p.reasons[i].value===null)));
   const actualFlatStarts=flat.filter(h=>valid.includes(h)||["中","中止","失","失格"].includes(h.positionRaw??"")).length;
   return {priorRows:past.length,flatRows:flat.length,actualFlatStarts,validFlatRows:valid.length,recentUsed:p.reasons[0].sourceRows.length,missingCount};});
  const p=f.predictions[0],h=d.horses.find(h=>h.horseId===p.horseId),market=d.horses.find(h=>h.horseId===r.orders.D[0].horseId);assert(h&&market&&h.horseNumber===p.horseNumber&&market.horseNumber===r.orders.D[0].horseNumber);
  assert.equal(h.result.positionRaw,r.outcomes.C[0].raw);assert.equal(market.result.positionRaw,r.outcomes.D[0].raw);assert.equal(outcome(h.result.positionRaw).top3,r.outcomes.C[0].top3);
  const days=p.reasons[4].sourceRows[0]?.date;
  return {raceId:r.raceId,date:r.date,time:r.archivedStartTime,horseId:p.horseId,horseNumber:p.horseNumber,horse:h.horse,positionRaw:h.result.positionRaw,popularity:h.result.popularity,
   marketHorseId:market.horseId,marketHorseNumber:market.horseNumber,marketPositionRaw:market.result.positionRaw,surface,distance:s.distance,classRaw:d.preRace.class.raw,classCode:d.preRace.class.structured,
   fieldSize:f.predictions.length,score:p.rawLogit,q:p.rawTop3Probability,intercept:p.intercept,features:p.reasons.map((x,i)=>({name:x.name,value:i<13?x.value:Number(p.reasons[i-13].value===null),
    contribution:x.contribution,missingReason:x.missingReason,sourceCount:x.sourceRows.length})),...counts[0],restDays:days?(Date.parse(r.date)-Date.parse(isoDate(days)))/86400000:null,
   settlement:r.settlements.fuku.C[0],marketSettlement:r.settlements.fuku.D[0],allHorseCounts:counts.map(({flatRows,actualFlatStarts,validFlatRows,recentUsed,missingCount})=>({flatRows,actualFlatStarts,validFlatRows,recentUsed,missingCount}))};});
 validate(audited);assert.equal(audited.filter(r=>outcome(r.positionRaw).top3).length,387);
 mkdirSync(out);const save=(name:string,x:unknown)=>writeFileSync(out+"/"+name,JSON.stringify(x),{flag:"wx"});
 save("preflight.json",{id,sourceCommit,codeHashes,specHash,protectedHashes,counts:{races:742,success:387,failure:355,market:487},cohortHash:sha256(audited.map(r=>r.raceId))});
 console.log("Saved forecast/ID/feature provenance verified; starting predeclared descriptive summaries");
 const report=diagnose(audited);verifyProtection(protectedHashes);verifyProtection(codeHashes);assert.equal(bytes(DOC),specHash);
 const reportHash=sha256(report);save("summary.json",{id,sourceCommit,codeHashes,specHash,protectedHashes,reportHash,report,constraints:["No model run, retraining, or sealed access","Known development final-market references; no rule adoption"]});
 console.log(JSON.stringify({id,out,reportHash,overall:report.overall,popularity:report.popularity.map(x=>({band:x.band,...x.summary,account:x.axisAccount})),experience:report.experience}));
}
if(require.main===module)main();
