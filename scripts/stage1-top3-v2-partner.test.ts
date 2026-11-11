import assert from "node:assert/strict";
import { test } from "node:test";
import { plan,join,omissions,responsibility,bootstrap,diagnose,KINDS,WAYS,type Row } from "./stage1-top3-v2-partner-core";
import { settleTicket } from "./simulator/settlement";
import type { PlanningInput } from "./stage1-axis-bet-core";
import type { Truth } from "./simulator/types";
const horse=(n:number)=>({horseId:String(n).padStart(10,"0"),horseNumber:n});
const input=():PlanningInput=>({raceId:"202606030301",date:"2026-04-04",starters:[1,2,3,4,5,6].map(horse),
 vh:[1,6,5,4,3,2].map(horse),market:[2,3,4,5,1,6].map(horse)});
function truth():Truth {return {raceId:input().raceId,date:input().date,archivedStartTime:"10:00",horses:input().starters.map(h=>({...h,
 positionRaw:String(h.horseNumber),popularity:input().market.findIndex(m=>m.horseId===h.horseId)+1,raceTimeRaw:null,marginRaw:null,final3fRaw:null,cornerPositionsRaw:null,finalOddsRaw:null})),
 payouts:Object.fromEntries(["tan","fuku","wide","umaren","umatan","sanfuku","santan"].map(k=>[k,{status:"ok",rawCombination:null,rawPayout:null,
 entries:k==="wide"?[{combo:[1,2],payout:200},{combo:[1,3],payout:300},{combo:[2,3],payout:400}]:[{combo:[1,2,3],payout:1000}]}])) as Truth["payouts"]};}
function row(i=input(),t=truth()):Row {const p=plan(i);return join({raceId:i.raceId,date:i.date,vh:i.vh,market:i.market,truth:t},
 Object.fromEntries(KINDS.map(k=>[k,Object.fromEntries((["A","B","E"]as const).map(w=>[w,p[w].tickets[k].map(ticket=>settleTicket(ticket,t))]))])) as Parameters<typeof join>[1]);}
test("Fixed mixtures, market-first order, own-axis exclusion, and C wide equals B",()=>{
 const p=plan(input()),numbers=(w:keyof typeof p)=>p[w].partners.sanfuku.map(h=>h.horseNumber);
 assert.deepEqual(numbers("A"),[6,5,4,3]);assert.deepEqual(numbers("B"),[2,3,4,5]);assert.deepEqual(numbers("C"),[2,3,4,6]);assert.deepEqual(numbers("D"),[2,3,6,5]);
 assert.deepEqual(p.C.tickets.wide,p.B.tickets.wide);assert.equal(p.E.axis.horseNumber,2);
 for(const w of WAYS)for(const k of KINDS){assert.equal(p[w].tickets[k].length,k==="wide"?3:6);assert.equal(new Set(p[w].tickets[k].map(t=>t.horses.join("-"))).size,p[w].tickets[k].length);}
 const i=input();i.market=[i.vh[0],...i.market.filter(h=>h.horseNumber!==1)];assert.deepEqual(plan(i).B.partners.sanfuku.map(h=>h.horseNumber),[2,3,4,5]);
});
test("Reject result injections, nondevelopment date, duplicates and fewer than five; reordered starters invariant",()=>{
 const i=input();assert.throws(()=>plan({...i,result:1}as PlanningInput));assert.throws(()=>plan({...i,date:"2026-06-27"}));
 assert.throws(()=>plan({...i,vh:[i.vh[0],...i.vh.slice(0,-1)]}));
 const hs=i.vh.slice(0,4);assert.throws(()=>plan({...i,starters:hs,vh:hs,market:hs}));
 assert.deepEqual(plan(i),plan({...i,starters:[...i.starters].reverse()}));
});
test("Truth changes cannot select partners; exact official payout arithmetic and frozen settlements retained",()=>{
 const i=input(),t=truth(),before=JSON.stringify(plan(i)),r=row(i,t);assert.equal(r.settlements.wide.B.reduce((s,t)=>s+t.returnYen!,0),5000);
 const original=r.settlements.wide.A;const joined=join({raceId:r.raceId,date:r.date,vh:r.vh,market:r.market,truth:t},{wide:{A:original,B:r.settlements.wide.B,E:r.settlements.wide.E},sanfuku:{A:r.settlements.sanfuku.A,B:r.settlements.sanfuku.B,E:r.settlements.sanfuku.E}});
 assert.equal(joined.settlements.wide.A,original);t.horses[0].positionRaw="中止";assert.equal(JSON.stringify(plan(i)),before);
});
test("Top5 omission includes axis, conditional alternate denominator excludes same-axis horse",()=>{
 const o=omissions([row()]);assert.equal(o[0].excluded,1);assert.deepEqual(o[0].finishes,[0,1,0]);assert.equal(o[4].included,1);
 assert.equal(o[4].axisTop3NotSameAxisRaces,0);assert.equal(o[4].axisTop3NotSameAxisExcludedRate,null);
});
test("Separate axis failure from partner failure; unknowns never become fabricated fourth places",()=>{
 const r=row();const a=responsibility([r],"wide","A"),b=responsibility([r],"wide","B");
 assert.equal(a.partnerFailure,1);assert.equal(a.success,0);assert.equal(b.success,1);assert.equal(b.conditionalHitRate,1);
 const t=truth();t.horses[0].positionRaw="中止";t.payouts.wide.entries=[{combo:[2,3],payout:200}];t.payouts.sanfuku.entries=[{combo:[2,3,4],payout:1000}];
 const n=responsibility([row(input(),t)],"wide","A");assert.equal(n.axisNotTop3,1);assert.equal(n.axisSpecial,1);assert.equal(n.conditionalHitRate,null);
});
test("Dead heat: three selected numeric Top3 horses do not imply official trio win",()=>{
 const t=truth();t.horses[3].positionRaw="3";t.payouts.sanfuku.entries=[{combo:[1,2,3],payout:1000},{combo:[1,2,4],payout:900}];
 assert.equal(settleTicket({kind:"sanfuku",horses:[2,3,4],stakeYen:1000},t).status,"loss");
 t.payouts.wide.entries=[{combo:[1,2],payout:200},{combo:[1,3],payout:150},{combo:[1,4],payout:130}];assert.doesNotThrow(()=>row(input(),t));
});
test("Missing payouts, cancellations and wrong saved ticket identities fail closed",()=>{
 const t=truth();t.payouts.wide.status="missing";assert.throws(()=>row(input(),t));
 t.payouts.wide.status="ok";t.horses[0].positionRaw="取消";assert.throws(()=>row(input(),t));
 const r=row();r.settlements.wide.A[0]={...r.settlements.wide.A[0],horses:[1,2]};assert.throws(()=>diagnose([r],10));
});
test("Paired race bootstrap deterministic, identical B/C wide is exact zero; common high payout removal",()=>{
 const a=row(),b=row({...input(),raceId:"202606030302"},{...truth(),raceId:"202606030302"});const rs=[a,b],before=JSON.stringify(rs);
 const x=bootstrap(rs,30);assert.deepEqual(x,bootstrap(rs,30));assert.deepEqual(x.results["wide/B-C/ROI"].ci95,[0,0]);
 const r=diagnose(rs,30);assert.equal(JSON.stringify(rs),before);assert.equal(r.sensitivity.wide[0].removed.length,1);
 for(const w of WAYS)assert.equal(r.sensitivity.wide[0].results[w].betRaces,1);
});
