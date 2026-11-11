/** Saved-ranking diagnosis only. Planning has no outcome, price, model or filesystem input. */
import assert from "node:assert/strict";
import { generate,type Plan,type PlanningInput } from "./stage1-axis-bet-core";
import { metrics,settleTicket,type Settlement } from "./simulator/settlement";
import { developmentDate,sha256 } from "./simulator/canonical";
import type { Truth } from "./simulator/types";
export const WAYS=["A","B","C","D","E"] as const;
export const KINDS=["wide","sanfuku"] as const;
export type Way=typeof WAYS[number];export type Kind=typeof KINDS[number];
export type Plans=Record<Way,Plan>;
export type Row={raceId:string;date:string;truth:Truth;vh:PlanningInput["vh"];market:PlanningInput["market"];plans:Plans;
 settlements:Record<Kind,Record<Way,Settlement[]>>};
export function plan(input:PlanningInput):Plans {
 const base=generate(input);assert(base,"Need at least five starters; never reduce tickets");
 const axis=input.vh[0],market=input.market.filter(h=>h.horseId!==axis.horseId);
 const mixed=(count:number)=>{const first=market.slice(0,count),ids=new Set([axis.horseId,...first.map(h=>h.horseId)]);
  const rest=input.vh.filter(h=>!ids.has(h.horseId));const order=[axis,...first,...rest];
  return generate({...input,vh:order})!.A;};
 return {A:base.A,B:base.B,C:mixed(3),D:mixed(2),E:base.D};
}
const top3=(raw:string|null)=>!!raw&&/^[1-9]\d*$/.test(raw)&&Number(raw)<=3;
const outcome=(r:Row,id:string)=>{const h=r.truth.horses.find(h=>h.horseId===id);assert(h);return h;};
const axisGood=(r:Row,w:Way)=>top3(outcome(r,r.plans[w].axis.horseId).positionRaw);
const hit=(r:Row,k:Kind,w:Way)=>r.settlements[k][w].some(s=>s.status==="win");
export function checked(rows:Row[]){
 assert(rows.length);assert.equal(new Set(rows.map(r=>r.raceId)).size,rows.length);
 for(const r of rows){developmentDate(r.date);assert.equal(r.truth.date,r.date);assert.equal(r.truth.raceId,r.raceId);
  const expected=plan({raceId:r.raceId,date:r.date,starters:r.vh,vh:r.vh,market:r.market});assert.deepEqual(r.plans,expected);
  for(const h of r.vh){const t=outcome(r,h.horseId);assert.equal(t.horseNumber,h.horseNumber);}
  for(const k of KINDS)for(const w of WAYS){assert.deepEqual(r.settlements[k][w],r.plans[w].tickets[k].map(t=>settleTicket(t,r.truth)));
   assert(r.settlements[k][w].every(s=>s.status==="win"||s.status==="loss"),"No silent refund/missing exclusion");}
 }
}
export function accounts(rows:Row[],k:Kind,w:Way){
 const {curve,hitIntervals,...a}=metrics(rows.map(r=>({raceId:r.raceId,date:r.date,archivedStartTime:r.truth.archivedStartTime,settlements:r.settlements[k][w]})));
 void curve;void hitIntervals;return {...a,below20Hits:a.hitRaces<20};
}
/** A/B/E use frozen settlements; only mixed new coupons require settlement. */
export function join(r:Omit<Row,"plans"|"settlements">,saved:Record<Kind,Record<"A"|"B"|"E",Settlement[]>>):Row{
 const plans=plan({raceId:r.raceId,date:r.date,starters:r.vh,vh:r.vh,market:r.market});
 const settlements=Object.fromEntries(KINDS.map(k=>[k,Object.fromEntries(WAYS.map(w=>[w,w==="A"||w==="B"||w==="E"?saved[k][w]:
  k==="wide"&&w==="C"?saved[k].B:plans[w].tickets[k].map(t=>settleTicket(t,r.truth))]))])) as Row["settlements"];
 const row={...r,plans,settlements};checked([row]);return row;
}
export function responsibility(rows:Row[],k:Kind,w:Way){
 const counts={races:rows.length,axisNotTop3:0,axisSpecial:0,top3ButNotOfficial:0,partnerFailure:0,success:0,axisTop3:0,
  hitWithTop3Axis:0,officialWithoutTop3:0,capturedOfficialPartners:0,availableOfficialPartners:0};
 for(const r of rows){const good=axisGood(r,w),won=hit(r,k,w),axis=r.plans[w].axis;
  const raw=outcome(r,axis.horseId).positionRaw;if(!raw||!/^\d+$/.test(raw))counts.axisSpecial++;
  const combos=r.truth.payouts[k].entries.filter(e=>e.combo?.includes(axis.horseNumber));assert(r.truth.payouts[k].status==="ok");
  if(won)assert(combos.length>0);if(!good){assert(!won,"Official winner conflicts with non-Top3 axis");counts.axisNotTop3++;}
  else {counts.axisTop3++;if(won){counts.success++;counts.hitWithTop3Axis++;}else if(!combos.length)counts.top3ButNotOfficial++;else counts.partnerFailure++;
   if(k==="wide") {const possible=new Set(combos.flatMap(e=>e.combo!.filter(n=>n!==axis.horseNumber)));
    counts.availableOfficialPartners+=possible.size;counts.capturedOfficialPartners+=r.plans[w].partners[k].filter(h=>possible.has(h.horseNumber)).length;
   }else {counts.availableOfficialPartners+=combos.length;
    counts.capturedOfficialPartners+=combos.filter(e=>e.combo!.filter(n=>n!==axis.horseNumber).every(n=>r.plans[w].partners[k].some(h=>h.horseNumber===n))).length;}
  }
  if(combos.length&&!good)counts.officialWithoutTop3++;
 }
 assert.equal(counts.axisNotTop3+counts.top3ButNotOfficial+counts.partnerFailure+counts.success,rows.length);
 return {...counts,conditionalHitRate:counts.axisTop3?counts.hitWithTop3Axis/counts.axisTop3:null,
  officialCaptureRate:counts.availableOfficialPartners?counts.capturedOfficialPartners/counts.availableOfficialPartners:null};
}
export function omissions(rows:Row[]){return Array.from({length:5},(_,i)=>{
 const excluded=rows.filter(r=>!r.vh.slice(0,5).some(h=>h.horseId===r.market[i].horseId));
 const good=rows.filter(r=>axisGood(r,"A")),notAxis=good.filter(r=>r.market[i].horseId!==r.vh[0].horseId);
 const missing=(rs:Row[])=>rs.filter(r=>!r.vh.slice(0,5).some(h=>h.horseId===r.market[i].horseId)).length;
 const finishes=[1,2,3].map(n=>excluded.filter(r=>outcome(r,r.market[i].horseId).positionRaw===String(n)).length);
 const n=excluded.length;return {marketRank:i+1,races:rows.length,included:rows.length-n,includedRate:(rows.length-n)/rows.length,
  excluded:n,excludedRate:n/rows.length,finishes,top3:finishes.reduce((a,b)=>a+b,0),excludedTop3Rate:n?finishes.reduce((a,b)=>a+b,0)/n:null,
  special:excluded.filter(r=>!/^\d+$/.test(outcome(r,r.market[i].horseId).positionRaw??"")).length,
  axisTop3Races:good.length,axisTop3Excluded:missing(good),axisTop3ExcludedRate:good.length?missing(good)/good.length:null,
  axisTop3NotSameAxisRaces:notAxis.length,axisTop3NotSameAxisExcludedRate:notAxis.length?missing(notAxis)/notAxis.length:null};
 });}
