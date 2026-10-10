/** Fixed retrospective comparison. Does not fit, tune or choose a model. */
import assert from "node:assert/strict";
import { sha256 } from "./simulator/canonical";
import { metrics,settleTicket,type Settlement } from "./simulator/settlement";
import type { Run } from "./simulator/types";
import { generate } from "./stage1-axis-bet-core";
import { label,bce } from "./stage1-top3";
import type { Forecast } from "./run-stage1-top3";
export const WAYS=["A","B","C","A-market","B-market"] as const;
export const KINDS=["fuku","wide","sanfuku"] as const;
type Way=typeof WAYS[number];type Kind=typeof KINDS[number];
type Horse={horseId:string;horseNumber:number};
type Row={raceId:string;date:string;archivedStartTime:string|null;orders:Record<"A"|"B"|"C",Horse[]>;
 outcomes:Record<"A"|"B"|"C",{raw:string|null;win:number;top3:number}[]>;
 settlements:Record<Kind,Record<Way,Settlement[]>>};
function account(rows:Row[],kind:Kind,way:Way){const {curve,hitIntervals,...a}=metrics(rows.map(r=>({raceId:r.raceId,date:r.date,
 archivedStartTime:r.archivedStartTime,settlements:r.settlements[kind][way]})));void curve;void hitIntervals;return {...a,below20Hits:a.hitRaces<20};}
export function describe(rows:Row[]){return {races:rows.length,
 ranks:Object.fromEntries(["A","B","C"].map(w=>[w,[0,1,2,3,4].map(i=>{
  const v=rows.map(r=>r.outcomes[w as "A"][i]);return {rank:i+1,wins:v.reduce((n,p)=>n+p.win,0),
   winRate:rows.length?v.reduce((n,p)=>n+p.win,0)/rows.length:null,top3:v.reduce((n,p)=>n+p.top3,0),
   top3Rate:rows.length?v.reduce((n,p)=>n+p.top3,0)/rows.length:null,
   nonNumeric:v.filter(p=>!p.raw||!/^\d+$/.test(p.raw)).length};})])),
 bets:Object.fromEntries(KINDS.map(k=>[k,Object.fromEntries(WAYS.map(w=>[w,account(rows,k,w)]))]))};}
