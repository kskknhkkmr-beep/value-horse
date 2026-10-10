/** Evaluation of immutable saved picks only: no fitting or selection policy. */
import { metrics, type Settlement } from "./simulator/settlement";
export const KEYS = ["A","B","C"] as const;
export type Key = typeof KEYS[number];
export type Pick = { horseId:string; horseNumber:number; positionRaw:string|null; popularity:number|null;
 tan:Settlement; fuku:Settlement };
export type Row = {raceId:string;date:string;archivedStartTime:string|null;picks:Partial<Record<Key,Pick>>};
export function finish(raw:string|null) {
 if (raw && /^[1-9]\d*$/.test(raw)) return Number(raw)<=3 ? raw : "4+";
 if (/^取/.test(raw??"")) return "cancelled";
 if (/^除/.test(raw??"")) return "excluded";
 return "unknown";
}
export const top3=(p:Pick)=>["1","2","3"].includes(finish(p.positionRaw));
const risk=(s:Settlement)=>s.status==="refunded"?0:s.stakeYen;
function checked(rows:Row[],keys:readonly Key[]) {
 if(new Set(rows.map(r=>r.raceId)).size!==rows.length) throw new Error("Duplicate race");
 for(const r of rows) for(const k of keys) if(!r.picks[k]) throw new Error("Unpaired cohort");
}
export function account(rows:Row[],key:Key,kind:"tan"|"fuku") {
 checked(rows,[key]);
 const {curve:_curve,hitIntervals:_intervals,...result}=metrics(rows.map(r=>({
 raceId:r.raceId,date:r.date,archivedStartTime:r.archivedStartTime,settlements:[r.picks[key]![kind]]})));
 void _curve;void _intervals;return result;
}
export function describe(rows:Row[],key:Key) {
 checked(rows,[key]);
 const counts=Object.fromEntries(["1","2","3","4+","cancelled","excluded","unknown"].map(k=>[k,rows.filter(r=>finish(r.picks[key]!.positionRaw)===k).length]));
 const count=rows.filter(r=>top3(r.picks[key]!)).length;
 return {races:rows.length,finish:counts,rates:Object.fromEntries(Object.entries(counts).map(([k,n])=>[k,rows.length?n/rows.length:null])),
 top3:count,top3Rate:rows.length?count/rows.length:null,
 popularity:Object.fromEntries(Array.from({length:18},(_,i)=>[i+1,rows.filter(r=>r.picks[key]!.popularity===i+1).length])),
 missingPopularity:rows.filter(r=>r.picks[key]!.popularity===null).length,
 fuku:account(rows,key,"fuku"),tan:account(rows,key,"tan")};
}
export function pair(rows:Row[],left:Key,right:Key,iterations=10000,seed=20261011) {
 checked(rows,[left,right]);
 if(!rows.length) return null;
 if(rows.some(r=>[left,right].some(k=>r.picks[k]!.fuku.status==="unresolved"))) throw new Error("Unresolved payout");
 const diffs=rows.map(r=>Number(top3(r.picks[left]!))-Number(top3(r.picks[right]!)));
 let state=seed>>>0;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296};
 const rates:number[]=[],rois:number[]=[];
 for(let b=0;b<iterations;b++) {
  let rate=0,lp=0,rp=0,ls=0,rs=0;
  for(let i=0;i<rows.length;i++){const ix=Math.floor(random()*rows.length),r=rows[ix];rate+=diffs[ix];
   const l=r.picks[left]!.fuku,t=r.picks[right]!.fuku;lp+=l.profitYen!;rp+=t.profitYen!;ls+=risk(l);rs+=risk(t);}
  rates.push(rate/rows.length);if(ls && rs)rois.push(lp/ls-rp/rs);
 }
 const ci=(values:number[])=>{values.sort((a,b)=>a-b);return values.length?[values[Math.floor((values.length-1)*.025)],values[Math.floor((values.length-1)*.975)]]:null};
 const laccount=account(rows,left,"fuku"),raccount=account(rows,right,"fuku");
 const tickets=(key:Key)=>new Set(rows.filter(r=>r.picks[key]!.fuku.status==="win").map(r=>r.raceId+"/"+r.picks[key]!.horseNumber));
 const l=tickets(left),r=tickets(right),shared=[...l].filter(t=>r.has(t)).length;
 const l3=rows.filter(r=>top3(r.picks[left]!)),r3=rows.filter(r=>top3(r.picks[right]!));
 return {left,right,races:rows.length,same:rows.filter(r=>r.picks[left]!.horseId===r.picks[right]!.horseId).length,
 different:rows.filter(r=>r.picks[left]!.horseId!==r.picks[right]!.horseId).length,
 leftOnlyTop3:l3.filter(r=>!top3(r.picks[right]!)).length,rightOnlyTop3:r3.filter(r=>!top3(r.picks[left]!)).length,
 bothTop3:l3.filter(r=>top3(r.picks[right]!)).length,
 both4Plus:rows.filter(r=>finish(r.picks[left]!.positionRaw)==="4+" && finish(r.picks[right]!.positionRaw)==="4+").length,
 specialEither:rows.filter(r=>[left,right].some(k=>["unknown","cancelled","excluded"].includes(finish(r.picks[k]!.positionRaw)))).length,
 top3Difference:diffs.reduce((s,n)=>s+n,0)/rows.length,top3CI:ci(rates),
 roiDifference:laccount.roiNet===null||raccount.roiNet===null?null:laccount.roiNet-raccount.roiNet,roiCI:ci(rois),
 sharedFukuTickets:shared,fukuTicketJaccard:new Set([...l,...r]).size?shared/new Set([...l,...r]).size:null,
 iterations,seed,validRoiReplicates:rois.length};
}
export function resolved(rows:Row[],keys:readonly Key[]) {
 checked(rows,keys);
 return rows.filter(r=>keys.every(k=>r.picks[k]!.fuku.status!=="unresolved" && r.picks[k]!.tan.status!=="unresolved"));
}
export function cohort(rows:Row[],keys:readonly Key[]) {
 checked(rows,keys);
 const moneyRows=resolved(rows,keys),descriptions=(rs:Row[])=>Object.fromEntries(keys.map(k=>[k,describe(rs,k)]));
 const comparisons=keys.flatMap((k,i)=>keys.slice(i+1).map(t=>pair(moneyRows,k,t)));
 const order=[...moneyRows].sort((a,b)=>Math.max(...keys.map(k=>b.picks[k]!.fuku.returnYen!))-Math.max(...keys.map(k=>a.picks[k]!.fuku.returnYen!))||a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId));
 const sensitivity=[1,2].map(n=>{const ids=new Set(order.slice(0,n).map(r=>r.raceId));return {removed:[...ids],results:descriptions(moneyRows.filter(r=>!ids.has(r.raceId)))}});
 const groups=Object.fromEntries(["same","different"].map(group=>{const rs=moneyRows.filter(r=>(r.picks.B!.horseId===r.picks.C!.horseId)===(group==="same"));return [group,{results:descriptions(rs),comparison:pair(rs,"B","C")}]}));
 return {races:rows.length,unresolved:rows.filter(r=>!moneyRows.includes(r)).map(r=>({raceId:r.raceId,picks:r.picks})),
 moneyRaces:moneyRows.length,results:descriptions(moneyRows),comparisons,sensitivity,groups,
 periods:Object.fromEntries(["2026-04","2026-05","2026-06"].map(month=>[month,descriptions(moneyRows.filter(r=>r.date.startsWith(month)))]))};
}
