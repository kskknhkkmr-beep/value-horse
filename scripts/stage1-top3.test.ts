import assert from "node:assert/strict";
import test from "node:test";
import { example,label,train,predict,sigmoid,bce,SETTINGS } from "./stage1-top3";
import { FEATURES,assertIndependent,type FeaturedRace } from "./stage1-independent-v2";
import { RACE_KIND_VERSION } from "./simulator/race-kind";
import { frozenClone,sha256 } from "./simulator/canonical";
import type { Truth } from "./simulator/types";
import { generate } from "./stage1-axis-bet-core";
import { settleTicket } from "./simulator/settlement";
import { evaluate,intervals } from "./stage1-top3-audit";
import type { Run } from "./simulator/types";
const input:FeaturedRace={inputClassificationVersion:RACE_KIND_VERSION,raceId:"202605010101",date:"2026-03-21",
 horses:Array.from({length:5},(_,i)=>({horseId:"900000000"+(i+1),horseNumber:i+1,features:FEATURES.map(name=>({name,value:i/5,unit:"test",missingReason:null,sourceRows:[]}))}))};
const truth:Truth={raceId:input.raceId,date:input.date,archivedStartTime:"10:00",horses:input.horses.map((h,i)=>({
 horseId:h.horseId,horseNumber:h.horseNumber,positionRaw:String(i+1),raceTimeRaw:null,marginRaw:null,final3fRaw:null,cornerPositionsRaw:null,finalOddsRaw:"99",popularity:5-i})),
 payouts:Object.fromEntries(["tan","fuku","wide","umaren","umatan","sanfuku","santan"].map(k=>[k,{status:"ok",rawCombination:null,rawPayout:null,entries:k==="fuku"?[{horse:1,payout:200},{horse:2,payout:110}]:[{combo:k==="wide"?[1,2]:[1,2,3],payout:500}]}])) as Truth["payouts"]};
const later={...input,raceId:"202605020101",date:"2026-04-04"};
test("Top3 labels, small fields, dead heat and DNF are not win/fuku labels",()=>{
 assert.deepEqual([1,2,3,3,5].map(n=>label(String(n),5)),[1,1,1,1,0]);
 assert.equal(label("2",2),1);assert.equal(label("3",5),1);
 for(const s of ["中","中止","失","失格"])assert.equal(label(s,5),0);
 assert.equal(settleTicket({kind:"fuku",horses:[3],stakeYen:1000},truth).status,"loss");
});
test("unknown, demotion without official number and nonstarters abort",()=>{
 for(const s of [null,"","**","降","取","除","取消","除外","0","6"])assert.throws(()=>label(s,5));
 assert.equal(label("4",5),0); // officially adjusted numeric rank, never inferred from raw text
 const bad={...truth,horses:truth.horses.map((h,i)=>({...h,positionRaw:i===4?null:h.positionRaw}))};
 assert.throws(()=>example(input,bad,"2026-03-29"));
});
test("starter/result identities, duplicate IDs/numbers and unmatched result rejected",()=>{
 assert.throws(()=>example(input,{...truth,horses:[...truth.horses,truth.horses[0]]},"2026-03-29"));
 assert.throws(()=>example(input,{...truth,horses:truth.horses.map(h=>({...h,horseNumber:1}))},"2026-03-29"));
 assert.throws(()=>example(input,{...truth,horses:truth.horses.slice(1)},"2026-03-29"));
 const cancelled={...truth.horses[0],horseId:"9000000006",horseNumber:6,positionRaw:"取"};
 assert.equal(example(input,{...truth,horses:[...truth.horses,cancelled]},"2026-03-29").labels.length,5);
});
test("stable sigmoid/BCE avoid overflow",()=>{for(const z of [-10000,0,10000])for(const y of [0,1])assert(Number.isFinite(bce(z,y)));
 assert.equal(sigmoid(0),.5);assert.equal(sigmoid(10000),1);assert.equal(sigmoid(-10000),0);});