export function bootstrap(rows:Row[],iterations=10000,seed=20261111){
 assert(rows.length&&Number.isInteger(iterations)&&iterations>0);
 const observations=rows.map(r=>({good:WAYS.map(w=>Number(axisGood(r,w))),hit:KINDS.flatMap(k=>WAYS.map(w=>Number(hit(r,k,w)))),
  roi:KINDS.flatMap(k=>WAYS.map(w=>{const ts=r.settlements[k][w];return ts.reduce((s,t)=>s+t.profitYen!,0)/ts.reduce((s,t)=>s+t.stakeYen,0);} ))}));
 const names:string[]=[],samples:Record<string,number[]>={},estimates:Record<string,number|null>={};
 for(const k of KINDS)for(let a=0;a<WAYS.length;a++)for(let b=a+1;b<WAYS.length;b++)
  for(const field of (b<4?["hit","ROI","conditionalHit"]:["hit","ROI"])) {const key=`${k}/${WAYS[a]}-${WAYS[b]}/${field}`;names.push(key);samples[key]=[];}
 const collect=(indices:number[])=>{const hits=Array(10).fill(0),roi=Array(10).fill(0),good=Array(5).fill(0);
  for(const i of indices){const o=observations[i];o.hit.forEach((v,j)=>hits[j]+=v);o.roi.forEach((v,j)=>roi[j]+=v);o.good.forEach((v,j)=>good[j]+=v);}
  return names.map(key=>{const [kind,pair,field]=key.split("/"),[a,b]=pair.split("-").map(w=>WAYS.indexOf(w as Way)),offset=kind==="wide"?0:5;
   return field==="conditionalHit"?(good[a]&&good[b]?hits[offset+a]/good[a]-hits[offset+b]/good[b]:null):
    ((field==="hit"?hits:roi)[offset+a]-(field==="hit"?hits:roi)[offset+b])/indices.length;});};
 collect(rows.map((_,i)=>i)).forEach((v,i)=>estimates[names[i]]=v);let state=seed>>>0;
 for(let b=0;b<iterations;b++){const ix=rows.map(()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return Math.floor(state/4294967296*rows.length);});
  collect(ix).forEach((v,i)=>{if(v!==null)samples[names[i]].push(v);});}
 return {iterations,seed,races:rows.length,results:Object.fromEntries(names.map(key=>{const s=samples[key].sort((a,b)=>a-b);
  return [key,{estimate:estimates[key],validSamples:s.length,ci95:s.length?[s[Math.floor((s.length-1)*.025)],s[Math.floor((s.length-1)*.975)]]:null}];}))};
}
function detail(r:Row){return {raceId:r.raceId,date:r.date,axis:{...r.plans.A.axis,...outcome(r,r.plans.A.axis.horseId)},
 horses:r.vh.map((h,i)=>({...h,...outcome(r,h.horseId),vhRank:i+1,marketSlot:r.market.findIndex(m=>m.horseId===h.horseId)+1})),
 plans:r.plans,settlements:r.settlements};}
