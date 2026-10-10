import assert from "node:assert/strict";
import test from "node:test";
import type { History, RaceSpec, Truth, Policy } from "./simulator/types";
import { prepareInputV2 } from "./stage1-v2-input";
import { simulate } from "./simulator/stage1-v2-runner";
import { derive, independentInput, SETTINGS } from "./stage1-independent-v2";
import { train, model, subset, configuration, featureNames } from "./stage1-feature-ablation-model";
import { sensitivity, comparisons } from "./stage1-feature-ablation-audit-core";
import type { Row } from "./stage1-feature-ablation-audit-core";
import type { Outcome } from "./stage1-first-audit-core";
const row: History = {
  netKeibaRaceId: "202605010101", date: "2026-03-21", venue: "東京", venueRaw: "1東京1", raceName: "未勝利",
  weatherRaw: null, surface: "芝", distance: 1600, trackConditionRaw: null, fieldSize: 8,
  frameNumber: null, horseNumber: 1, positionRaw: "2", position: 2, marginRaw: null,
  raceTimeRaw: null, cornerPositionsRaw: "4-3", final3fRaw: null, jockey: null, jockeyId: null,
  carriedWeightRaw: "54", horseWeightRaw: null, oddsRaw: "99", popularity: 8
};
const starter = { horseId: "9000000001", horse: "test", horseNumber: 1, frameNumber: 1, sex: null,
  age: null, carriedWeight: 56, carriedWeightRaw: "56", jockey: null, jockeyId: null, trainer: null, trainerId: null };
const race: RaceSpec = { raceId: "202605020101", date: "2026-05-02", venue: "東京", raceNumber: 1,
  raceName: "未勝利", surface: "芝", distance: 1600, classRaw: null, structuredClass: null, grade: null, starters: [starter] };

