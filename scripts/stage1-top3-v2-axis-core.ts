/** Saved-output exploratory diagnosis. No fitting, prediction, or rule selection. */
import assert from "node:assert/strict";
import { paired,outcome } from "./stage1-partner-ranking-core";
import { metrics,type Settlement } from "./simulator/settlement";
import { developmentDate } from "./simulator/canonical";
export const SEED=20261111;
export type Feature={name:string;value:number|null;contribution:number;missingReason:string|null;sourceCount:number};
export type AxisRow={raceId:string;date:string;time:string|null;horseId:string;horseNumber:number;horse:string;positionRaw:string|null;
 popularity:number|null;marketHorseId:string;marketHorseNumber:number;marketPositionRaw:string|null;surface:string;distance:number;classRaw:string|null;classCode:string|null;
 fieldSize:number;score:number;q:number;intercept:number;features:Feature[];priorRows:number;flatRows:number;actualFlatStarts:number;validFlatRows:number;recentUsed:number;
 restDays:number|null;missingCount:number;settlement:Settlement;marketSettlement:Settlement;
 allHorseCounts:{flatRows:number;actualFlatStarts:number;validFlatRows:number;recentUsed:number;missingCount:number}[]};
export const success=(r:AxisRow)=>outcome(r.positionRaw).top3===1;
export function wilson(hits:number,n:number){assert(Number.isInteger(n)&&n>=0&&hits>=0&&hits<=n);if(!n)return null;
 const z=1.959963984540054,p=hits/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [Math.max(0,c-h),Math.min(1,c+h)];}
export function distribution(values:(number|null)[]){const xs=values.filter((x):x is number=>x!==null).sort((a,b)=>a-b);
 assert(xs.every(Number.isFinite));const quantile=(p:number)=>{if(!xs.length)return null;const ix=(xs.length-1)*p,lo=Math.floor(ix),hi=Math.ceil(ix);return xs[lo]+(xs[hi]-xs[lo])*(ix-lo);};
 return {n:values.length,observed:xs.length,missing:values.length-xs.length,mean:xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null,
  min:xs[0]??null,q25:quantile(.25),median:quantile(.5),q75:quantile(.75),max:xs.at(-1)??null};}
export const popularityBand=(n:number|null)=>n===null?"unknown":n<=3?"1-3":n<=5?"4-5":n<=9?"6-9":"10+";
const countBand=(n:number)=>n<3?String(n):"3+";
const ageBand=(n:number|null)=>n===null?"unknown":n<=28?"0-28":n<=84?"29-84":"85+";
const value=(r:AxisRow,name:string)=>{const f=r.features.find(f=>f.name===name);assert(f);return f.value;};
const missingBand=(r:AxisRow)=>r.missingCount===0?"0":r.missingCount<=3?"1-3":"4+";
const account=(rows:AxisRow[],market=false)=>{const {curve,hitIntervals,...a}=metrics(rows.map(r=>({raceId:r.raceId,date:r.date,archivedStartTime:r.time,
 settlements:[market?r.marketSettlement:r.settlement]})));void curve;void hitIntervals;return {...a,below20Hits:a.hitRaces<20};};
export function describe(rows:AxisRow[]){const wins=rows.filter(r=>outcome(r.positionRaw).win).length,good=rows.filter(success).length,
 market=rows.filter(r=>outcome(r.marketPositionRaw).top3).length;
 return {races:rows.length,success:good,failure:rows.length-good,successRate:rows.length?good/rows.length:null,failureRate:rows.length?(rows.length-good)/rows.length:null,
  successCI95:wilson(good,rows.length),wins,winRate:rows.length?wins/rows.length:null,winCI95:wilson(wins,rows.length),
  special:rows.filter(r=>outcome(r.positionRaw).unknown).length,marketSuccess:market,marketSuccessRate:rows.length?market/rows.length:null,
  both:rows.filter(r=>success(r)&&outcome(r.marketPositionRaw).top3).length,axisOnly:rows.filter(r=>success(r)&&!outcome(r.marketPositionRaw).top3).length,
  marketOnly:rows.filter(r=>!success(r)&&outcome(r.marketPositionRaw).top3).length,neither:rows.filter(r=>!success(r)&&!outcome(r.marketPositionRaw).top3).length,
  score:distribution(rows.map(r=>r.score)),q:distribution(rows.map(r=>r.q)),missing:distribution(rows.map(r=>r.missingCount)),below20Success:good<20};}
