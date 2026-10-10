import assert from "node:assert/strict";
import { test } from "node:test";
import { generate,settle,exclusion,accounts,uncertainty,report,type PlanningInput } from "./stage1-axis-bet-core";
import type { Truth } from "./simulator/types";
const input=():PlanningInput=>{const hs=[1,3,5,7,9].map(n=>({horseId:String(n).padStart(10,"0"),horseNumber:n}));
 return {raceId:"202606030301",date:"2026-04-04",starters:hs,vh:[...hs],market:[hs[2],hs[0],hs[1],hs[4],hs[3]]};};
const truth=():Truth=>({raceId:"202606030301",date:"2026-04-04",archivedStartTime:"10:00",
 horses:input().starters.map((h,i)=>({...h,positionRaw:String(i+1),raceTimeRaw:null,marginRaw:null,final3fRaw:null,
 cornerPositionsRaw:null,finalOddsRaw:null,popularity:null})),
 payouts:Object.fromEntries(["tan","fuku","wide","umaren","umatan","sanfuku","santan"].map(k=>[k,{
 status:"ok",rawCombination:null,rawPayout:null,entries:[{combo:k==="sanfuku"?[1,3,5]:[1,3],payout:250}]}])) as Truth["payouts"]});
test("four fixed policies exclude own axis and have 3/6 unique tickets",()=>{
 const p=generate(input())!;assert.equal(p.A.axis.horseNumber,1);assert.equal(p.B.axis.horseNumber,1);
 assert.equal(p.C.axis.horseNumber,5);assert.equal(p.D.axis.horseNumber,5);
 assert.deepEqual(p.A.partners.wide.map(h=>h.horseNumber),[3,5,7]);assert.deepEqual(p.B.partners.wide.map(h=>h.horseNumber),[5,3,9]);
 for(const q of Object.values(p)){assert.equal(q.tickets.wide.length,3);assert.equal(q.tickets.sanfuku.length,6);
 for(const[k,ts]of Object.entries(q.tickets)){assert.equal(ts.reduce((n,t)=>n+t.stakeYen,0),k==="wide"?3000:6000);
 assert.equal(new Set(ts.map(t=>t.horses.join("-"))).size,ts.length);assert(ts.every(t=>t.horses.includes(q.axis.horseNumber)));}}
});
test("stable IDs, noncontinuous horse numbers and starter array reordering",()=>{
 const i=input(),a=generate(i);i.starters.reverse();assert.deepEqual(a,generate(i));
 i.vh[0]={...i.vh[0],horseNumber:3};assert.throws(()=>generate(i));
});
test("result/odds injection and sealed/future dates rejected",()=>{
 const i=input();assert.throws(()=>generate({...i,actual:truth()} as PlanningInput));
 assert.throws(()=>generate({...i,date:"2026-06-27"}));
 assert.throws(()=>generate({...i,vh:i.vh.map(h=>({...h,position:1}))}));
});
test("fewer than five never reduces points or budget",()=>{
 const i=input();for(const k of ["starters","vh","market"]as const)i[k]=i[k].filter(h=>h.horseNumber!==9);
 assert.equal(generate(i),null);
});
test("same axis yields A=C and B=D; identical ranking yields all same",()=>{
 const i=input();i.market=[i.vh[0],...i.market.filter(h=>h.horseId!==i.vh[0].horseId)];const p=generate(i)!;
 assert.deepEqual(p.A,p.C);assert.deepEqual(p.B,p.D);
 i.market=i.vh;const q=generate(i)!;for(const p of Object.values(q))assert.deepEqual(p,q.A);
});
test("outcome mutation never changes frozen planned tickets",()=>{
 const p=generate(input())!,before=JSON.stringify(p),t=truth();t.horses[0].positionRaw="失格";settle(p,t);
 assert.equal(JSON.stringify(p),before);assert.deepEqual(generate(input()),p);
});
test("dead heat multiple payouts, yen arithmetic and no top3 inference",()=>{
 const t=truth();t.payouts.wide.entries.push({combo:[1,5],payout:300});const r=settle(generate(input())!,t);
 assert.equal(exclusion(r).length,0);const a=accounts([r],"wide");assert.equal(a.A.hitTickets,2);assert.equal(a.A.returnYen,5500);assert.equal(a.A.profitYen,2500);
});
test("missing, cancellation and verified refund exclude whole common race",()=>{
 const t=truth();t.payouts.sanfuku.status="missing";let r=settle(generate(input())!,t);assert(exclusion(r).length);assert.throws(()=>accounts([r],"wide"));
 t.payouts.sanfuku.status="ok";t.horses[0].positionRaw="取消";r=settle(generate(input())!,t);assert(exclusion(r).some(s=>s.status==="unresolved"));
 t.refunds=[{kind:"wide",horses:[1,3],evidence:"confirmed"}];r=settle(generate(input())!,t);assert(exclusion(r).some(s=>s.status==="refunded"));
});
test("paired race bootstrap exact zero and deterministic same strategies",()=>{
 const i=input();i.market=i.vh;const r=settle(generate(i)!,truth()),a=uncertainty([r],100);
 assert.deepEqual(a,uncertainty([r],100));assert.deepEqual(a.results.wide["A-D/roi"].ci,[0,0]);
 assert.deepEqual(a.results.sanfuku["interaction/hit"].ci,[0,0]);assert.throws(()=>uncertainty([r,r],100));
});
test("sensitivity removes shared race for all ways, never individual ticket only",()=>{
 const r=settle(generate(input())!,truth()),r2={...r,raceId:"202606030302"};const s=report([r,r2]);
 for(const v of Object.values(s.sensitivity))for(const t of v)for(const a of Object.values(t.results))assert.equal(a.betRaces,2-t.removed.length);
});