const percentile=(v:number[])=>{v.sort((a,b)=>a-b);return [v[Math.floor((v.length-1)*.025)],v[Math.floor((v.length-1)*.975)]];};
/** One paired sampled race vector for all rate/ROI comparisons, including partner controls. */
export function intervals(rows:Row[],iterations=10000,seed=20261011){
 const cols:Record<string,number[]>={};
 for(const pair of [["B","A"],["B","C"],["A","C"]]as const){const [a,b]=pair;
  for(let i=0;i<5;i++)for(const field of ["win","top3"]as const)cols[`${a}-${b}/rank${i+1}/${field}`]=rows.map(r=>r.outcomes[a][i][field]-r.outcomes[b][i][field]);}
 for(const k of KINDS)for(const pair of [["B","A"],["B","C"],["A","C"],["B-market","A-market"],["B-market","C"],["A-market","C"]]as const){
  const [a,b]=pair;cols[`${a}-${b}/${k}/ROI`]=rows.map(r=>{const roi=(w:Way)=>r.settlements[k][w].reduce((n,s)=>n+s.profitYen!,0)/r.settlements[k][w].reduce((n,s)=>n+s.stakeYen,0);return roi(a)-roi(b);});}
 const names=Object.keys(cols),vectors=rows.map((_,i)=>names.map(k=>cols[k][i])),samples=names.map(()=>[]as number[]);
 let state=seed>>>0;for(let b=0;b<iterations;b++){const sums=names.map(()=>0);for(let i=0;i<rows.length;i++){
  state=(Math.imul(state,1664525)+1013904223)>>>0;const v=vectors[Math.floor(state/4294967296*rows.length)];v.forEach((x,j)=>sums[j]+=x);}
  sums.forEach((v,j)=>samples[j].push(v/rows.length));}
 return {iterations,seed,races:rows.length,results:Object.fromEntries(names.map((k,i)=>[k,{estimate:cols[k].reduce((a,b)=>a+b,0)/rows.length,ci95:percentile(samples[i])}]))};
}
export function evaluate(forecasts:Forecast[],records:Run["records"],savePlans?:(plans:unknown)=>void){
 assert.equal(forecasts.length,records.length);assert.equal(new Set(forecasts.map(r=>r.raceId)).size,forecasts.length);
 const predictions=new Map(forecasts.map(r=>[r.raceId,r]));
 // Plan all races before any payout is passed to settlement. Market is explicitly retrospective.
 const planned=records.map(r=>{const f=predictions.get(r.raceId);assert(f&&f.date===r.date);
  const orders={A:r.predictions.map(p=>({horseId:p.horseId,horseNumber:p.horseNumber})),
   B:f.predictions.map(p=>({horseId:p.horseId,horseNumber:p.horseNumber})),
   C:[...r.starters].sort((a,b)=>{const popularity=(h:Horse)=>{const p=r.actual.horses.find(t=>t.horseId===h.horseId)?.popularity;assert(p&&p>0);return p;};
    return popularity(a)-popularity(b)||a.horseNumber-b.horseNumber;}).map(h=>({horseId:h.horseId,horseNumber:h.horseNumber}))};
  const starters=r.starters.map(h=>({horseId:h.horseId,horseNumber:h.horseNumber}));
  const a=generate({raceId:r.raceId,date:r.date,starters,vh:orders.A,market:orders.C}),b=generate({raceId:r.raceId,date:r.date,starters,vh:orders.B,market:orders.C});assert(a&&b);
  assert.deepEqual(f.predictions.map(p=>p.rank),f.predictions.map((_,i)=>i+1));
  for(const p of f.predictions){assert.equal(p.probabilityEvent,"top3");assert.equal(p.calibrationStatus,"uncalibrated");
   assert(Math.abs(p.rawLogit-p.intercept-p.reasons.reduce((n,x)=>n+x.contribution,0))<1e-10);}
  const plans={A:a.A,B:b.A,C:a.D,"A-market":a.B,"B-market":b.B};
  return {raceId:r.raceId,date:r.date,orders,plans};});
 savePlans?.(planned);
 const rows:Row[]=planned.map((p,i)=>{const r=records[i];assert.equal(p.raceId,r.raceId);
  const outcomes=Object.fromEntries((["A","B","C"]as const).map(w=>[w,p.orders[w].map(h=>{const t=r.actual.horses.find(t=>t.horseId===h.horseId);assert(t&&t.horseNumber===h.horseNumber);
   return {raw:t.positionRaw,win:Number(t.positionRaw==="1"),top3:label(t.positionRaw,r.starters.length)};})])) as Row["outcomes"];
  const settlements=Object.fromEntries(KINDS.map(k=>[k,Object.fromEntries(WAYS.map(w=>[w,(k==="fuku"?[{kind:k,stakeYen:1000,horses:[p.plans[w].axis.horseNumber]}]:p.plans[w].tickets[k]).map(t=>settleTicket(t,r.actual))]))])) as Row["settlements"];
  for(const k of KINDS)for(const w of WAYS)for(const s of settlements[k][w])assert(["win","loss"].includes(s.status),"Unresolved/refunded ticket: stop, no silent cohort change");
  return {raceId:r.raceId,date:r.date,archivedStartTime:r.actual.archivedStartTime,orders:p.orders,outcomes,settlements};});
 const pairs=([["B","A"],["B","C"],["A","C"]]as const).map(([a,b])=>{
  const same=rows.filter(r=>r.orders[a][0].horseId===r.orders[b][0].horseId),different=rows.filter(r=>r.orders[a][0].horseId!==r.orders[b][0].horseId);
  const hit=(w:"A"|"B"|"C")=>new Set(rows.filter(r=>r.outcomes[w][0].top3).map(r=>r.raceId));const x=hit(a),y=hit(b),union=new Set([...x,...y]);
  return {pair:a+"-"+b,same:same.length,different:different.length,leftOnly:rows.filter(r=>r.outcomes[a][0].top3&&!r.outcomes[b][0].top3).length,
   rightOnly:rows.filter(r=>!r.outcomes[a][0].top3&&r.outcomes[b][0].top3).length,hitRaceJaccard:[...x].filter(id=>y.has(id)).length/union.size,
   sameResults:describe(same),differentResults:describe(different)};});
 const sensitivity=Object.fromEntries(KINDS.map(k=>{const ranked=rows.map(r=>({raceId:r.raceId,date:r.date,max:Math.max(0,...WAYS.flatMap(w=>r.settlements[k][w].map(s=>s.returnYen!)))}))
  .filter(r=>r.max>0).sort((a,b)=>b.max-a.max||a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId));
  return [k,[1,2].map(n=>{const removed=ranked.slice(0,n),ids=new Set(removed.map(r=>r.raceId));return {removed,results:describe(rows.filter(r=>!ids.has(r.raceId)))};})];}));
 const probabilityRows=records.map(r=>{const f=predictions.get(r.raceId)!;let squared=0,logLoss=0;
  for(const p of f.predictions){const y=label(r.actual.horses.find(h=>h.horseId===p.horseId)!.positionRaw,r.starters.length);
   squared+=(p.rawTop3Probability-y)**2;logLoss+=bce(p.rawLogit,y);}
  const chosen=f.predictions[0],y=label(r.actual.horses.find(h=>h.horseId===chosen.horseId)!.positionRaw,r.starters.length);
  return {raceId:r.raceId,fieldSize:r.starters.length,sumQ:f.predictions.reduce((n,p)=>n+p.rawTop3Probability,0),
   brier:squared/r.starters.length,logLoss:logLoss/r.starters.length,axisBrier:(chosen.rawTop3Probability-y)**2,axisLogLoss:bce(chosen.rawLogit,y)};});
 const mean=(vs:number[])=>vs.length?vs.reduce((a,b)=>a+b,0)/vs.length:null;
 const quality=(rs:typeof probabilityRows)=>({races:rs.length,brier:mean(rs.map(r=>r.brier)),logLoss:mean(rs.map(r=>r.logLoss)),
  axisBrier:mean(rs.map(r=>r.axisBrier)),axisLogLoss:mean(rs.map(r=>r.axisLogLoss)),meanSumQ:mean(rs.map(r=>r.sumQ)),
  minSumQ:rs.length?Math.min(...rs.map(r=>r.sumQ)):null,maxSumQ:rs.length?Math.max(...rs.map(r=>r.sumQ)):null});
 const bins=Array.from({length:10},(_,i)=>{let mass=0,sumP=0,sumY=0;
  for(const r of records)for(const p of predictions.get(r.raceId)!.predictions)if(Math.min(9,Math.floor(p.rawTop3Probability*10))===i){
   const w=1/r.starters.length;mass+=w;sumP+=p.rawTop3Probability*w;sumY+=label(r.actual.horses.find(h=>h.horseId===p.horseId)!.positionRaw,r.starters.length)*w;}
  return {lower:i/10,upper:(i+1)/10,raceWeightedMass:mass,meanProbability:mass?sumP/mass:null,observedRate:mass?sumY/mass:null};});
 return {cohortSha256:sha256(rows.map(r=>r.raceId).sort()),predictionSha256:sha256(forecasts),overall:describe(rows),ci:intervals(rows),pairs,sensitivity,
  periods:Object.fromEntries(["2026-04","2026-05","2026-06"].map(m=>[m,describe(rows.filter(r=>r.date.startsWith(m)))])),
  quality:{overall:quality(probabilityRows),fieldGroups:[[5,7],[8,11],[12,18]].map(([a,b])=>({bounds:[a,b],...quality(probabilityRows.filter(r=>r.fieldSize>=a&&r.fieldSize<=b))})),bins},
  samples:["2026-04","2026-05","2026-06"].map(m=>rows.find(r=>r.date.startsWith(m))),rows};
}
