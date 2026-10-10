/** Immutable saved-ranking diagnosis; never fits, predicts, or selects a buying rule. */
import assert from "node:assert/strict";
import { developmentDate } from "./simulator/canonical";
import type { Truth } from "./simulator/types";
import { WAYS,KINDS,type Plans,type Settled } from "./stage1-axis-bet-core";
export type RankingRow={raceId:string;date:string;vh:string[];market:string[];truth:Truth;plans:Plans;settled:Settled};
export function outcome(raw:string|null):{win:number;top3:number;unknown:number} {
 if(raw&&/^[1-9]\d*$/.test(raw))return {win:Number(raw==="1"),top3:Number(Number(raw)<=3),unknown:0};
 // Unknown/special finishes remain in the intention-to-select denominator, never fabricated as 4+.
 return {win:0,top3:0,unknown:1};
}
type Observation={win:number;top3:number;unknown:number};
export function paired(left:Observation[],right:Observation[],iterations=10000,seed=20261011) {
 assert.equal(left.length,right.length);assert(Number.isInteger(iterations)&&iterations>0);
 const n=left.length,describe=(rs:Observation[])=>({races:n,wins:rs.reduce((s,r)=>s+r.win,0),top3:rs.reduce((s,r)=>s+r.top3,0),
 unknown:rs.reduce((s,r)=>s+r.unknown,0),winRate:n?rs.reduce((s,r)=>s+r.win,0)/n:null,top3Rate:n?rs.reduce((s,r)=>s+r.top3,0)/n:null});
 const diffs=left.map((r,i)=>({win:r.win-right[i].win,top3:r.top3-right[i].top3}));
 const values:{win:number[];top3:number[]}={win:[],top3:[]};let state=seed>>>0;
 for(let b=0;b<iterations&&n;b++){let win=0,top3=0;for(let j=0;j<n;j++){
 state=(Math.imul(state,1664525)+1013904223)>>>0;const d=diffs[Math.floor(state/4294967296*n)];win+=d.win;top3+=d.top3;}
 values.win.push(win/n);values.top3.push(top3/n);}
 return {left:describe(left),right:describe(right),difference:Object.fromEntries((["win","top3"] as const).map(k=>{
 const a=values[k].sort((a,b)=>a-b);return [k,{estimate:n?diffs.reduce((s,r)=>s+r[k],0)/n:null,
 ci:a.length?[a[Math.floor((a.length-1)*.025)],a[Math.floor((a.length-1)*.975)]]:null}];})),iterations,seed};
}
export function diagnose(rows:RankingRow[],iterations=10000) {
 assert.equal(new Set(rows.map(r=>r.raceId)).size,rows.length);
 for(const r of rows){developmentDate(r.date);assert.equal(r.truth.raceId,r.raceId);assert.equal(r.settled.raceId,r.raceId);
 assert.equal(r.truth.date,r.date);assert.equal(r.settled.date,r.date);assert(r.vh.length>=5);
 assert.equal(new Set(r.vh).size,r.vh.length);assert.equal(new Set(r.market).size,r.market.length);
 assert.deepEqual([...r.vh].sort(),[...r.market].sort());
 for(const id of r.vh)assert.equal(r.truth.horses.filter(h=>h.horseId===id).length,1);}
 const obs=(r:RankingRow,id:string)=>outcome(r.truth.horses.find(h=>h.horseId===id)!.positionRaw);
 const rankComparison=(rs:RankingRow[],i:number)=>paired(rs.map(r=>obs(r,r.vh[i])),rs.map(r=>obs(r,r.market[i])),iterations);
 const ranks=Array.from({length:4},(_,j)=>{const i=j+1,same=rows.filter(r=>r.vh[i]===r.market[i]),different=rows.filter(r=>r.vh[i]!==r.market[i]);
 return {rank:i+1,same:same.length,different:different.length,all:rankComparison(rows,i),sameComparison:rankComparison(same,i),differentComparison:rankComparison(different,i)};});
 const matrix=Array.from({length:5},(_,i)=>({vhRank:i+1,marketRanks:Object.fromEntries(Array.from({length:18},(_,j)=>[j+1,rows.filter(r=>r.market.indexOf(r.vh[i])===j).length]))}));
 const undervalued=Array.from({length:4},(_,j)=>{const rank=j+2,selected=rows.filter(r=>r.vh.indexOf(r.market[rank-1])>=5);
 return {marketRank:rank,races:selected.length,belowVhTop5:selected.length,
 wins:selected.reduce((s,r)=>s+obs(r,r.market[rank-1]).win,0),top3:selected.reduce((s,r)=>s+obs(r,r.market[rank-1]).top3,0),
 unknown:selected.reduce((s,r)=>s+obs(r,r.market[rank-1]).unknown,0),
 examples:selected.slice(0,3).map(r=>({raceId:r.raceId,date:r.date,horseId:r.market[rank-1],vhRank:r.vh.indexOf(r.market[rank-1])+1,positionRaw:r.truth.horses.find(h=>h.horseId===r.market[rank-1])!.positionRaw}))};});
 const axisConditional=(["vh","market"]as const).map(source=>{const selected=rows.filter(r=>obs(r,r[source][0]).top3===1);
 return {axis:source,races:selected.length,partners:Array.from({length:4},(_,i)=>({slot:i+1,comparison:paired(
 selected.map(r=>obs(r,r.vh.filter(id=>id!==r[source][0])[i])),selected.map(r=>obs(r,r.market.filter(id=>id!==r[source][0])[i])),iterations)})),
 kinds:Object.fromEntries(KINDS.map(k=>{const a=source==="vh"?"A":"C",b=source==="vh"?"B":"D";
 return [k,{vhWay:a,marketWay:b,comparison:paired(selected.map(r=>({win:Number(r.settled.settlements[k][a].some(t=>t.status==="win")),top3:Number(r.settled.settlements[k][a].some(t=>t.status==="win")),unknown:0})),
 selected.map(r=>({win:Number(r.settled.settlements[k][b].some(t=>t.status==="win")),top3:Number(r.settled.settlements[k][b].some(t=>t.status==="win")),unknown:0})),iterations)}];}))};});
 const failure=Object.fromEntries(KINDS.map(k=>[k,Object.fromEntries(WAYS.map(w=>{
 const counts={success:0,axisNotInOfficialCombo:0,partnerMissWithEligibleAxis:0,axisTop3:0,hitWithTop3Axis:0,
 top3AxisButNoHit:0,axisTop3Unknown:0,officialAxisButNotNumericTop3:0,selectedPartnerTop3Histogram:{} as Record<string,number>};
 for(const r of rows){const plan=r.plans[w],a=obs(r,plan.axis.horseId),hit=r.settled.settlements[k][w].some(t=>t.status==="win"),
 eligible=r.truth.payouts[k].entries.some(e=>e.combo?.includes(plan.axis.horseNumber));
 assert(r.truth.payouts[k].status==="ok");assert(!hit||eligible);
 if(hit)counts.success++;else if(!eligible)counts.axisNotInOfficialCombo++;else counts.partnerMissWithEligibleAxis++;
 counts.axisTop3+=a.top3;counts.axisTop3Unknown+=a.unknown;
 if(a.top3){if(hit)counts.hitWithTop3Axis++;else counts.top3AxisButNoHit++;}
 if(eligible&&!a.top3)counts.officialAxisButNotNumericTop3++;
 const n=plan.partners[k].reduce((s,h)=>s+obs(r,h.horseId).top3,0);const key=(a.top3?"axisTop3/":"axisNotTop3/")+n;
 counts.selectedPartnerTop3Histogram[key]=(counts.selectedPartnerTop3Histogram[key]??0)+1;
 }return [w,counts];}))]));
 const top5={vh:rows.reduce((s,r)=>s+r.vh.slice(0,5).reduce((n,id)=>n+obs(r,id).top3,0),0),
 market:rows.reduce((s,r)=>s+r.market.slice(0,5).reduce((n,id)=>n+obs(r,id).top3,0),0),selections:rows.length*5};
 return {races:rows.length,ranks,matrix,undervalued,axisConditional,failure,top5};
}
