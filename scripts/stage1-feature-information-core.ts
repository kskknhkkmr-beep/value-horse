/** Descriptive saved-prediction audit only: no fitting, prediction, feature vectors or money. */
import assert from "node:assert/strict";
import { developmentDate,isoDate } from "./simulator/canonical";
import type { Dataset,RaceSpec } from "./simulator/types";
import type { Forecast } from "./run-stage1-top3";
import { prior,validFinish,explicitClass,localRace,completeOpponents,histogram } from "./stage1-next-feature-audit-core";
import { isJraFlat } from "./stage1-v2-input";
export const FEATURE_NAMES=["recentFinish","surfaceFinish","distanceFinish","historyCount","restDays","cornerPosition","weightChange"] as const;
export const PLAN={version:"feature-information-audit-v1",seed:20261011,bootstrap:10000,
 dimensions:["surface","exact distance (no optimized bands)","stored structuredClass"],
 historyBins:["0","1","2","3+"],sourceBins:["0","1","2","3"],firstCases:3,
 performanceUse:"descriptive top3 only; no ROI or feature efficacy experiment"} as const;
export function finish(raw:string|null){
 const n=raw&&/^[1-9][0-9]*$/.test(raw)?Number(raw):null;
 return {raw,win:Number(n===1),top3:Number(n!==null&&n<=3),category:n===null?"special":n<=3?"top3":"fourPlus"};
}
export function pairedCI(values:number[],iterations:number=PLAN.bootstrap){
 if(!values.length)return null;let state=PLAN.seed>>>0;const samples:number[]=[];
 for(let b=0;b<iterations;b++){let sum=0;for(let i=0;i<values.length;i++){
  state=(Math.imul(state,1664525)+1013904223)>>>0;sum+=values[Math.floor(state/4294967296*values.length)];}
  samples.push(sum/values.length);}
 samples.sort((a,b)=>a-b);return {seed:PLAN.seed,iterations,estimate:values.reduce((a,b)=>a+b,0)/values.length,
  ci95:[samples[Math.floor((samples.length-1)*.025)],samples[Math.floor((samples.length-1)*.975)]]};
}
export function overlap(a:{raceId:string|null;date:string}[],b:{raceId:string|null;date:string}[]){
 const identifiable=[...a,...b].every(r=>r.raceId!==null);
 const key=(r:{raceId:string|null;date:string})=>(r.raceId??"unknown ID")+"/"+r.date;
 const x=new Set(a.map(key)),y=new Set(b.map(key)),union=new Set([...x,...y]);
 const shared=[...x].filter(k=>y.has(k)).length;
 return {a:x.size,b:y.size,shared,jaccard:identifiable&&union.size?shared/union.size:null,identicalNonempty:identifiable&&x.size>0&&x.size===y.size&&shared===x.size};
}
export function material(data:Dataset,race:RaceSpec,horseId:string){
 const byId=new Map(data.races.map(r=>[r.raceId,r]));const rows=prior(data.historyByHorse[horseId],race).map(x=>x.h);
 const valid=rows.filter(validFinish),same=valid.filter(h=>h.surface===race.surface),near=same.filter(h=>h.distance!==null&&Math.abs(h.distance-race.distance)<=200);
 const cls=(h:typeof rows[number])=>isJraFlat(h)?localRace(h,race,byId)?.structuredClass??explicitClass(h.raceName):null;
 const latest=rows[0],linked=rows.filter(h=>completeOpponents(h,localRace(h,race,byId),horseId));
 const selected=valid.slice(0,3),classes=selected.map(cls),latestClass=latest?cls(latest):null;
 const render=(h:typeof rows[number])=>({raceId:h.netKeibaRaceId,date:h.date,name:h.raceName,positionRaw:h.positionRaw,
  fieldSize:h.fieldSize,surface:h.surface,distance:h.distance,class:cls(h),confirmedJra:isJraFlat(h),
  completeOpponents:completeOpponents(h,localRace(h,race,byId),horseId)});
 return {priorFlat:rows.length,validFinishes:valid.length,sameSurfaceValid:same.length,nearDistanceValid:near.length,
  sameUsed:Math.min(same.length,3),nearUsed:Math.min(near.length,3),latestClass,
  classRelation:latestClass===null||race.structuredClass===null?"unknown":latestClass===race.structuredClass?"same":"different (not numeric class difference)",
  latestSurfaceChanged:latest?latest.surface!==race.surface:null,latestDistanceChanged:latest?latest.distance!==race.distance:null,
  latestGapDays:latest?(Date.parse(race.date)-Date.parse(latest.date))/86400000:null,
  recentNonJra:selected.filter(h=>!isJraFlat(h)).length,recentClassUnknown:classes.filter(c=>c===null).length,
  recentDifferentKnownClass:classes.filter(c=>c!==null&&race.structuredClass!==null&&c!==race.structuredClass).length,
  completeOpponents:linked.length,selectedCompleteOpponents:selected.filter(h=>completeOpponents(h,localRace(h,race,byId),horseId)).length,
  recentSources:selected.map(render),latest:latest?render(latest):null};
}
export type Row={raceId:string;date:string;surface:string;distance:number;class:string|null;same:boolean;
 selections:Record<"top3"|"market",{horseId:string;horseNumber:number;popularity:number|null;finish:ReturnType<typeof finish>;material:ReturnType<typeof material>}>};
