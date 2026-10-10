/** Fixed, append-only Top3 experiment. Predictions are frozen before result evaluation. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync,writeFileSync,existsSync } from "node:fs";
import { loadDevelopment } from "./simulator/input";
import { sha256 } from "./simulator/canonical";
import { derive,independentInput,unsupported } from "./stage1-independent-v2";
import { prepareInputV2 } from "./stage1-v2-input";
import { BASE_RUNS,bytes,json,verifyProtection,type Capture } from "./stage1-feature-ablation-reference";
import { loadAxisData } from "./stage1-axis-bet-data";
import { example,train,predict,SETTINGS } from "./stage1-top3";
import { evaluate } from "./stage1-top3-audit";
export type Forecast={raceId:string;date:string;inputSha256:string;artifactSha256:string;predictions:ReturnType<typeof predict>};
const FILES=["scripts/stage1-top3.ts","scripts/run-stage1-top3.ts","scripts/stage1-top3-audit.ts",
 "scripts/stage1-independent-v2.ts","scripts/stage1-v2-input.ts","scripts/stage1-axis-bet-core.ts",
 "scripts/stage1-axis-bet-data.ts","scripts/simulator/input.ts","scripts/simulator/race-kind.ts",
 "scripts/simulator/settlement.ts","scripts/simulator/canonical.ts","scripts/simulator/runner.ts",
 "scripts/stage1-feature-ablation-reference.ts","docs/STAGE1_TOP3_MODEL_DESIGN.md"];
export function main(){
 assert.deepEqual(process.argv.slice(2),["--fixed-design-retrospective"]);
 const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
 const proof=json<{protectedHashes:Record<string,string>}>("lib/simulation-runs/stage1-partner-ranking-5b8fa41fba8eabc9c9d7be13f6736c9b6b2dedcafef49b539daeffb81c0d7f0d/summary.json");
 verifyProtection(proof.protectedHashes);
 const codeHashes=Object.fromEntries(FILES.map(f=>[f,bytes(f)]));
 const reference=loadAxisData();const dataset=loadDevelopment();
 const capture=json<Capture>("lib/simulation-runs/"+BASE_RUNS.D[0]+"/stage1-capture.json");
 assert.equal(capture.artifacts.length,3);assert.deepEqual(dataset.sourceHashes,capture.sourceHashes);
 const races=new Map(dataset.races.map(r=>[r.raceId,r]));
 const feature=(id:string)=>{const r=races.get(id);assert(r&&["芝","ダ"].includes(r.surface));
  const f=derive(independentInput(prepareInputV2(r,dataset.historyByHorse)));assert.equal(unsupported(f,r.surface),null);return f;};
 // Audit EVERY window first. Unknown labels abort before any model is fitted.
 const examples=capture.artifacts.map(a=>a.trainingRaceIds.map(id=>example(feature(id),dataset.truthByRace[id],a.trainedThroughDate)));
 assert.deepEqual(examples.map(e=>e.length),[513,769,1090]);
 for(const r of reference.records)example(feature(r.raceId),dataset.truthByRace[r.raceId],r.date);
 const experimentId=sha256({sourceCommit,codeHashes,sourceHashes:dataset.sourceHashes,settings:SETTINGS,trainingIds:capture.artifacts.map(a=>a.trainingRaceIds)});
 const directory="lib/simulation-runs/stage1-top3-v1-"+experimentId;
 assert(!existsSync(directory),"Existing experiment: do not retrain/overwrite");mkdirSync(directory);
 const save=(name:string,value:unknown)=>writeFileSync(directory+"/"+name,JSON.stringify(value,null,2),{flag:"wx"});
 save("preflight.json",{schemaVersion:2,probabilityEvent:"top3",sourceCommit,codeHashes,sourceHashes:dataset.sourceHashes,
  settings:SETTINGS,trainingCounts:examples.map(e=>e.length),unknownLabels:0,protectedHashes:proof.protectedHashes,performanceViewed:false});
 const artifacts=examples.map((es,i)=>{const a=train(es,capture.artifacts[i].trainedThroughDate);
  assert.deepEqual(a.trainingRaceIds,capture.artifacts[i].trainingRaceIds);assert.deepEqual(a.means,capture.artifacts[i].means);return a;});
 save("models.json",artifacts);
 const forecasts:Forecast[]=reference.records.map(r=>{const f=feature(r.raceId),a=artifacts.find(a=>
  a.trainedThroughDate===(r.date<="2026-04-26"?"2026-03-29":r.date<="2026-05-31"?"2026-04-26":"2026-05-31"));assert(a);
  const predictions=predict(a,f);assert.deepEqual(predictions,predict(a,f));
  // Old v2 explanations independently retain the exact seven values and missing reasons.
  for(const h of f.horses){const old=r.predictions.find(p=>p.horseId===h.horseId);assert(old);
   for(const v of h.features){const reason=old.reasons.find(x=>x.name===v.name);assert(reason);
    const raw=reason.rawValue as {value:number|null;missingReason:string|null};assert.equal(v.value,raw.value);assert.equal(v.missingReason,raw.missingReason);}}
  return {raceId:r.raceId,date:r.date,inputSha256:sha256(f),artifactSha256:sha256(a),predictions};});
 assert.equal(forecasts.length,742);save("predictions.json",{schemaVersion:2,probabilityEvent:"top3",calibrationStatus:"uncalibrated",forecasts});
 const saved=json<{forecasts:Forecast[]}>(directory+"/predictions.json");assert.equal(sha256(saved.forecasts),sha256(forecasts));
 // Truth is joined ONLY after all predictions have been saved and checked.
 const report=evaluate(saved.forecasts,reference.records,plans=>{save("plans.json",plans);assert.equal(sha256(json(directory+"/plans.json")),sha256(plans));});
 verifyProtection(proof.protectedHashes);verifyProtection(codeHashes);verifyProtection(dataset.sourceHashes);
 save("summary.json",{experimentId,sourceCommit,codeHashes,sourceHashes:dataset.sourceHashes,protectedHashes:proof.protectedHashes,
  training:artifacts.map(a=>({cutoff:a.trainedThroughDate,count:a.trainingRaceIds.length,labelsSha256:a.labelsSha256,
   initial:a.trace[0],final:a.trace.at(-1),weights:a.weights,intercept:a.intercept})),
  cohortStatus:capture.statuses,reportSha256:sha256(report),report});
 console.log(JSON.stringify({directory,experimentId,reportSha256:sha256(report),races:forecasts.length,
  overall:report.overall,ci:report.ci,training:artifacts.map(a=>({cutoff:a.trainedThroughDate,initial:a.trace[0],final:a.trace.at(-1)}))}));
}
if(require.main===module)main();
