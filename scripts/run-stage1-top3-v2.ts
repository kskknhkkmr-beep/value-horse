/** One predeclared walk-forward experiment. All predictions saved before evaluation. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync,mkdirSync,writeFileSync } from "node:fs";
import { sha256 } from "./simulator/canonical";
import { loadDevelopment } from "./simulator/input";
import { prepareInputV2 } from "./stage1-v2-input";
import { unsupported } from "./stage1-independent-v2";
import { loadAxisData } from "./stage1-axis-bet-data";
import { json,bytes,noLinks,verifyProtection,BASE_RUNS,type Capture } from "./stage1-feature-ablation-reference";
import { project,derive,example,train,predict,FEATURES,SETTINGS } from "./stage1-top3-v2";
import { evaluate } from "./stage1-top3-audit";
import { merge,report } from "./stage1-top3-v2-audit";
import type { Forecast } from "./run-stage1-top3";
const BASE="lib/simulation-runs/stage1-top3-v1-20a5a4482f305cbe931b1eb53af1f376cfaf3b541a61b38d27fd2a652db5a896";
const FILES=["scripts/stage1-top3-v2.ts","scripts/stage1-top3-v2-audit.ts","scripts/run-stage1-top3-v2.ts","scripts/stage1-top3-v2.test.ts","docs/STAGE1_TOP3_V2_PLAN.md",
 "scripts/stage1-top3.ts","scripts/stage1-top3-audit.ts","scripts/stage1-independent-v2.ts","scripts/stage1-v2-input.ts","scripts/stage1-axis-bet-core.ts","scripts/stage1-axis-bet-data.ts",
 "scripts/simulator/input.ts","scripts/simulator/canonical.ts","scripts/simulator/runner.ts","scripts/simulator/race-kind.ts","scripts/simulator/settlement.ts","scripts/stage1-feature-ablation-reference.ts"];
function main(){
 const resume=process.argv[2]==="--resume-saved-models"?process.argv[3]:null;
 if(resume)assert.match(resume,/^stage1-top3-v2-[a-f0-9]{64}$/);else assert.deepEqual(process.argv.slice(2),["--fixed-design-retrospective"]);
 const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),codeHashes=Object.fromEntries(FILES.map(p=>[p,bytes(p)]));
 const old=json<{protectedHashes:Record<string,string>;reportSha256:string;sourceHashes:Record<string,string>;report:ReturnType<typeof evaluate>}>(BASE+"/summary.json");
 assert.equal(sha256(old.report),old.reportSha256);verifyProtection(old.protectedHashes);
 const protectedHashes={...old.protectedHashes,...old.sourceHashes,...Object.fromEntries(["summary","preflight","models","predictions","plans"].map(n=>[BASE+"/"+n+".json",bytes(BASE+"/"+n+".json")]))};
 const capture=json<Capture>("lib/simulation-runs/"+BASE_RUNS.D[0]+"/stage1-capture.json");
 const experimentId=resume?resume.slice("stage1-top3-v2-".length):sha256({sourceCommit,codeHashes,sourceHashes:old.sourceHashes,settings:SETTINGS,trainingIds:capture.artifacts.map(a=>a.trainingRaceIds)});
 const out="lib/simulation-runs/stage1-top3-v2-"+experimentId;noLinks(out);
 if(resume){const prior=json<{sourceCommit:string;codeHashes:Record<string,string>;settings:unknown}>(out+"/preflight.json");assert.equal(prior.sourceCommit,sourceCommit);assert.deepEqual(prior.settings,SETTINGS);for(const [p,h]of Object.entries(prior.codeHashes))if(p!=="scripts/run-stage1-top3-v2.ts")assert.equal(bytes(p),h);assert(!existsSync(out+"/predictions.json"));assert(!existsSync(out+"/summary.json"));}
 else assert(!existsSync(out),"Existing experiment: no repeat fit or overwrite");
 const data=loadDevelopment();assert.deepEqual(data.sourceHashes,old.sourceHashes);assert.deepEqual(data.sourceHashes,capture.sourceHashes);
 const reference=loadAxisData();Object.assign(protectedHashes,reference.protectedHashes);verifyProtection(protectedHashes);
 const saved=json<{forecasts:Forecast[]}>(BASE+"/predictions.json").forecasts;
 assert.equal(sha256(saved),old.report.predictionSha256);const savedById=new Map(saved.map(f=>[f.raceId,f]));
 const races=new Map(data.races.map(r=>[r.raceId,r]));
 const feature=(id:string)=>{const r=races.get(id);assert(r&&["芝","ダ"].includes(r.surface));const f=derive(project(prepareInputV2(r,data.historyByHorse)));
  assert.equal(unsupported(f,r.surface),null);return f;};
 console.log("Validated preserved development and 742-race identities; constructing fixed inputs");
 const examples=capture.artifacts.map(a=>a.trainingRaceIds.map(id=>example(feature(id),data.truthByRace[id],a.trainedThroughDate)));
 assert.deepEqual(examples.map(x=>x.length),[513,769,1090]);
 for(const r of reference.records){const f=feature(r.raceId),oldf=savedById.get(r.raceId);assert(oldf);example(f,data.truthByRace[r.raceId],r.date);
  for(const h of f.horses){const oldh:Forecast["predictions"][number]|undefined=oldf.predictions.find(x=>x.horseId===h.horseId);assert(oldh&&oldh.horseNumber===h.horseNumber);
   for(let i=0;i<7;i++){assert.equal(h.features[i].value,oldh.reasons[i].value);assert.equal(h.features[i].missingReason,oldh.reasons[i].missingReason);}}}
 const quality=(inputs:ReturnType<typeof feature>[])=>({appearances:inputs.reduce((n,r)=>n+r.horses.length,0),
  features:FEATURES.map((name,i)=>{const fs=inputs.flatMap(r=>r.horses.map(h=>h.features[i])),missing=fs.filter(f=>f.value===null);
   return {name,n:fs.length,missing:missing.length,missingRate:missing.length/fs.length,used:fs.length-missing.length,
    reasons:Object.fromEntries([...new Set(missing.map(f=>f.missingReason))].map(k=>[String(k),missing.filter(f=>f.missingReason===k).length]))};})});
 const predictionQuality=quality(reference.records.map(r=>feature(r.raceId)));
 if(!resume)mkdirSync(out);const save=(name:string,x:unknown)=>writeFileSync(out+"/"+name,JSON.stringify(x),{flag:"wx"});
 if(!resume)save("preflight.json",{sourceCommit,codeHashes,protectedHashes,sourceHashes:data.sourceHashes,settings:SETTINGS,features:FEATURES,
  trainingCounts:examples.map(x=>x.length),unknownLabels:0,cohortStatus:capture.statuses,predictionQuality,performanceViewed:false});
 console.log("Preflight saved; fitting exactly one model per fixed calendar window");
 const priorModels=json<{means:number[];labelsSha256:string}[]>(BASE+"/models.json");
 const artifacts=resume?json<ReturnType<typeof train>[]>(out+"/models.json"):examples.map((es,i)=>{const a=train(es,capture.artifacts[i].trainedThroughDate);
  assert.deepEqual(a.trainingRaceIds,capture.artifacts[i].trainingRaceIds);assert.deepEqual(a.means.slice(0,7),priorModels[i].means);assert.equal(a.labelsSha256,priorModels[i].labelsSha256);
  console.log("Fit "+a.trainedThroughDate+": "+a.trainingRaceIds.length+" races (no performance evaluated)");return a;});if(!resume)save("models.json",artifacts);
 artifacts.forEach((a,i)=>{assert.deepEqual(a.trainingRaceIds,capture.artifacts[i].trainingRaceIds);assert.deepEqual(a.means.slice(0,7),priorModels[i].means);assert.equal(a.labelsSha256,priorModels[i].labelsSha256);});
 const forecasts:Forecast[]=reference.records.map(r=>{const f=feature(r.raceId),a=artifacts.find(a=>a.trainedThroughDate===(r.date<="2026-04-26"?"2026-03-29":r.date<="2026-05-31"?"2026-04-26":"2026-05-31"));assert(a);
  const predictions=predict(a,f);assert.deepEqual(predictions,predict(a,f));return {raceId:r.raceId,date:r.date,inputSha256:sha256(f),artifactSha256:sha256(a),predictions};});
 assert.equal(forecasts.length,742);assert.equal(sha256(forecasts.map(f=>f.raceId)),"087f212b172c902c2fdb570d3b340826d0db1ad07a317cb354376f38c05c89aa");
 save("predictions.json",{schemaVersion:2,probabilityEvent:"top3",calibrationStatus:"uncalibrated",forecasts});
 const frozen=json<{forecasts:Forecast[]}>(out+"/predictions.json").forecasts;assert.equal(sha256(frozen),sha256(forecasts));
 console.log("All 742 forecasts saved and verified; now joining outcomes and fixed payouts");
 const evaluated=evaluate(frozen,reference.records,plans=>{save("plans.json",plans);assert.equal(sha256(json(out+"/plans.json")),sha256(plans));});
 const combined=report(merge(old.report.rows,evaluated.rows));
 verifyProtection(protectedHashes);verifyProtection(codeHashes);verifyProtection(data.sourceHashes);
 save("summary.json",{experimentId,sourceCommit,codeHashes,protectedHashes,sourceHashes:data.sourceHashes,reportSha256:sha256(combined),report:combined,
  predictionSha256:sha256(frozen),probabilityQuality:evaluated.quality,inputQuality:predictionQuality,cohortStatus:capture.statuses,
  training:artifacts.map((a,i)=>({cutoff:a.trainedThroughDate,count:a.trainingRaceIds.length,labelsSha256:a.labelsSha256,quality:quality(examples[i].map(e=>e.input)),
   initial:a.trace[0],final:a.trace.at(-1),weights:a.weights,means:a.means,intercept:a.intercept})),fixedEvaluationRead:false});
 console.log(JSON.stringify({out,experimentId,reportSha256:sha256(combined),overall:combined.overall,primary:combined.ci.results["C-B/rank1/top3"],market:combined.ci.results["C-D/rank1/top3"]}));
}
if(require.main===module)main();