export function diagnose(rows:Row[],iterations=10000){checked(rows);
 const overall=(rs:Row[])=>Object.fromEntries(KINDS.map(k=>[k,Object.fromEntries(WAYS.map(w=>[w,accounts(rs,k,w)]))]));
 const failure=Object.fromEntries(KINDS.map(k=>[k,Object.fromEntries(WAYS.map(w=>[w,responsibility(rows,k,w)]))]));
 const ordered=[...rows].sort((a,b)=>a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId));
 const marketHelps=(r:Row)=>axisGood(r,"A")&&KINDS.some(k=>!hit(r,k,"A")&&hit(r,k,"B")&&r.settlements[k].B.some(t=>t.status==="win"&&t.horses.some(n=>
  n!==r.plans.A.axis.horseNumber&&r.market.slice(0,5).some(h=>h.horseNumber===n)&&!r.plans.A.partners[k].some(h=>h.horseNumber===n))));
 const vhHelps=(r:Row)=>axisGood(r,"A")&&KINDS.some(k=>hit(r,k,"A")&&!hit(r,k,"B"));
 const sensitivity=Object.fromEntries(KINDS.map(k=>{const sorted=rows.map(r=>({raceId:r.raceId,date:r.date,max:Math.max(0,...WAYS.flatMap(w=>r.settlements[k][w].map(t=>t.returnYen!)))}))
  .filter(r=>r.max>0).sort((a,b)=>b.max-a.max||a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId));
  return [k,[1,2].map(n=>{const removed=sorted.slice(0,n),ids=new Set(removed.map(r=>r.raceId));return {removed,results:overall(rows.filter(r=>!ids.has(r.raceId)))[k]};})];}));
 const overlap=Object.fromEntries(KINDS.map(k=>[k,WAYS.flatMap((w,i)=>WAYS.slice(i+1).map(v=>{
  const a=new Set(rows.filter(r=>hit(r,k,w)).map(r=>r.raceId)),b=new Set(rows.filter(r=>hit(r,k,v)).map(r=>r.raceId)),union=new Set([...a,...b]);
  return {pair:w+"-"+v,leftOnly:[...a].filter(x=>!b.has(x)).length,rightOnly:[...b].filter(x=>!a.has(x)).length,
   hitJaccard:union.size?[...a].filter(x=>b.has(x)).length/union.size:null};}))]));
 return {races:rows.length,cohortHash:sha256(rows.map(r=>r.raceId)),omissions:omissions(rows),overall:overall(rows),failure,
  intervals:bootstrap(rows,iterations),sensitivity,overlap,cases:{marketHelpsCount:rows.filter(marketHelps).length,vhHelpsCount:rows.filter(vhHelps).length,
   marketHelps:ordered.filter(marketHelps).slice(0,10).map(detail),vhHelps:ordered.filter(vhHelps).slice(0,10).map(detail)}};
}