export function describe(rows:Row[],withCI=true){
 return {n:rows.length,top3:Object.fromEntries((["top3","market"]as const).map(w=>{const xs=rows.map(r=>r.selections[w]);return [w,{n:xs.length,
  wins:xs.reduce((n,x)=>n+x.finish.win,0),top3:xs.reduce((n,x)=>n+x.finish.top3,0),
  rate:xs.length?xs.reduce((n,x)=>n+x.finish.top3,0)/xs.length:null,fourPlus:xs.filter(x=>x.finish.category==="fourPlus").length,
  special:xs.filter(x=>x.finish.category==="special").length,popularity:histogram(xs.map(x=>x.popularity)),
  below20Top3:xs.reduce((n,x)=>n+x.finish.top3,0)<20}];})),
  marketOnlyFourPlus:rows.filter(r=>r.selections.market.finish.top3&&r.selections.top3.finish.category==="fourPlus").length,
  top3OnlyFourPlus:rows.filter(r=>r.selections.top3.finish.top3&&r.selections.market.finish.category==="fourPlus").length,
  marketTop3ModelSpecial:rows.filter(r=>r.selections.market.finish.top3&&r.selections.top3.finish.category==="special").length,
  bothTop3:rows.filter(r=>r.selections.market.finish.top3&&r.selections.top3.finish.top3).length,
  differenceCI:withCI?pairedCI(rows.map(r=>r.selections.top3.finish.top3-r.selections.market.finish.top3)):null};
}
export function audit(forecasts:Forecast[],data:Dataset,marketOrders:Record<string,{horseId:string;horseNumber:number}[]>){
 assert.equal(new Set(forecasts.map(f=>f.raceId)).size,forecasts.length);const byId=new Map(data.races.map(r=>[r.raceId,r]));
 const quality=FEATURE_NAMES.map(name=>({name,n:0,missing:0,reasonCounts:{} as Record<string,number>,sourceCounts:[] as number[],
  lastSourceDays:[] as number[],sameDayOrFuture:0}));
 const pairs=[[0,1],[0,2],[1,2]].map(([a,b])=>({left:FEATURE_NAMES[a],right:FEATURE_NAMES[b],n:0,unidentifiable:0,identicalSources:0,
  equalValues:0,sharedSources:0,jaccards:[] as number[],x:[] as number[],y:[] as number[]}));
 const rows:Row[]=[];const snapshot=(r:RaceSpec,id:string)=>material(data,r,id);
 let count=0,classificationMatches=0;
 for(const f of forecasts){developmentDate(f.date);const race=byId.get(f.raceId);assert(race&&race.date===f.date&&["芝","ダ"].includes(race.surface));classificationMatches++;
  assert.deepEqual(f.predictions.map(p=>p.rank),f.predictions.map((_,i)=>i+1));
  assert.deepEqual(f.predictions.map(p=>[p.horseId,p.horseNumber]).sort(),race.starters.map(h=>[h.horseId,h.horseNumber]).sort());
  const market=marketOrders[f.raceId];assert(market&&market.length===f.predictions.length);
  assert.deepEqual(market.map(h=>[h.horseId,h.horseNumber]).sort(),race.starters.map(h=>[h.horseId,h.horseNumber]).sort());
  for(const p of f.predictions){count++;assert.equal(p.probabilityEvent,"top3");
   assert.deepEqual(p.reasons.slice(0,7).map(r=>r.name),[...FEATURE_NAMES]);
   for(let i=0;i<7;i++){const q=quality[i],r=p.reasons[i];q.n++;if(r.value===null){q.missing++;q.reasonCounts[r.missingReason??"unspecified"]=(q.reasonCounts[r.missingReason??"unspecified"]??0)+1;}
    q.sourceCounts.push(r.name==="cornerPosition"?r.details?.used??0:r.value===null?0:r.sourceRows.length);
    for(const h of r.sourceRows){assert(isoDate(h.date)<race.date&&h.raceId!==race.raceId,"Future source provenance");}
    if(r.sourceRows.length)q.lastSourceDays.push(Math.min(...r.sourceRows.map(h=>(Date.parse(race.date)-Date.parse(h.date))/86400000)));}
   for(const [i,pair]of pairs.entries()){const [a,b]=[[0,1],[0,2],[1,2]][i],x=p.reasons[a],y=p.reasons[b];
    if(x.value===null||y.value===null)continue;const o=overlap(x.sourceRows,y.sourceRows);if(o.jaccard===null){pair.unidentifiable++;continue;}pair.n++;pair.identicalSources+=Number(o.identicalNonempty);
    pair.equalValues+=Number(x.value===y.value);pair.sharedSources+=o.shared;pair.jaccards.push(o.jaccard!);pair.x.push(x.value);pair.y.push(y.value);}
  }
  const selections=Object.fromEntries((["top3","market"]as const).map(w=>{const chosen=w==="top3"?f.predictions[0]:market[0];
   const truth=data.truthByRace[race.raceId].horses.find(h=>h.horseId===chosen.horseId);assert(truth&&truth.horseNumber===chosen.horseNumber);
   return [w,{horseId:chosen.horseId,horseNumber:chosen.horseNumber,popularity:truth.popularity,finish:finish(truth.positionRaw),material:snapshot(race,chosen.horseId)}];})) as Row["selections"];
  rows.push({raceId:race.raceId,date:race.date,surface:race.surface,distance:race.distance,class:race.structuredClass,
   same:selections.top3.horseId===selections.market.horseId,selections});
 }
 const different=rows.filter(r=>!r.same),same=rows.filter(r=>r.same);
 const strata=(field:"surface"|"distance"|"class")=>[...new Set(rows.map(r=>String(r[field]??"unknown")))].sort().map(k=>{
  const xs=rows.filter(r=>String(r[field]??"unknown")===k);return {key:k,all:describe(xs),disagreement:describe(xs.filter(r=>!r.same))};});
 const experience=Object.fromEntries((["top3","market"]as const).map(w=>[w,Object.fromEntries(
  (["validFinishes","sameUsed","nearUsed"]as const).map(field=>{const bins=field==="validFinishes"?["0","1","2","3+"]:["0","1","2","3"];
   return [field,bins.map(bin=>{const xs=different.filter(r=>{const v=r.selections[w].material[field];return field==="validFinishes"?(v>=3?"3+":String(v))===bin:String(v)===bin;});return {bin,description:describe(xs)};})];}))]));
 const summaries=(xs:Row[])=>Object.fromEntries((["top3","market"]as const).map(w=>{const m=xs.map(r=>r.selections[w].material);return [w,{n:m.length,
  latestClassUnknown:m.filter(x=>x.latestClass===null).length,classRelation:histogram(m.map(x=>x.classRelation)),
  noCompleteOpponentHistory:m.filter(x=>x.completeOpponents===0).length,selectedWithoutCompleteOpponents:m.filter(x=>x.selectedCompleteOpponents===0).length,
  recentNonJra:m.filter(x=>x.recentNonJra>0).length,nearUsed:histogram(m.map(x=>x.nearUsed)),
  validFinishes:histogram(m.map(x=>x.validFinishes>=3?"3+":String(x.validFinishes))),
  surfaceChanges:m.filter(x=>x.latestSurfaceChanged===true).length,distanceChanges:m.filter(x=>x.latestDistanceChanged===true).length}];}));
 const groups={marketTop3ModelFourPlus:different.filter(r=>r.selections.market.finish.top3&&r.selections.top3.finish.category==="fourPlus"),
  modelTop3MarketFourPlus:different.filter(r=>r.selections.top3.finish.top3&&r.selections.market.finish.category==="fourPlus"),
  bothFourPlus:different.filter(r=>r.selections.top3.finish.category==="fourPlus"&&r.selections.market.finish.category==="fourPlus"),
  modelSpecialMarketTop3:different.filter(r=>r.selections.top3.finish.category==="special"&&r.selections.market.finish.top3)};
 const pearson=(x:number[],y:number[])=>{const xm=x.reduce((a,b)=>a+b,0)/x.length,ym=y.reduce((a,b)=>a+b,0)/y.length;
  const cov=x.reduce((s,v,i)=>s+(v-xm)*(y[i]-ym),0),xx=x.reduce((s,v)=>s+(v-xm)**2,0),yy=y.reduce((s,v)=>s+(v-ym)**2,0);
  return xx>0&&yy>0?cov/Math.sqrt(xx*yy):null;};
 return {plan:PLAN,scope:{races:rows.length,appearances:count,classificationMatches},
  quality:quality.map(q=>{const {lastSourceDays,sourceCounts,...rest}=q;return {...rest,missingRate:q.n?q.missing/q.n:null,sourceCounts:histogram(sourceCounts),
   sourceAgeDays:lastSourceDays.length?{min:Math.min(...lastSourceDays),median:[...lastSourceDays].sort((a,b)=>a-b)[Math.floor(lastSourceDays.length/2)],max:Math.max(...lastSourceDays)}:null};}),
  overlap:pairs.map(({x,y,jaccards,...p})=>({...p,pearson:x.length?pearson(x,y):null,meanJaccard:jaccards.length?jaccards.reduce((a,b)=>a+b,0)/jaccards.length:null})),
  all:describe(rows),agreement:describe(same),disagreement:describe(different),conditions:{surface:strata("surface"),distance:strata("distance"),class:strata("class")},experience,
  materials:{all:summaries(rows),disagreement:summaries(different)},
  cases:Object.fromEntries(Object.entries(groups).map(([k,xs])=>[k,{n:xs.length,material:summaries(xs),first:[...xs].sort((a,b)=>a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId)).slice(0,PLAN.firstCases)}])),
  rows,newModel:false,newTraining:false,newPrediction:false,roiCalculated:false,fixedEvaluationRead:false};
}
