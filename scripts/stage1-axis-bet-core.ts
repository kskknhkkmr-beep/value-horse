/** Fixed retrospective policy. This module never fits or predicts a model. */
import assert from "node:assert/strict";
import { developmentDate,canonical } from "./simulator/canonical";
import { metrics,settleTicket,type Settlement } from "./simulator/settlement";
import type { Ticket,Truth } from "./simulator/types";
export const WAYS=["A","B","C","D"] as const;
export const KINDS=["wide","sanfuku"] as const;
export type Way=typeof WAYS[number];
export type Kind=typeof KINDS[number];
type Horse={horseId:string;horseNumber:number};
export type PlanningInput={raceId:string;date:string;starters:Horse[];vh:Horse[];market:Horse[]};
export type Plan={axis:Horse;partners:Record<Kind,Horse[]>;tickets:Record<Kind,Ticket[]>};
export type Plans=Record<Way,Plan>;
export type Settled={raceId:string;date:string;archivedStartTime:string|null;axisSame:boolean;
 settlements:Record<Kind,Record<Way,Settlement[]>>};
/** Whitelist contract rejects truth/price injections rather than silently consuming them. */
export function generate(input:PlanningInput):Plans|null {
 assert.deepEqual(Object.keys(input).sort(),["date","market","raceId","starters","vh"]);
 developmentDate(input.date);assert(/^\d{12}$/.test(input.raceId));
 const valid=(hs:Horse[])=>{for(const h of hs){assert.deepEqual(Object.keys(h).sort(),["horseId","horseNumber"]);assert(/^\d{10}$/.test(h.horseId));
 assert(Number.isInteger(h.horseNumber)&&h.horseNumber>=1&&h.horseNumber<=18);}
 assert.equal(new Set(hs.map(h=>h.horseId)).size,hs.length);assert.equal(new Set(hs.map(h=>h.horseNumber)).size,hs.length);};
 valid(input.starters);valid(input.vh);valid(input.market);
 const ordered=(hs:Horse[])=>hs.map(h=>[h.horseId,h.horseNumber]).sort();
 assert.deepEqual(ordered(input.starters),ordered(input.vh));assert.deepEqual(ordered(input.starters),ordered(input.market));
 if(input.starters.length<5)return null;
 return Object.fromEntries(WAYS.map(way=>{
  const axis=(way==="A"||way==="B"?input.vh:input.market)[0];
  const order=(way==="A"||way==="C"?input.vh:input.market).filter(h=>h.horseId!==axis.horseId);
  const partners={wide:order.slice(0,3),sanfuku:order.slice(0,4)};
  const ticket=(kind:Kind,others:Horse[]):Ticket=>({kind,stakeYen:1000,horses:[axis,...others].map(h=>h.horseNumber).sort((a,b)=>a-b)});
  const tickets={wide:partners.wide.map(h=>ticket("wide",[h])),
   sanfuku:partners.sanfuku.flatMap((h,i)=>partners.sanfuku.slice(i+1).map(t=>ticket("sanfuku",[h,t])))};
  for(const kind of KINDS){assert.equal(tickets[kind].length,kind==="wide"?3:6);assert.equal(new Set(tickets[kind].map(t=>canonical(t.horses))).size,tickets[kind].length);}
  return [way,{axis,partners,tickets}];
 })) as Plans;
}
export function settle(plans:Plans,truth:Truth):Settled {
 return {raceId:truth.raceId,date:truth.date,archivedStartTime:truth.archivedStartTime,
 axisSame:plans.A.axis.horseId===plans.D.axis.horseId,
 settlements:Object.fromEntries(KINDS.map(k=>[k,Object.fromEntries(WAYS.map(w=>[w,plans[w].tickets[k].map(t=>settleTicket(t,truth))]))])) as Settled["settlements"]};
}
export function exclusion(row:Settled) {
 return KINDS.flatMap(k=>WAYS.flatMap(w=>row.settlements[k][w].filter(s=>s.status==="unresolved"||s.status==="refunded")
 .map(s=>({kind:k,way:w,horses:s.horses,status:s.status,note:s.note}))));
}
function checked(rows:Settled[]) {
 assert.equal(new Set(rows.map(r=>r.raceId)).size,rows.length);
 for(const r of rows){developmentDate(r.date);assert.equal(exclusion(r).length,0);
 for(const k of KINDS)for(const w of WAYS){const ts=r.settlements[k][w];assert.equal(ts.length,k==="wide"?3:6);
 assert.equal(new Set(ts.map(t=>canonical(t.horses))).size,ts.length);for(const t of ts)assert.equal(t.stakeYen,1000);}}
}
export function accounts(rows:Settled[],kind:Kind) {
 checked(rows);
 return Object.fromEntries(WAYS.map(w=>{const {curve:_c,hitIntervals:_i,...account}=metrics(rows.map(r=>({
 raceId:r.raceId,date:r.date,archivedStartTime:r.archivedStartTime,settlements:r.settlements[kind][w]})));
 void _c;void _i;return [w,{...account,below20HitRaces:account.hitRaces<20}]})) as Record<Way,Omit<ReturnType<typeof metrics>,"curve"|"hitIntervals">&{below20HitRaces:boolean}>;
}
const ci=(v:number[])=>{v.sort((a,b)=>a-b);return v.length?[v[Math.floor((v.length-1)*.025)],v[Math.floor((v.length-1)*.975)]]:null};
/** One sampled race vector across all four ways AND both kinds. */
export function uncertainty(rows:Settled[],iterations=10000,seed=20261011) {
 checked(rows);assert(Number.isInteger(iterations)&&iterations>0);
 const cells=KINDS.flatMap(k=>WAYS.map(w=>({kind:k,way:w})));
 const observations=rows.map(r=>cells.map(({kind,way})=>{const ss=r.settlements[kind][way];
 return {hit:Number(ss.some(s=>s.status==="win")),profit:ss.reduce((n,s)=>n+s.profitYen!,0),stake:ss.reduce((n,s)=>n+s.stakeYen,0)};}));
 const allAccounts=Object.fromEntries(KINDS.map(k=>[k,accounts(rows,k)])) as Record<Kind,ReturnType<typeof accounts>>;
 const keys:Record<string,number[]>={};const add=(key:string,n:number)=>{(keys[key]??=[]).push(n);};
 let state=seed>>>0;
 for(let b=0;b<iterations && rows.length;b++){
  const sums=cells.map(()=>({hit:0,profit:0,stake:0}));
  for(let n=0;n<rows.length;n++){state=(Math.imul(state,1664525)+1013904223)>>>0;const obs=observations[Math.floor(state/4294967296*rows.length)];
   obs.forEach((o,i)=>{sums[i].hit+=o.hit;sums[i].profit+=o.profit;sums[i].stake+=o.stake;});}
  for(let ki=0;ki<2;ki++){const k=KINDS[ki],h=sums.slice(ki*4,ki*4+4).map(s=>s.hit/rows.length),r=sums.slice(ki*4,ki*4+4).map(s=>s.profit/s.stake);
   for(const [field,values] of [["hit",h],["roi",r]] as const){
    WAYS.forEach((w,i)=>add(k+"/"+w+"/"+field,values[i]));
    for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)add(k+"/"+WAYS[i]+"-"+WAYS[j]+"/"+field,values[i]-values[j]);
    add(k+"/axis/"+field,((values[0]-values[2])+(values[1]-values[3]))/2);
    add(k+"/partners/"+field,((values[0]-values[1])+(values[2]-values[3]))/2);
    add(k+"/interaction/"+field,values[0]-values[1]-values[2]+values[3]);
   }
  }
 }
 const result=Object.fromEntries(KINDS.map(k=>{const a=allAccounts[k],h=WAYS.map(w=>a[w].raceHitRate??0),r=WAYS.map(w=>a[w].roiNet??0);
 const estimates:Record<string,number>={};
 for(const[field,v]of [["hit",h],["roi",r]]as const){WAYS.forEach((w,i)=>estimates[w+"/"+field]=v[i]);
 for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)estimates[WAYS[i]+"-"+WAYS[j]+"/"+field]=v[i]-v[j];
 estimates["axis/"+field]=((v[0]-v[2])+(v[1]-v[3]))/2;estimates["partners/"+field]=((v[0]-v[1])+(v[2]-v[3]))/2;
 estimates["interaction/"+field]=v[0]-v[1]-v[2]+v[3];}
 return [k,Object.fromEntries(Object.entries(estimates).map(([key,value])=>[key,{estimate:rows.length?value:null,ci:ci(keys[k+"/"+key]??[])}]))]}));
 return {iterations,seed,races:rows.length,results:result};
}
export function report(rows:Settled[]) {
 checked(rows);
 const description=(rs:Settled[])=>Object.fromEntries(KINDS.map(k=>[k,accounts(rs,k)]));
 const sensitivity=Object.fromEntries(KINDS.map(k=>{
 const ranked=rows.map(r=>({raceId:r.raceId,date:r.date,max:Math.max(...WAYS.flatMap(w=>r.settlements[k][w].filter(s=>s.status==="win").map(s=>s.returnYen!)),0)}))
 .filter(r=>r.max>0).sort((a,b)=>b.max-a.max||a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId));
 return [k,[1,2].map(n=>{const removed=ranked.slice(0,n),ids=new Set(removed.map(r=>r.raceId));return {requested:n,removed,results:accounts(rows.filter(r=>!ids.has(r.raceId)),k)};})];}));
 const overlap=Object.fromEntries(KINDS.map(k=>{const tickets=(w:Way)=>new Set(rows.flatMap(r=>r.settlements[k][w].filter(s=>s.status==="win").map(s=>r.raceId+"/"+k+"/"+s.horses.join("-"))));
 return [k,WAYS.flatMap((w,i)=>WAYS.slice(i+1).map(t=>{const a=tickets(w),b=tickets(t),shared=[...a].filter(x=>b.has(x)).length;
 const ra=new Set(rows.filter(r=>r.settlements[k][w].some(s=>s.status==="win")).map(r=>r.raceId)),rb=new Set(rows.filter(r=>r.settlements[k][t].some(s=>s.status==="win")).map(r=>r.raceId));
 return {left:w,right:t,sharedTickets:shared,ticketJaccard:new Set([...a,...b]).size?shared/new Set([...a,...b]).size:null,
 raceJaccard:new Set([...ra,...rb]).size?[...ra].filter(x=>rb.has(x)).length/new Set([...ra,...rb]).size:null};}))];}));
 return {races:rows.length,overall:description(rows),uncertainty:uncertainty(rows),sensitivity,overlap,
 periods:Object.fromEntries(["2026-04","2026-05","2026-06"].map(m=>[m,description(rows.filter(r=>r.date.startsWith(m)))])),
 axisGroups:Object.fromEntries(["same","different"].map(g=>[g,description(rows.filter(r=>r.axisSame===(g==="same")))]))};
}