const target = { ...race, starters: [starter,{...starter,horseId:"9000000002",horseNumber:2}] };
const histories = {"9000000001":[row],"9000000002":[{...row,position:5,positionRaw:"5",cornerPositionsRaw:"7-7",carriedWeightRaw:"58"}]};
const input = prepareInputV2({...target,raceId:"202605020102"},histories);
const training = derive(independentInput(prepareInputV2({...target,date:"2026-04-04"},histories)));
const ex = [{input:training,winnerId:starter.horseId}];
const context = {seed:0,random:()=>0};
test("B/C fixed subsets, optimizer and deterministic independent fits",()=>{
 for (const variant of ["B","C"] as const) {
  const artifact=train(variant,ex,"2026-04-04");
  assert.deepEqual(artifact,train(variant,ex,"2026-04-04"));
  assert.equal(artifact.weights.length,12);assert.equal(artifact.means.length,6);
  assert.deepEqual({...configuration(variant),version:SETTINGS.version},SETTINGS);
  assert.deepEqual(artifact.features,featureNames(variant));
  assert.equal(subset(training,variant).horses[0].features.length,6);
  const predicted=model(artifact,"0".repeat(64)).predict(input,context);
  assert.equal(predicted[0].reasons.length,12);
  assert(!predicted.flatMap(p=>p.reasons).some(r=>r.name.startsWith(variant==="B"?"weightChange":"cornerPosition")));
  assert.deepEqual(predicted,model(artifact,"0".repeat(64)).predict(input,context));
 }
});
test("unused feature cannot change fitted numeric weights or prediction",()=>{
 for (const variant of ["B","C"] as const) {
  const changed={...histories,"9000000001":[{...row,cornerPositionsRaw:variant==="C"?"1":row.cornerPositionsRaw,
    carriedWeightRaw:variant==="B"?"70":row.carriedWeightRaw}]};
  const artifact=train(variant,ex,"2026-04-04");
  const changedTraining=derive(independentInput(prepareInputV2({...target,date:"2026-04-04"},changed)));
  const fitted=train(variant,[{input:changedTraining,winnerId:starter.horseId}],"2026-04-04");
  assert.deepEqual(artifact.weights,fitted.weights);assert.deepEqual(artifact.means,fitted.means);
  const m=model(artifact,"0".repeat(64));
  const before=m.predict(input,context),after=m.predict(prepareInputV2({...target,raceId:"202605020102"},changed),context);
  assert.deepEqual(before.map(p=>[p.horseId,p.probability]),after.map(p=>[p.horseId,p.probability]));
 }
});
test("missing indicator retained only for active feature",()=>{
 const missing=derive(independentInput(prepareInputV2({...target,date:"2026-04-04"},{...histories,"9000000001":[{...row,cornerPositionsRaw:"**",carriedWeightRaw:"**"}]})));
 for (const variant of ["B","C"] as const) {
  const f=subset(missing,variant).horses[0].features[5];
  assert.equal(f.value,null);assert(f.missingReason);
  assert.equal(train(variant,[{input:missing,winnerId:starter.horseId}],"2026-04-04").weights.length,12);
 }
});
test("training and prediction reject future, same-day, duplicate or in-sample data",()=>{
 for(const variant of ["B","C"] as const) {
  assert.throws(()=>train(variant,ex,"2026-03-29"),/Invalid training/);
  assert.throws(()=>train(variant,[...ex,...ex],"2026-04-04"),/duplicate/);
  const bad=structuredClone(training);bad.horses[0].features[0].sourceRows[0].date=training.date;
  assert.throws(()=>train(variant,[{input:bad,winnerId:starter.horseId}],"2026-04-04"),/Leaked/);
  const a=train(variant,ex,"2026-04-04"),m=model(a,"0".repeat(64));
  assert.throws(()=>m.predict(prepareInputV2({...target,date:"2026-04-04"},histories),context),/In-sample/);
  assert.throws(()=>m.predict(prepareInputV2(target,histories),context),/In-sample/); // fixture intentionally has same raceId as training
 }
});
test("future/target histories and market labels never change B/C choices",()=>{
 const target2={...target,raceId:"202605020102"},base=prepareInputV2(target2,histories);
 const changed={...histories,"9000000001":[{...row,oddsRaw:"1.1",popularity:1},{...row,date:target2.date},
   {...row,date:"2026-06-21"},{...row,netKeibaRaceId:target2.raceId}]};
 const altered=prepareInputV2(target2,changed);
 assert.deepEqual(independentInput(base),independentInput(altered));
 for(const variant of ["B","C"] as const) {
  const m=model(train(variant,ex,"2026-04-04"),"0".repeat(64));
  assert.deepEqual(m.predict(base,context),m.predict(altered,context));
  assert.throws(()=>m.predict({...base,finalOdds:2} as typeof base,context),/Unapproved/);
 }
});
test("target truth joined after B/C predictions and cannot influence them",()=>{
 const target2={...target,raceId:"202605020102"};
 const unavailable={status:"not_offered" as const,rawCombination:null,rawPayout:null,entries:[]};
 const truth:Truth={raceId:target2.raceId,date:target2.date,archivedStartTime:null,
 horses:target2.starters.map((h,i)=>({horseId:h.horseId,horseNumber:h.horseNumber,positionRaw:String(i+1),
 raceTimeRaw:null,marginRaw:null,final3fRaw:null,cornerPositionsRaw:null,finalOddsRaw:"2",popularity:i+1})),
 payouts:{tan:unavailable,fuku:unavailable,wide:unavailable,umaren:unavailable,umatan:unavailable,sanfuku:unavailable,santan:unavailable}};
 const policy:Policy={identity:{name:"no-bets",version:"1",codeSha256:"0".repeat(64),trainedThroughDate:null,config:{}},tickets:()=>[]};
 for(const variant of ["B","C"] as const) {
  const m=model(train(variant,ex,"2026-04-04"),"0".repeat(64));
  const data={races:[target2],historyByHorse:histories,truthByRace:{[target2.raceId]:truth},sourceHashes:{},constraints:[]};
  const a=simulate(data,m,policy,0,"0".repeat(64));
  const b=simulate({...data,truthByRace:{[target2.raceId]:{...truth,horses:truth.horses.map(h=>({...h,positionRaw:"9",finalOddsRaw:"99",popularity:9}))}}},m,policy,0,"0".repeat(64));
  assert.deepEqual(a.records[0].predictions,b.records[0].predictions);assert.equal(a.inputSha256,b.inputSha256);
  assert.notEqual(a.truthSha256,b.truthSha256);
 }
});
test("wrong feature/version/numeric artifact fails closed",()=>{
 const a=train("B",ex,"2026-04-04");
 assert.throws(()=>model({...a,variant:"C"},"0".repeat(64)),/Invalid/);
 assert.throws(()=>model({...a,weights:[NaN,...a.weights.slice(1)]},"0".repeat(64)),/Invalid/);
 assert.throws(()=>featureNames("D" as "B"),/Only fixed/);
});
const outcome=(horseNumber:number,returnYen:number):Outcome=>({
 horseId:String(horseNumber),horseNumber,positionRaw:returnYen?"1":"9",popularity:horseNumber,finalOdds:2,
 win:returnYen>0,place:returnYen>0,top3:returnYen>0,
 settlement:{kind:"tan",horses:[horseNumber],stakeYen:1000,status:returnYen?"win":"loss",
 returnYen,profitYen:returnYen-1000} as Outcome["settlement"]
});
test("highest model payout removes the same races from every model and market",()=>{
 const rows:Row[]=[1,2,3].map(i=>({raceId:String(i),date:"2026-04-04",archivedStartTime:null,
 selections:{A:outcome(1,i===1?3000:0),B:outcome(2,i===2?4000:0),C:outcome(3,0),D:outcome(4,0),market:outcome(1,i===3?99999:0)}}));
 const s=sensitivity(rows);
 assert.deepEqual(s[0].removed.map(r=>r.raceId),["2"]);
 assert.deepEqual(s[1].removed.map(r=>r.raceId),["2","1"]);
 assert.deepEqual(s[1].remainingIds,["3"]);
 for(const a of Object.values(s[1].accounts))assert.equal(a.n,1);
 assert.equal(s[1].accounts.market.profitYen,98999);
});
test("all six model pairs plus four market pairs share race units",()=>{
 const shared=outcome(1,2000);
 const rows:Row[]=[1,2].map(i=>({raceId:String(i),date:"2026-04-04",archivedStartTime:null,
 selections:{A:shared,B:shared,C:shared,D:shared,market:shared}}));
 const cs=comparisons(rows);assert.equal(cs.length,10);
 for(const c of cs){assert.equal(c.changedCount,0);assert.deepEqual(c.win.ci95,[0,0]);assert.deepEqual(c.money.pairedRoiDifference95CI,[0,0]);}
 assert.throws(()=>comparisons([...rows,rows[0]]));
});
