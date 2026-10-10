import assert from "node:assert/strict";
import { test } from "node:test";
import { ranking, contributionGap, outcomeGroups, changedPick, commonSensitivity, firstExamples, pairedAccounts } from "./stage1-v2-diagnosis-core";
import { pairedRateCI } from "./stage1-v2-audit-core";
import type { RankedPrediction } from "./simulator/types";
import type { Outcome, AuditRow } from "./stage1-first-audit-core";
const names=["recentFinish","surfaceFinish","distanceFinish","historyCount","restDays","cornerPosition","weightChange"];
function pred(id:string,n:number,values:Record<number,number>):RankedPrediction {
 return {horseId:id,horseNumber:n,rank:n,probability:.5,reasons:Array.from({length:14},(_,j)=>({
  name:j<7?names[j]:names[j-7]+":missing",rawValue:null,contribution:values[j]??0,explanation:"fixture"}))};
}
function outcome(id:string,n:number,ret:number):Outcome {
 return {horseId:id,horseNumber:n,positionRaw:ret?"1":"9",popularity:n,finalOdds:2,
  win:ret>0,place:ret>0,top3:ret>0,settlement:{kind:"tan",horses:[n],stakeYen:1000,
   status:ret?"win":"loss",returnYen:ret,profitYen:ret-1000,note:null}};
}
function row(id:string,a:number,b:number):AuditRow {
 return {raceId:id,date:"2026-04-04",archivedStartTime:"10:00",
  independent:outcome("new",1,a),vh:outcome("old",2,b),market:outcome("m",3,0)};
}
test("fixed masks remove value plus its missing term without changing saved reasons",()=>{
 const a=pred("a",1,{0:.2,5:.2,12:.1,6:.04,13:.02}),b=pred("b",2,{0:.3});
 const before=JSON.stringify([a,b]);
 assert.equal(ranking([a,b],"none")[0].horseId,"a");
 assert.equal(ranking([a,b],"withoutCorner")[0].horseId,"b");
 assert.equal(ranking([a,b],"withoutCorner").find(p=>p.horseId==="a")!.score,.26);
 assert.equal(ranking([a,b],"withoutWeight")[0].horseId,"a");
 assert.equal(JSON.stringify([a,b]),before);
 assert(Math.abs(ranking([a,b],"none").reduce((s,p)=>s+p.probability,0)-1)<1e-14);
 const g=contributionGap(a,b);assert(Math.abs(g.total-.26)<1e-14);
 assert(Math.abs(g.corner-.3)<1e-14);assert(Math.abs(g.weight-.06)<1e-14);
});
test("ties use horse number, corrupt names and duplicate horses fail closed",()=>{
 assert.equal(ranking([pred("b",2,{}),pred("a",1,{})],"none")[0].horseId,"a");
 const x=pred("a",1,{});x.reasons[0].name="odds";assert.throws(()=>ranking([x],"none"));
 assert.throws(()=>ranking([pred("a",1,{}),pred("a",2,{})],"none"));
});
test("dead heat different winning picks is both-win, not unchanged or exclusive win",()=>{
 const xs=[row("1",2000,0),row("2",0,2000),row("3",2000,2000),row("4",0,0)];
 const groups=outcomeGroups(xs);assert.deepEqual(Object.values(groups).map(x=>x.length),[1,1,1,1]);
 assert(changedPick(xs[2]));assert.equal(pairedAccounts(xs).profitDifference,0);
});
test("high payout sensitivity removes exactly the same race IDs for both models",()=>{
 const xs=[row("1",20000,0),row("2",15000,15000),row("3",0,23000)];
 const a=commonSensitivity(xs,"v2Payout");
 assert.deepEqual(a.map(x=>x.removed.map(r=>r.raceId)),[["1"],["1","2"]]);
 assert.equal(a[0].remaining.v2.riskedYen,2000);assert.equal(a[0].remaining.previous.riskedYen,2000);
 assert.equal(a[0].remaining.profitDifference,-23000);assert.equal(a[1].remaining.profitDifference,-23000);
 assert.equal(commonSensitivity(xs,"eitherPayout")[0].removed[0].raceId,"3");
 assert.equal(commonSensitivity(xs,"positiveDelta")[0].removed[0].raceId,"1");
});
test("examples are chronological and independent of popularity or payout size",()=>{
 const xs=[row("3",30000,0),row("1",2000,0),row("2",4000,0),row("4",0,25000)];
 xs[0].independent!.popularity=18;
 const ex=firstExamples(xs);assert.deepEqual(ex.success.map(r=>r.raceId),["1","2","3"]);
 assert.equal(ex.failure[0].raceId,"4");
});
test("paired race CI preserves pairing and no-change gives exactly zero",()=>{
 const r=row("1",2000,2000);r.vh=r.independent;
 assert.deepEqual(pairedRateCI([r],"independent","vh").ci95,[0,0]);
 assert.equal(pairedRateCI([r],"independent","vh").difference,0);
});