function comparison(rows:AxisRow[],iterations:number){return {summary:describe(rows),paired:paired(rows.map(r=>outcome(r.positionRaw)),rows.map(r=>outcome(r.marketPositionRaw)),iterations,SEED)};}
/** Success/failure are separate outcome-defined groups: resample races within each, not paired horses. */
export function featureComparison(rows:AxisRow[],iterations=10000){
 const left=rows.filter(success),right=rows.filter(r=>!success(r));assert(left.length&&right.length);
 const matrix=(rs:AxisRow[])=>rs.map(r=>r.features.map(f=>f.value)),a=matrix(left),b=matrix(right),n=rows[0].features.length;
 const samples=Array.from({length:n},()=>[] as number[]);let state=SEED>>>0;
 const resample=(xs:(number|null)[][])=>{const sums=Array(n).fill(0),counts=Array(n).fill(0);for(let i=0;i<xs.length;i++){
  state=(Math.imul(state,1664525)+1013904223)>>>0;const x=xs[Math.floor(state/4294967296*xs.length)];
  x.forEach((v,j)=>{if(v!==null){sums[j]+=v;counts[j]++;}});}return sums.map((s,j)=>counts[j]?s/counts[j]:null);};
 for(let i=0;i<iterations;i++){const x=resample(a),y=resample(b);x.forEach((v,j)=>{if(v!==null&&y[j]!==null)samples[j].push(v-y[j]!);});}
 return rows[0].features.map((f,j)=>{const x=distribution(a.map(r=>r[j])),y=distribution(b.map(r=>r[j])),s=samples[j].sort((a,b)=>a-b);
  return {name:f.name,success:x,failure:y,successContribution:distribution(left.map(r=>r.features[j].contribution)),failureContribution:distribution(right.map(r=>r.features[j].contribution)),
   meanDifference:x.mean!==null&&y.mean!==null?x.mean-y.mean:null,ci95:s.length?[s[Math.floor((s.length-1)*.025)],s[Math.floor((s.length-1)*.975)]]:null,validSamples:s.length};});
}
export function validate(rows:AxisRow[]){assert(rows.length&&new Set(rows.map(r=>r.raceId)).size===rows.length);
 for(const r of rows){developmentDate(r.date);assert(r.features.length===26);assert.equal(new Set(r.features.map(f=>f.name)).size,26);
  assert([r.score,r.q,r.intercept].every(Number.isFinite));assert(r.q>=0&&r.q<=1);assert(Math.abs(r.q-1/(1+Math.exp(-r.score)))<1e-12);
  assert(Math.abs(r.score-r.intercept-r.features.reduce((n,f)=>n+f.contribution,0))<1e-10);assert.equal(r.missingCount,r.features.slice(0,13).filter(f=>f.value===null).length);
  r.features.slice(0,13).forEach((f,i)=>{assert.equal(r.features[i+13].value,Number(f.value===null));assert.equal(r.features[i+13].name,f.name+":missing");});
  assert(r.popularity===null||(Number.isInteger(r.popularity)&&r.popularity>0));assert(r.validFlatRows<=r.actualFlatStarts&&r.actualFlatStarts<=r.flatRows&&r.flatRows<=r.priorRows&&r.recentUsed<=Math.min(3,r.validFlatRows));
  assert.equal(r.allHorseCounts.length,r.fieldSize);assert([r.settlement,r.marketSettlement].every(t=>t.kind==="fuku"&&t.stakeYen===1000&&(t.status==="win"||t.status==="loss")));
 }
}
export function diagnose(rows:AxisRow[],iterations=10000){validate(rows);
 const popularity=["1-3","4-5","6-9","10+","unknown"].map(b=>{const rs=rows.filter(r=>popularityBand(r.popularity)===b);
  const sorted=[...rs].sort((a,b)=>b.settlement.returnYen!-a.settlement.returnYen!||a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId));
  return {band:b,...comparison(rs,iterations),axisAccount:account(rs),marketAccount:account(rs,true),sensitivity:[1,2].map(n=>{
   const removed=sorted.filter(r=>r.settlement.status==="win").slice(0,n).map(r=>({raceId:r.raceId,returnYen:r.settlement.returnYen})),ids=new Set(removed.map(r=>r.raceId)),remaining=rs.filter(r=>!ids.has(r.raceId));
   return {requested:n,removed,axis:account(remaining),market:account(remaining,true)};})};});
 const divergence=[{name:"same",test:(r:AxisRow)=>r.horseId===r.marketHorseId},{name:"different",test:(r:AxisRow)=>r.horseId!==r.marketHorseId},
  {name:"market2-3",test:(r:AxisRow)=>r.popularity!==null&&r.popularity>=2&&r.popularity<=3},
  {name:"market4+",test:(r:AxisRow)=>r.popularity!==null&&r.popularity>=4},{name:"market6+",test:(r:AxisRow)=>r.popularity!==null&&r.popularity>=6}]
  .map(g=>({name:g.name,...comparison(rows.filter(g.test),iterations)}));
 const experience=["0","1","2","3+"].map(b=>({band:b,...comparison(rows.filter(r=>countBand(r.actualFlatStarts)===b),iterations)}));
 const validExperience=["0","1","2","3+"].map(b=>({band:b,...comparison(rows.filter(r=>countBand(r.validFlatRows)===b),iterations)}));
 const missing=["0","1-3","4+"].map(b=>({band:b,...comparison(rows.filter(r=>missingBand(r)===b),iterations)}));
 const conditions:Record<string,(r:AxisRow)=>string>={surface:r=>r.surface,distance:r=>r.distance<=1400?"<=1400":r.distance<=1800?"1401-1800":r.distance<=2200?"1801-2200":">2200",
  class:r=>r.classCode??"unknown",field:r=>r.fieldSize<=7?"<=7":r.fieldSize<=11?"8-11":"12-18",rest:r=>ageBand(r.restDays),
  weight:r=>{const v=value(r,"weightChange");return v===null?"unknown":v<0?"decrease":v===0?"same":"increase";},
  sameSurface:r=>{const v=value(r,"sameSurfaceCount");return v===null?"unknown":v===0?"none":"some";},
  nearDistance:r=>{const v=value(r,"nearDistanceCount");return v===null?"unknown":v===0?"none":"some";},
  surfaceAge:r=>{const v=value(r,"sameSurfaceAge");return ageBand(v===null?null:Math.round(v*365));},distanceAge:r=>{const v=value(r,"nearDistanceAge");return ageBand(v===null?null:Math.round(v*365));}};
 const conditionReport=Object.fromEntries(Object.entries(conditions).map(([name,group])=>[name,[...new Set(rows.map(group))].sort().map(b=>({band:b,...describe(rows.filter(r=>group(r)===b))}))]));
 const scoreBands=Array.from({length:20},(_,i)=>{const rs=rows.filter(r=>Math.min(19,Math.floor(r.q*20))===i),d=describe(rs);
  return {lower:i/20,upper:(i+1)/20,...d,meanPredicted:d.q.mean,observedMinusPredicted:d.successRate!==null&&d.q.mean!==null?d.successRate-d.q.mean:null};});
 const ordered=[...rows].sort((a,b)=>a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId));
 const cases=(good:boolean)=>{const selected:{pattern:string;row:AxisRow}[]=[],ids=new Set<string>();
  const predicates:[string,(r:AxisRow)=>boolean][]=[["market-disagreement",r=>r.horseId!==r.marketHorseId&&(good||!!outcome(r.marketPositionRaw).top3)],
   ["limited-history",r=>r.validFlatRows<3],["no-near-distance",r=>value(r,"nearDistanceCount")===0],["missing-values",r=>r.missingCount>0],
   [good?"lower-q":"higher-q",r=>good?r.q<.30:r.q>=.30]];
  for(const[pattern,test]of predicates){const group=ordered.filter(r=>success(r)===good&&!ids.has(r.raceId)&&test(r)).slice(0,good?2:3);
   for(const row of group){ids.add(row.raceId);selected.push({pattern,row});}}
  return selected;};
 const allCounts=rows.flatMap(r=>r.allHorseCounts);
 return {overall:comparison(rows,iterations),popularity,divergence,experience,validExperience,missing,conditions:conditionReport,scoreBands,
  featureComparison:featureComparison(rows,iterations),historyQuality:{axis:{prior:distribution(rows.map(r=>r.priorRows)),flat:distribution(rows.map(r=>r.flatRows)),valid:distribution(rows.map(r=>r.validFlatRows)),used:distribution(rows.map(r=>r.recentUsed))},
   allHorses:{n:allCounts.length,actualBins:Object.fromEntries(["0","1","2","3+"].map(b=>[b,allCounts.filter(r=>countBand(r.actualFlatStarts)===b).length])),validBins:Object.fromEntries(["0","1","2","3+"].map(b=>[b,allCounts.filter(r=>countBand(r.validFlatRows)===b).length])),flat:distribution(allCounts.map(r=>r.flatRows)),used:distribution(allCounts.map(r=>r.recentUsed))}},
  cases:{failure:cases(false),success:cases(true),highQFailure:ordered.find(r=>!success(r)&&r.q>=.30)??null,lowQSuccess:ordered.find(r=>success(r)&&r.q<.30)??null},
  probability:{brier:rows.reduce((n,r)=>n+(r.q-Number(success(r)))**2,0)/rows.length},rows};
}
