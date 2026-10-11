/** Allowlisted saved-data diagnosis: no fitting, prediction, scraping or ROI. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync,writeFileSync } from "node:fs";
import { canonical,sha256 } from "./simulator/canonical";
import { loadDevelopment } from "./simulator/input";
import { bytes,json,noLinks,verifyProtection } from "./stage1-feature-ablation-reference";
import type { Forecast } from "./run-stage1-top3";
import { audit,FEATURE_NAMES,finish,PLAN } from "./stage1-feature-information-core";
const BASE="lib/simulation-runs/stage1-top3-v1-20a5a4482f305cbe931b1eb53af1f376cfaf3b541a61b38d27fd2a652db5a896";
const QUALITY="lib/simulation-runs/stage1-next-feature-audit-a18c10393fc1651a53acc4d5f4dbb420a419ae5eb56108527bcb98ed5a720b39/summary.json";
type Parent={experimentId:string;sourceHashes:Record<string,string>;protectedHashes:Record<string,string>;reportSha256:string;
 report:{predictionSha256:string;rows:{raceId:string;date:string;orders:Record<"B"|"C",{horseId:string;horseNumber:number}[]>;
 outcomes:Record<"B"|"C",{raw:string|null;win:number;top3:number}[]>}[]}};
type Model={features:string[];trainedThroughDate:string;trainingRaceIds:string[]};
function main(){
 assert.equal(process.argv.length,2,"No custom paths or condition selection");
 const parent=json<Parent>(BASE+"/summary.json");assert.equal(sha256(parent.report),parent.reportSha256);
 const protectedHashes={...parent.protectedHashes,...parent.sourceHashes,
  ...Object.fromEntries(["preflight","models","predictions","plans","summary"].map(n=>[BASE+"/"+n+".json",bytes(BASE+"/"+n+".json")])),
  [QUALITY]:bytes(QUALITY)};verifyProtection(protectedHashes);
 const predictions=json<{forecasts:Forecast[]}>(BASE+"/predictions.json");
 assert.equal(sha256(predictions.forecasts),parent.report.predictionSha256);
 const models=json<Model[]>(BASE+"/models.json");const modelByHash=new Map(models.map(m=>[sha256(m),m]));
 for(const f of predictions.forecasts){const m=modelByHash.get(f.artifactSha256);assert(m);assert(m.trainedThroughDate<f.date);
  assert(!m.trainingRaceIds.includes(f.raceId));assert.deepEqual(m.features,[...FEATURE_NAMES]);}
 const ids=predictions.forecasts.map(f=>f.raceId);assert.equal(ids.length,742);
 assert.equal(sha256(ids),"087f212b172c902c2fdb570d3b340826d0db1ad07a317cb354376f38c05c89aa");
 const quality=json<{reportSha256:string;result:unknown;protectedHashes:Record<string,string>}>(QUALITY);
 assert.equal(sha256(quality.result),quality.reportSha256);verifyProtection(quality.protectedHashes);
 const data=loadDevelopment();for(const [p,h]of Object.entries(data.sourceHashes))assert.equal(parent.sourceHashes[p],h);
 const raceById=new Map(data.races.map(r=>[r.raceId,r]));
 for(const m of models){assert.equal(new Set(m.trainingRaceIds).size,m.trainingRaceIds.length);
  for(const id of m.trainingRaceIds){const r=raceById.get(id);assert(r&&r.date<=m.trainedThroughDate&&["芝","ダ"].includes(r.surface));}}
 const orders=Object.fromEntries(parent.report.rows.map(r=>[r.raceId,r.orders.C]));
 assert.deepEqual(parent.report.rows.map(r=>r.raceId),ids);
 for(const row of parent.report.rows){const truth=data.truthByRace[row.raceId];assert.equal(truth.date,row.date);
  for(const w of ["B","C"] as const)row.orders[w].forEach((h,i)=>{const actual=truth.horses.find(x=>x.horseId===h.horseId);
   assert(actual&&actual.horseNumber===h.horseNumber);const x=finish(actual.positionRaw),old=row.outcomes[w][i];
   assert.equal(x.raw,old.raw);assert.equal(x.win,Number(old.win));assert.equal(x.top3,Number(old.top3));});}
 const result=audit(predictions.forecasts,data,orders);assert.equal(result.scope.appearances,10583);
 assert.equal(result.disagreement.n,423);assert.equal(result.all.top3.top3.top3,385);assert.equal(result.all.top3.market.top3,487);
 verifyProtection(protectedHashes);verifyProtection(quality.protectedHashes);
 const files=["scripts/audit-stage1-feature-information.ts","scripts/stage1-feature-information-core.ts","scripts/stage1-feature-information.test.ts"];
 const metadata={sourceCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),parentExperimentId:parent.experimentId,
  plan:PLAN,codeHashes:Object.fromEntries(files.map(p=>[p,bytes(p)])),reportSha256:sha256(result),qualityReportSha256:quality.reportSha256};
 const id=sha256(metadata),out="lib/simulation-runs/stage1-feature-information-"+id;noLinks(out);mkdirSync(out);
 writeFileSync(out+"/summary.json",canonical({auditId:id,...metadata,result,priorQuality:quality.result,protectedHashes})+"\n",{flag:"wx"});
 console.log(JSON.stringify({auditId:id,output:out,scope:result.scope,all:result.all,disagreement:result.disagreement,
  quality:result.quality,overlap:result.overlap,caseCounts:Object.fromEntries(Object.entries(result.cases).map(([k,v])=>[k,v.n]))}));
}
main();