test("fixed fit is deterministic, race average, separate marginal probability",()=>{
 const e=example(input,truth,"2026-03-29"),before=sha256(e),a=train([e],"2026-03-29");
 assert.deepEqual(a,train([e],"2026-03-29"));assert.equal(sha256(e),before);
 assert.equal(a.trace.length,201);assert(a.trace.at(-1)!.loss<a.trace[0].loss);
 assert.equal(a.settings.iterations,200);assert.equal(a.settings.learningRate,.1);assert.equal(a.settings.l2,.01);
 const p=predict(a,later);assert.deepEqual(p,predict(a,later));assert(p.reduce((n,h)=>n+h.rawTop3Probability,0)>1);
 assert.equal(p[0].probabilityEvent,"top3");assert.deepEqual(p.map(h=>h.mark),["◎","○","▲","△",null]);
 const zero={...a,weights:Array(14).fill(0),intercept:0};assert.deepEqual(predict(zero,later).map(h=>h.horseNumber),[1,2,3,4,5]);
 assert.equal(predict(zero,later).reduce((n,h)=>n+h.rawTop3Probability,0),2.5);
});
test("first gradient has race/horse weighting and unregularized intercept",()=>{
 const e=example(input,truth,"2026-03-29"),a=train([e],"2026-03-29");
 assert(Math.abs(a.trace[0].loss-Math.log(2))<1e-10);
 assert.equal(a.trainingRaceIds.length,1);assert.equal(a.weights.length,14);assert.equal(a.means.length,7);
 // Repeating every horse with unique identities preserves horse-average gradients.
 const twice={...e,input:{...input,horses:[...input.horses,...input.horses.map(h=>({...h,horseId:"8"+h.horseId.slice(1),horseNumber:h.horseNumber+5}))]},
  labels:[...e.labels,...e.labels.map(l=>({...l,horseId:"8"+l.horseId.slice(1)}))]};
 const b=train([twice],"2026-03-29");assert(Math.abs(a.intercept-b.intercept)<1e-12);a.weights.forEach((w,i)=>assert(Math.abs(w-b.weights[i])<1e-12));
});
test("future/same-day source and in-sample models are rejected",()=>{
 const a=train([example(input,truth,"2026-03-29")],"2026-03-29");assert.throws(()=>predict(a,input));
 for(const date of [later.date,"2026-05-01"]){const bad=JSON.parse(JSON.stringify(later));bad.horses[0].features[0].sourceRows=[{date,raceId:null}];
  assert.throws(()=>predict(a,bad),/Future/);}
 const bad=JSON.parse(JSON.stringify(input));bad.horses[0].features[0].sourceRows=[{date:input.date,raceId:input.raceId}];
 assert.throws(()=>train([example(bad,truth,"2026-03-29")],"2026-03-29"),/Future/);
 assert.throws(()=>example(input,truth,"2026-02-07"));
});
test("independent input rejects market/results and unknown/jump",()=>{
 const projection={raceId:later.raceId,date:later.date,surface:"芝",distance:1600,horses:[]};
 for(const surface of ["障",null])assert.throws(()=>assertIndependent({...projection,surface} as never));
 for(const key of ["odds","popularity","result","payout"])
  assert.throws(()=>assertIndependent({...projection,[key]:10} as never),/Unapproved/);
 const a=train([example(input,truth,"2026-03-29")],"2026-03-29");
 assert.throws(()=>predict({...a,settings:{...SETTINGS,version:"v2"} as never},later));
 const old=sha256(truth),changed={...truth,horses:truth.horses.map(h=>({...h,finalOddsRaw:"1.1",popularity:1}))};
 assert.deepEqual(train([example(input,changed,"2026-03-29")],"2026-03-29"),a);assert.equal(sha256(truth),old);
});
test("immutable all-horse rankings generate original fixed tickets and official dead-heat payouts",()=>{
 const a=train([example(input,truth,"2026-03-29")],"2026-03-29"),p=predict(a,later);
 assert(Object.isFrozen(p));const horses=p.map(h=>({horseId:h.horseId,horseNumber:h.horseNumber}));
 const plans=generate({raceId:later.raceId,date:later.date,starters:horses,vh:horses,market:[...horses].reverse()})!;
 assert.equal(plans.A.tickets.wide.length,3);assert.equal(plans.A.tickets.sanfuku.length,6);
 for(const t of plans.A.tickets.sanfuku){assert.equal(t.stakeYen,1000);assert.equal(new Set(t.horses).size,3);}
 const dead=frozenClone({...truth,payouts:{...truth.payouts,sanfuku:{status:"ok" as const,rawCombination:null,rawPayout:null,
  entries:[{combo:[1,2,3],payout:500},{combo:[1,2,4],payout:700}]}}});
 assert.equal(settleTicket({kind:"sanfuku",horses:[4,1,2],stakeYen:1000},dead).returnYen,7000);
});
test("Top3 evaluation keeps forecast bytes fixed and saves plans before payout join",()=>{
 const a=train([example(input,truth,"2026-03-29")],"2026-03-29"),predictions=predict(a,later);
 const forecasts=[{raceId:later.raceId,date:later.date,inputSha256:sha256(later),artifactSha256:sha256(a),predictions}];
 const actual={...truth,raceId:later.raceId,date:later.date};
 const records=[{raceId:later.raceId,date:later.date,inputSha256:sha256(later),starters:input.horses,
  predictions:predictions.map(p=>({horseId:p.horseId,horseNumber:p.horseNumber,rank:p.rank,probability:.2,reasons:[]})),tickets:[],actual}] as unknown as Run["records"];
 const before=sha256(forecasts);let saved=false;
 const r=evaluate(forecasts,records,p=>{assert(p);saved=true;});assert(saved);assert.equal(sha256(forecasts),before);
 assert.equal(r.overall.races,1);assert.equal(r.ci.results["B-A/rank1/top3"].estimate,0);
 const altered=records.map(r=>({...r,actual:{...r.actual,horses:r.actual.horses.map(h=>({...h,positionRaw:"4"}))}}));
 const other=evaluate(forecasts,altered);assert.equal(sha256(forecasts),before);
 assert.equal(other.overall.ranks.B[0].top3,0);
 assert.deepEqual(intervals(r.rows,20),intervals(r.rows,20));
 assert.deepEqual(intervals(r.rows,20).results["B-A/fuku/ROI"].ci95,[0,0]);
});
