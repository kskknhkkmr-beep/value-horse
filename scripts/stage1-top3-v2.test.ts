import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClass,derive,project,assertInput,train,predict,example,FEATURES,SETTINGS,type Input } from "./stage1-top3-v2";
import { derive as oldDerive } from "./stage1-independent-v2";
import { sha256 } from "./simulator/canonical";
import { merge,intervals } from "./stage1-top3-v2-audit";
import type { Truth,PreRaceInput } from "./simulator/types";
const row=(date:string,raceId:string,distance=1600,classRaw="3歳未勝利")=>({date,raceId,surface:"芝",distance,position:2,positionRaw:"2",fieldSize:10,
 eligibleJra:true,cornerPositionsRaw:"4-3",carriedWeightRaw:"55.0",classRaw,classCode:parseClass(classRaw,date)});
const input:Input={raceId:"202605020101",date:"2026-04-04",surface:"芝",distance:1600,currentClass:"one_win",
 horses:Array.from({length:5},(_,i)=>({horseId:"horse"+i,horseNumber:i+1,carriedWeight:55,carriedWeightRaw:"55.0",history:[row("2026-03-21","past"+i)]}))};
const truth=(f:ReturnType<typeof derive>):Truth=>({raceId:f.raceId,date:f.date,horses:f.horses.map((h,i)=>({horseId:h.horseId,horseNumber:h.horseNumber,positionRaw:String(i+1)}))} as Truth);
test("Explicit classes, old dated labels and ambiguous/unknown names are not strength scores",()=>{
 assert.equal(parseClass("２勝クラス","2026-03-21"),"two_win");assert.equal(parseClass("皐月賞(GI)","2026-03-21"),"G1");
 assert.equal(parseClass("オキザリス賞(500万下)","2018-11-10"),"one_win");assert.equal(parseClass("1500万下","2018-11-10"),null);
 for(const s of ["500万下","クラス不明","未勝利と1勝クラス"])assert.equal(parseClass(s,"2026-03-21"),null);
});
test("Six approved additions do not change original seven values or their provenance",()=>{
 const f=derive(input),base={raceId:input.raceId,date:input.date,surface:input.surface,distance:input.distance,horses:input.horses.map(h=>({...h,history:h.history.map(r=>{
 const {classCode,classRaw,...rest}=r;void classCode;void classRaw;return rest;})}))};
 assert.deepEqual(f.horses[0].features.slice(0,7),oldDerive(base).horses[0].features);
 assert.equal(f.horses[0].features.length,13);assert.deepEqual(f.horses[0].features.slice(7).map(x=>x.value),[0,1,1/3,1/3,14/365,14/365]);
 const same=derive({...input,currentClass:"maiden"});assert.equal(same.horses[0].features[7].value,1/3);assert.equal(same.horses[0].features[8].value,0);
});
test("Unknown class, no experience and true previous non-flat row are distinct",()=>{
 const unknown=derive({...input,currentClass:null});assert.equal(unknown.horses[0].features[7].value,null);
 const none=derive({...input,horses:input.horses.map(h=>({...h,history:[]}))}).horses[0].features;
 assert.equal(none[7].value,0);assert.equal(none[9].value,0);assert.equal(none[11].value,null);
 const bad={...row("2026-03-28","jump"),surface:null,distance:null,position:null,positionRaw:null,fieldSize:null,eligibleJra:false,cornerPositionsRaw:null,carriedWeightRaw:null,classRaw:null,classCode:null};
 const f=derive({...input,horses:input.horses.map(h=>({...h,history:[...h.history,bad]}))});assert.equal(f.horses[0].features[8].value,null);
});
test("Evidence counts include confirmed DNF, exclude cancellations, cap at three and age at 365",()=>{
 const make=(positionRaw:string,position:number|null)=>({...row("2025-01-01","old"),positionRaw,position});
 const f=derive({...input,horses:input.horses.map(h=>({...h,history:[make("中",null),make("取",null)]}))});
 assert.equal(f.horses[0].features[9].value,1/3);assert.equal(f.horses[0].features[11].value,1);
 const many=derive({...input,horses:input.horses.map(h=>({...h,history:Array.from({length:5},(_,i)=>row("2026-03-21","r"+i))}))});
 assert.equal(many.horses[0].features[9].value,1);assert.equal(many.horses[0].features[8].value,null);
});
test("Unknown history class and missing distance remain missing; +/-200 boundaries are inclusive",()=>{
 const bad={...row("2026-03-21","bad",1600,"不明"),distance:null};const f=derive({...input,horses:input.horses.map(h=>({...h,history:[bad]}))});
 assert.equal(f.horses[0].features[7].value,null);assert.equal(f.horses[0].features[10].value,null);
 const boundary=derive({...input,horses:input.horses.map(h=>({...h,history:[row("2026-03-21","lo",1400),row("2026-03-20","hi",1800),row("2026-03-19","out",1801)]}))});
 assert.equal(boundary.horses[0].features[10].value,2/3);
});
test("Same day/future/target self, market fields and altered class provenance fail closed",()=>{
 for(const date of [input.date,"2026-05-01"])assert.throws(()=>derive({...input,horses:input.horses.map(h=>({...h,history:[row(date,"future")]}))}));
 assert.throws(()=>derive({...input,horses:input.horses.map(h=>({...h,history:[row("2026-03-21",input.raceId)]}))}));
 for(const key of ["odds","popularity","trackCondition","opponents","result"])assert.throws(()=>assertInput({...input,[key]:1}));
 assert.throws(()=>derive({...input,horses:input.horses.map(h=>({...h,history:[{...h.history[0],classCode:"G1"}]}))}));
});
test("Raw market and weather changes cannot affect explicit projection",()=>{
 const raw={raceId:input.raceId,date:input.date,surface:input.surface,distance:input.distance,structuredClass:"one_win",horses:input.horses.map(h=>({...h,history:h.history.map(r=>({...r,netKeibaRaceId:"202605010101",venue:"東京",raceName:r.classRaw}))}))} as unknown as PreRaceInput;
 const a=project(raw),changed=JSON.parse(JSON.stringify(raw));
 assert.throws(()=>project({...raw,odds:1} as unknown as PreRaceInput));
 changed.horses.forEach((h:{history:Record<string,unknown>[]})=>h.history.forEach(r=>{r.oddsRaw="1.1";r.popularity=1;r.trackConditionRaw="重";}));
 assert.deepEqual(project(changed),a);assert(!JSON.stringify(a).includes("oddsRaw"));
});
test("One fixed fit deterministic, missing means train-only, raw sigmoid not normalized and immutable",()=>{
 const training=derive({...input,raceId:"202605010101",date:"2026-03-28"});const e=example(training,truth(training),"2026-03-29"),before=sha256(e);
 const a=train([e],"2026-03-29");assert.deepEqual(a,train([e],"2026-03-29"));assert.equal(sha256(e),before);
 assert.equal(a.weights.length,26);assert.equal(a.trace.length,201);assert.equal(a.settings.iterations,200);assert.equal(a.settings.learningRate,.1);assert.equal(a.settings.l2,.01);
 const p=predict(a,derive(input));assert.deepEqual(p,predict(a,derive(input)));assert(Object.isFrozen(p));assert.equal(p[0].reasons.length,26);
 assert.throws(()=>predict(a,training));assert.throws(()=>predict({...a,settings:{...SETTINGS,learningRate:.2}},derive(input)));
 const zero={...a,weights:Array(26).fill(0),intercept:0};assert.equal(predict(zero,derive(input)).reduce((n,h)=>n+h.rawTop3Probability,0),2.5);
});
test("Four-way merge rejects identity drift; paired bootstrap keeps identical-way difference zero",()=>{
 assert.throws(()=>merge([{raceId:"a"}] as never,[{raceId:"b"}] as never));
 const outcomes=Array.from({length:5},()=>({win:0,top3:1,raw:"2"}));const settlements=[{stakeYen:1000,profitYen:0}];
 const r={outcomes:{A:outcomes,B:outcomes,C:outcomes,D:outcomes},settlements:Object.fromEntries(["fuku","wide","sanfuku"].map(k=>[k,Object.fromEntries(["A","B","C","D","A-market","B-market","C-market"].map(w=>[w,settlements]))]))};
 assert.deepEqual(intervals([r] as never,20).results["C-B/rank1/top3"].ci95,[0,0]);
});
