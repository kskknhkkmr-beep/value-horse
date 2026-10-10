/** Fixed saved-prediction audit. Never invokes training, prediction, scraping or monetary accounting. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { canonical,sha256 } from "./simulator/canonical";
import { assertInputPath,loadDevelopment } from "./simulator/input";
import type { Row } from "./stage1-feature-ablation-audit-core";
import type { Run } from "./simulator/types";
import { bytes,json,noLinks,verifyProtection } from "./stage1-feature-ablation-reference";
import { audit } from "./stage1-next-feature-audit-core";
const BASE="lib/simulation-runs/stage1-feature-ablation-97b87090839c7c415a8f00bc7b3217efb4ba92e9b4a0972320c190d4b9ed18db";
type Prior={auditId:string;sourceCommit:string;codeHashes:Record<string,string>;reportSha256:string;
 protectedHashes:Record<string,string>;runIds:Record<"A"|"B"|"C"|"D",string[]>;fixedEvaluationRead:boolean};
function main(){
 assert.equal(process.argv.length,2,"No custom paths, cohorts or selection arguments");
 const summary=json<Prior>(BASE+"/summary.json");
 const {auditId,sourceCommit,codeHashes,reportSha256,...report}=summary;
 assert.equal(auditId,"97b87090839c7c415a8f00bc7b3217efb4ba92e9b4a0972320c190d4b9ed18db");
 assert.equal(sha256(report),reportSha256);
 assert.equal(sha256({sourceCommit,codeHashes,reportSha256}),auditId);
 assert.equal(report.fixedEvaluationRead,false);verifyProtection(report.protectedHashes);verifyProtection(codeHashes);
 const protectedHashes={...report.protectedHashes,[BASE+"/summary.json"]:bytes(BASE+"/summary.json"),[BASE+"/rows.json"]:bytes(BASE+"/rows.json")};
 const rows=json<Row[]>(BASE+"/rows.json"),byId=new Map(rows.map(r=>[r.raceId,r]));
 // Byte-identical files were fully validated by prior audit. Independently bind compact rows to all 12 preserved runs.
 for(const key of ["A","B","C","D"] as const){
  const seen=new Set<string>();
  for(const id of report.runIds[key]){
   const path="lib/simulation-runs/"+id+"/run.json";assert(path in protectedHashes,"Unprotected prediction run");
   const run=json<Run>(path);
   for(const r of run.records){
    assert(!seen.has(r.raceId));seen.add(r.raceId);
    const old=byId.get(r.raceId)!;assert(old);assert.equal(old.date,r.date);
    assert(run.model.trainedThroughDate!<r.date);
    assert.equal(r.predictions[0].rank,1);
    assert.equal(r.predictions[0].horseId,old.selections[key].horseId);
    assert.equal(r.predictions[0].horseNumber,old.selections[key].horseNumber);
    assert.equal(r.tickets.length,0);
   }
  }
  assert.deepEqual([...seen].sort(),[...byId.keys()].sort());
  console.log("Preserved "+key+": "+seen.size+" saved selections");
 }
 const data=loadDevelopment();
 for(const [p,h] of Object.entries(data.sourceHashes))assert.equal(protectedHashes[p],h);
 const detailPath="lib/backfill-stage1/race-details-raw.json";
 assertInputPath(detailPath);
 const raw=json<{races:Record<string,{preRace:{trackConditionRaw:string|null}}> }>(detailPath);
 const conditions=Object.fromEntries(Object.entries(raw.races).map(([id,r])=>[id,r.preRace.trackConditionRaw]));
 const result=audit(rows,data,conditions);
 assert.equal(result.scope.appearances,10583);assert.equal(result.disagreement.n,420);
 verifyProtection(protectedHashes);
 const files=["scripts/audit-stage1-next-features.ts","scripts/stage1-next-feature-audit-core.ts","docs/STAGE1_NEXT_FEATURE_AUDIT_PLAN.md"];
 const metadata={sourceCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
  priorAuditId:auditId,codeHashes:Object.fromEntries(files.map(p=>[p,bytes(p)])),reportSha256:sha256(result)};
 const id=sha256(metadata),out="lib/simulation-runs/stage1-next-feature-audit-"+id;
 noLinks(out);mkdirSync(out); // Duplicate execution refuses overwrite.
 writeFileSync(out+"/summary.json",canonical({auditId:id,...metadata,result,protectedHashes})+"\n",{flag:"wx"});
 console.log(JSON.stringify({auditId:id,output:out,scope:result.scope,disagreement:result.disagreement,
  histories:result.histories,groups:Object.fromEntries(Object.entries(result.groups).map(([k,g])=>[k,g.n]))}));
}
main();
