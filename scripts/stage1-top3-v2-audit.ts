/** Four fixed saved-model comparisons, never tunes inputs or settings. */
import assert from "node:assert/strict";
import { sha256 } from "./simulator/canonical";
import { metrics,type Settlement } from "./simulator/settlement";
import { evaluate } from "./stage1-top3-audit";
export const MAIN=["A","B","C","D"] as const;
export const WAYS=[...MAIN,"A-market","B-market","C-market"] as const;
export const KINDS=["fuku","wide","sanfuku"] as const;
type Main=typeof MAIN[number];type Way=typeof WAYS[number];type Kind=typeof KINDS[number];
type Old=ReturnType<typeof evaluate>["rows"][number];
export type Row={raceId:string;date:string;archivedStartTime:string|null;orders:Record<Main,Old["orders"]["A"]>;
 outcomes:Record<Main,Old["outcomes"]["A"]>;settlements:Record<Kind,Record<Way,Settlement[]>>};
export function merge(old:Old[],next:Old[]):Row[]{
 assert.equal(old.length,next.length);return next.map((n,i)=>{const o=old[i];assert.equal(n.raceId,o.raceId);assert.equal(n.date,o.date);
  for(const w of ["A","C"] as const){assert.equal(sha256(n.orders[w]),sha256(o.orders[w]));assert.equal(sha256(n.outcomes[w]),sha256(o.outcomes[w]));
   for(const k of KINDS)assert.equal(sha256(n.settlements[k][w]),sha256(o.settlements[k][w]));}
  return {raceId:n.raceId,date:n.date,archivedStartTime:n.archivedStartTime,
   orders:{A:n.orders.A,B:o.orders.B,C:n.orders.B,D:n.orders.C},outcomes:{A:n.outcomes.A,B:o.outcomes.B,C:n.outcomes.B,D:n.outcomes.C},
   settlements:Object.fromEntries(KINDS.map(k=>[k,{A:n.settlements[k].A,B:o.settlements[k].B,C:n.settlements[k].B,D:n.settlements[k].C,
    "A-market":n.settlements[k]["A-market"],"B-market":o.settlements[k]["B-market"],"C-market":n.settlements[k]["B-market"]}])) as Row["settlements"]};});
}
export function describe(rows:Row[]){return {races:rows.length,ranks:Object.fromEntries(MAIN.map(w=>[w,Array.from({length:5},(_,i)=>{
 const v=rows.map(r=>r.outcomes[w][i]);return {rank:i+1,wins:v.reduce((n,x)=>n+x.win,0),top3:v.reduce((n,x)=>n+x.top3,0),
  winRate:rows.length?v.reduce((n,x)=>n+x.win,0)/rows.length:null,top3Rate:rows.length?v.reduce((n,x)=>n+x.top3,0)/rows.length:null,
  nonNumeric:v.filter(x=>!x.raw||!/^\d+$/.test(x.raw)).length};})])),bets:Object.fromEntries(KINDS.map(k=>[k,Object.fromEntries(WAYS.map(w=>{
 const {curve,hitIntervals,...x}=metrics(rows.map(r=>({raceId:r.raceId,date:r.date,archivedStartTime:r.archivedStartTime,settlements:r.settlements[k][w]})));void curve;void hitIntervals;
 return [w,{...x,below20Hits:x.hitRaces<20}];}))]))};}
export function intervals(rows:Row[],iterations=10000,seed=20261011){
 const cols:Record<string,number[]>={};const pairs:Main[][]=[["C","B"],["C","D"],["C","A"],["B","A"],["B","D"],["A","D"]];
 for(const [a,b] of pairs)for(let i=0;i<5;i++)for(const field of ["win","top3"] as const)
  cols[`${a}-${b}/rank${i+1}/${field}`]=rows.map(r=>r.outcomes[a][i][field]-r.outcomes[b][i][field]);
 const moneyPairs:Way[][]=[...pairs,["C-market","B-market"],["C-market","D"]];
 for(const k of KINDS)for(const [a,b]of moneyPairs)cols[`${a}-${b}/${k}/ROI`]=rows.map(r=>{
  const roi=(w:Way)=>r.settlements[k][w].reduce((n,s)=>n+s.profitYen!,0)/r.settlements[k][w].reduce((n,s)=>n+s.stakeYen,0);return roi(a)-roi(b);});
 const names=Object.keys(cols),vectors=rows.map((_,i)=>names.map(k=>cols[k][i])),samples=names.map(()=>[]as number[]);let state=seed>>>0;
 for(let b=0;b<iterations;b++){const sums=names.map(()=>0);for(let i=0;i<rows.length;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;
  const v=vectors[Math.floor(state/4294967296*rows.length)];v.forEach((x,j)=>sums[j]+=x);}sums.forEach((v,j)=>samples[j].push(v/rows.length));}
 return {iterations,seed,races:rows.length,results:Object.fromEntries(names.map((k,i)=>{const s=samples[i].sort((a,b)=>a-b);return [k,{estimate:cols[k].reduce((a,b)=>a+b,0)/rows.length,
  ci95:[s[Math.floor((s.length-1)*.025)],s[Math.floor((s.length-1)*.975)]]}];}))};
}
export function report(rows:Row[]){
 const pairs=([["C","B"],["C","D"],["C","A"],["B","A"],["B","D"],["A","D"]] as const).map(([a,b])=>{
  const same=rows.filter(r=>r.orders[a][0].horseId===r.orders[b][0].horseId),different=rows.filter(r=>r.orders[a][0].horseId!==r.orders[b][0].horseId);
  const hit=(w:Main)=>new Set(rows.filter(r=>r.outcomes[w][0].top3).map(r=>r.raceId)),x=hit(a),y=hit(b),u=new Set([...x,...y]);
  return {pair:a+"-"+b,same:same.length,different:different.length,leftOnly:rows.filter(r=>r.outcomes[a][0].top3&&!r.outcomes[b][0].top3).length,
   rightOnly:rows.filter(r=>!r.outcomes[a][0].top3&&r.outcomes[b][0].top3).length,hitRaceJaccard:[...x].filter(id=>y.has(id)).length/u.size,
   sameResults:describe(same),differentResults:describe(different)};});
 const sensitivity=Object.fromEntries(KINDS.map(k=>{const ranked=rows.map(r=>({raceId:r.raceId,date:r.date,max:Math.max(0,...WAYS.flatMap(w=>r.settlements[k][w].map(s=>s.returnYen!)))}))
  .filter(r=>r.max>0).sort((a,b)=>b.max-a.max||a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId));
  return [k,[1,2].map(n=>{const removed=ranked.slice(0,n),ids=new Set(removed.map(r=>r.raceId));return {removed,results:describe(rows.filter(r=>!ids.has(r.raceId)))};})];}));
 const ordered=[...rows].sort((a,b)=>a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId));
 return {overall:describe(rows),ci:intervals(rows),pairs,sensitivity,
  periods:Object.fromEntries(["2026-04","2026-05","2026-06"].map(m=>[m,describe(rows.filter(r=>r.date.startsWith(m)))])),
  cases:{success:ordered.filter(r=>r.outcomes.C[0].top3&&!r.outcomes.B[0].top3).slice(0,3),failure:ordered.filter(r=>!r.outcomes.C[0].top3&&r.outcomes.B[0].top3).slice(0,3)},rows};
}
