import assert from "node:assert/strict";
import { test } from "node:test";
import { generate,settle,type PlanningInput } from "./stage1-axis-bet-core";
import { diagnose,outcome,paired,type RankingRow } from "./stage1-partner-ranking-core";
import type { Truth } from "./simulator/types";
function row():RankingRow{
 const hs=Array.from({length:6},(_,i)=>({horseId:String(i+1).padStart(10,"0"),horseNumber:i+1}));
 const input:PlanningInput={raceId:"202606030301",date:"2026-04-04",starters:hs,vh:hs,market:[hs[4],hs[1],hs[0],hs[2],hs[3],hs[5]]};
 const truth:Truth={raceId:input.raceId,date:input.date,archivedStartTime:"10:00",horses:hs.map((h,i)=>({...h,positionRaw:String(i+1),raceTimeRaw:null,
 marginRaw:null,final3fRaw:null,cornerPositionsRaw:null,finalOddsRaw:null,popularity:i+1})),
 payouts:Object.fromEntries(["tan","fuku","wide","umaren","umatan","sanfuku","santan"].map(k=>[k,{status:"ok",rawCombination:null,rawPayout:null,
 entries:k==="wide"?[{combo:[1,2],payout:100},{combo:[1,3],payout:100},{combo:[2,3],payout:100}]:[{combo:[1,2,3],payout:100}]}])) as Truth["payouts"]};
 const plans=generate(input)!;
 return {raceId:input.raceId,date:input.date,vh:hs.map(h=>h.horseId),market:input.market.map(h=>h.horseId),truth,plans,settled:settle(plans,truth)};
}
test("numeric top3 is distinct from special or unknown finishes",()=>{
 assert.deepEqual(outcome("1"),{win:1,top3:1,unknown:0});assert.equal(outcome("4").top3,0);
 for(const s of [null,"中止","失格","取消","除外","1(降着)","**"])assert.equal(outcome(s).unknown,1);
});
test("paired race bootstrap deterministic and identical ranks exactly zero",()=>{
 const a=[outcome("1"),outcome("4")];assert.deepEqual(paired(a,a,50).difference.top3.ci,[0,0]);assert.deepEqual(paired(a,a,50),paired(a,a,50));
 assert.throws(()=>paired(a,a.slice(1)));assert.equal(paired([],[],50).difference.top3.ci,null);
});
test("rank slots same/different and frozen tickets preserved",()=>{
 const r=row(),before=JSON.stringify(r),d=diagnose([r],20);assert.equal(d.ranks[0].same,1);
 assert.equal(d.ranks[1].different,1);assert.equal(d.ranks[1].all.left.top3,1);assert.equal(d.ranks[1].all.right.top3,1);
 assert.equal(JSON.stringify(r),before);
});
test("axis failure separated from missing partner coverage",()=>{
 const d=diagnose([row()],20);assert.equal(d.failure.wide.A.success,1);assert.equal(d.failure.sanfuku.A.success,1);
 assert.equal(d.failure.wide.C.axisNotInOfficialCombo,1);assert.equal(d.failure.sanfuku.D.axisNotInOfficialCombo,1);
 const r=row();r.vh=[r.vh[0],r.vh[3],r.vh[4],r.vh[5],r.vh[1],r.vh[2]];
 const hs=r.truth.horses.map(h=>({horseId:h.horseId,horseNumber:h.horseNumber}));
 r.plans=generate({raceId:r.raceId,date:r.date,starters:hs,vh:r.vh.map(id=>hs.find(h=>h.horseId===id)!),market:r.market.map(id=>hs.find(h=>h.horseId===id)!)})!;
 r.settled=settle(r.plans,r.truth);const b=diagnose([r],20);assert.equal(b.failure.wide.A.partnerMissWithEligibleAxis,1);
 assert.equal(b.failure.sanfuku.A.partnerMissWithEligibleAxis,1);
});
test("same-axis exclusion includes other ranking axis as eligible partner",()=>{
 const d=diagnose([row()],20);assert.equal(d.axisConditional[0].races,1);assert.equal(d.axisConditional[1].races,0);
 assert.equal(d.axisConditional[0].partners.length,4);
});
test("duplicate races, ID mismatch and evaluation dates fail closed",()=>{
 const r=row();assert.throws(()=>diagnose([r,r],20));assert.throws(()=>diagnose([{...r,date:"2026-06-27"}],20));
 assert.throws(()=>diagnose([{...r,market:[...r.market.slice(1),r.market[1]]}],20));
});
test("third-place dead heat: two top3 partners do not imply a winning sanfuku",()=>{
 const r=row(),hs=r.truth.horses.map(h=>({horseId:h.horseId,horseNumber:h.horseNumber}));
 r.truth.horses[3].positionRaw="3";
 r.truth.payouts.sanfuku.entries=[{combo:[1,2,3],payout:100},{combo:[1,2,4],payout:200}];
 r.vh=[hs[2],hs[1],hs[3],hs[4],hs[5],hs[0]].map(h=>h.horseId);
 r.plans=generate({raceId:r.raceId,date:r.date,starters:hs,vh:r.vh.map(id=>hs.find(h=>h.horseId===id)!),market:r.market.map(id=>hs.find(h=>h.horseId===id)!)})!;
 r.settled=settle(r.plans,r.truth);const d=diagnose([r],20);
 assert.equal(d.failure.sanfuku.A.selectedPartnerTop3Histogram["axisTop3/2"],1);
 assert.equal(d.failure.sanfuku.A.success,0);assert.equal(d.failure.sanfuku.A.partnerMissWithEligibleAxis,1);
});
