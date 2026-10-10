/** Read-only quality/structure diagnostics. No feature vectors, fitting, odds selection or money metrics. */
import assert from "node:assert/strict";
import { isoDate } from "./simulator/canonical";
import type { Dataset, History, RaceSpec, Truth } from "./simulator/types";
import type { Row } from "./stage1-feature-ablation-audit-core";
import { isJraFlat } from "./stage1-v2-input";
import { pairedRateCI } from "./stage1-v2-audit-core";

export const histogram = (values: (string | number | null)[]) => Object.fromEntries(
 [...new Set(values.map(v=>String(v??"missing")))].sort().map(k=>[k,values.filter(v=>String(v??"missing")===k).length]));
export const validFinish = (h:History) => Number.isInteger(h.position) && Number.isInteger(h.fieldSize) &&
 h.fieldSize!>=2 && h.position!>=1 && h.position!<=h.fieldSize! && h.positionRaw!==null &&
 /^\d+$/.test(h.positionRaw) && Number(h.positionRaw)===h.position;
export function prior(rows:History[], race:Pick<RaceSpec,"date"|"raceId">) {
 return rows.map((h,index)=>({h,index})).filter(({h})=>isoDate(h.date)<race.date &&
  h.netKeibaRaceId!==race.raceId && ["芝","ダ"].includes(h.surface!))
  .sort((a,b)=>b.h.date.localeCompare(a.h.date)||(a.h.netKeibaRaceId??"").localeCompare(b.h.netKeibaRaceId??""));
}
/** Audit-only explicit text recognition. Never assigns strength or fills ambiguous special race names. */
export function explicitClass(name:string|null):string|null {
 if(!name)return null;
 const g=name.match(/\((J?G)(I{1,3}|[1-3])\)/i);
 if(g){const x=g[2].toUpperCase();return g[1].toUpperCase()+({I:"1",II:"2",III:"3"}[x]??x);}
 if(/新馬/.test(name))return "newcomer";
 if(/未勝利/.test(name))return "maiden";
 if(/1勝/.test(name))return "one_win";
 if(/2勝/.test(name))return "two_win";
 if(/3勝/.test(name))return "three_win";
 if(/\(L\)|リステッド/.test(name))return "listed";
 if(/オープン|\(OP\)/i.test(name))return "open";
 return null; // Includes obsolete cash labels, foreign/local labels and special names.
}
export function localRace(h:History,race:RaceSpec,byId:Map<string,RaceSpec>) {
 const linked=h.netKeibaRaceId?byId.get(h.netKeibaRaceId):undefined;
 if(!linked)return null;
 assert.equal(linked.date,h.date,"History/local race date mismatch");
 assert(linked.date<race.date && linked.raceId!==race.raceId,"Non-prior local race");
 return linked;
}
export function completeOpponents(h:History,linked:RaceSpec|null,horseId:string):boolean {
 if(!linked || !isJraFlat(h))return false;
 const own=linked.starters.find(s=>s.horseId===horseId);
 return !!own && own.horseNumber===h.horseNumber && linked.starters.length===h.fieldSize;
}
export function confirmedNonStarter(h:History,horseId:string,truth:Truth):boolean {
 const row=truth.horses.find(s=>s.horseId===horseId);
 return row?.horseNumber===h.horseNumber && row.positionRaw===h.positionRaw && /^(取|除)/.test(row.positionRaw??"");
}
export function firstCases(rows:Row[]) {
 const xs=rows.filter(r=>r.selections.D.horseId!==r.selections.market.horseId)
 .sort((a,b)=>a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId));
 const groups={
  marketWinsDOut:xs.filter(r=>r.selections.market.win&&!r.selections.D.place),
  DWinsMarketOut:xs.filter(r=>r.selections.D.win&&!r.selections.market.place),
  bothOut:xs.filter(r=>!r.selections.D.place&&!r.selections.market.place)};
 return Object.fromEntries(Object.entries(groups).map(([k,g])=>[k,{count:g.length,first:g.slice(0,3)}]));
}
export function rates(rows:Row[],key:"D"|"market") {
 const xs=rows.map(r=>r.selections[key]);
 return {n:xs.length,wins:xs.filter(x=>x.win).length,places:xs.filter(x=>x.place).length,
 winRate:xs.length?xs.filter(x=>x.win).length/xs.length:null,
 placeRate:xs.length?xs.filter(x=>x.place).length/xs.length:null,popularity:histogram(xs.map(x=>x.popularity))};
}
export function cohort(rows:Row[],data:Dataset) {
 assert.equal(rows.length,742);assert.equal(new Set(rows.map(r=>r.raceId)).size,742);
 const byId=new Map(data.races.map(r=>[r.raceId,r]));
 for(const row of rows) {
  const race=byId.get(row.raceId);assert(race&&race.date===row.date&&["芝","ダ"].includes(race.surface));
  for(const k of ["A","B","C","D","market"] as const) {
   const x=row.selections[k];assert(race.starters.some(s=>s.horseId===x.horseId&&s.horseNumber===x.horseNumber));
   const truth=data.truthByRace[row.raceId].horses.find(h=>h.horseId===x.horseId)!;
   assert.equal(truth.positionRaw,x.positionRaw);assert.equal(truth.popularity,x.popularity);
   assert.equal(x.win,truth.positionRaw==="1");
   const f=data.truthByRace[row.raceId].payouts.fuku;
   assert.equal(f.status,"ok");assert.equal(x.place,f.entries.some(p=>p.horse===x.horseNumber));
  }
 }
 return byId;
}
export function audit(rows:Row[],data:Dataset,currentConditions:Record<string,string|null>) {
 const byId=cohort(rows,data),unique=new Map<string,{h:History;horseId:string}>();
 const material=new Map<string,ReturnType<typeof materialFor>>();
 function materialFor(race:RaceSpec,horseId:string) {
  const p=prior(data.historyByHorse[horseId],race);
  const same=p.filter(x=>x.h.surface===race.surface&&validFinish(x.h));
  const near=same.filter(x=>x.h.distance!==null&&Math.abs(x.h.distance-race.distance)<=200);
  const jra=p.filter(x=>isJraFlat(x.h));
  const cls=(h:History)=>{const l=localRace(h,race,byId);return l?.structuredClass??(isJraFlat(h)?explicitClass(h.raceName):null);};
  const past=p[0]?.h,local=p.filter(x=>localRace(x.h,race,byId)!==null);
  const render=(h:History)=>({date:h.date,raceId:h.netKeibaRaceId,name:h.raceName,surface:h.surface,
   distance:h.distance,trackCondition:h.trackConditionRaw,positionRaw:h.positionRaw,fieldSize:h.fieldSize,
   class:cls(h),classOrigin:localRace(h,race,byId)?"development race ID/date join":isJraFlat(h)&&explicitClass(h.raceName)?"explicit name only":"unknown"});
  const recent=p.filter(x=>validFinish(x.h)).slice(0,3);
  return {priorFlat:p.length,priorJraFlat:jra.length,sameSurfaceValid:same.length,nearDistanceValid:near.length,
   recentNonJra:recent.filter(x=>!isJraFlat(x.h)).length,
   sameUsed:Math.min(same.length,3),nearUsed:Math.min(near.length,3),
   latestClass:past?cls(past):null,latestSameSurface:past?past.surface===race.surface:null,
   latestExactDistance:past?past.distance===race.distance:null,localPast:local.length,
   completeOpponents:p.filter(x=>completeOpponents(x.h,localRace(x.h,race,byId),horseId)).length,
   sameClassKnown:same.slice(0,3).filter(x=>cls(x.h)!==null).length,
   nearClassKnown:near.slice(0,3).filter(x=>cls(x.h)!==null).length,
   latest:past?render(past):null,recentSources:recent.map(x=>render(x.h)),
   sameSources:same.slice(0,3).map(x=>render(x.h)),nearSources:near.slice(0,3).map(x=>render(x.h))};
 }
 let appearances=0,filteredNonFlat=0,filteredSameOrFuture=0;
 for(const row of rows) {
  const race=byId.get(row.raceId)!;
  for(const starter of race.starters) {
   appearances++;
   const raw=data.historyByHorse[starter.horseId];
   filteredSameOrFuture+=raw.filter(h=>h.date>=race.date||h.netKeibaRaceId===race.raceId).length;
   filteredNonFlat+=raw.filter(h=>h.date<race.date&&h.netKeibaRaceId!==race.raceId&&!["芝","ダ"].includes(h.surface!)).length;
   for(const x of prior(raw,race))unique.set(starter.horseId+"/"+x.index,{h:x.h,horseId:starter.horseId});
   material.set(row.raceId+"/"+starter.horseId,materialFor(race,starter.horseId));
  }
 }
 const uniqueRows=[...unique.values()],jra=uniqueRows.filter(x=>isJraFlat(x.h));
 const links=uniqueRows.map(x=>({x,l:x.h.netKeibaRaceId?byId.get(x.h.netKeibaRaceId):undefined}));
 const local=links.filter(x=>x.l&&x.l.date===x.x.h.date);
 const numberMismatch=local.filter(x=>!x.l!.starters.some(s=>s.horseId===x.x.horseId&&s.horseNumber===x.x.h.horseNumber));
 const nonStarter=numberMismatch.filter(x=>confirmedNonStarter(x.x.h,x.x.horseId,data.truthByRace[x.l!.raceId]));
 assert.equal(numberMismatch.length,nonStarter.length,"Unexplained historical horse-number mismatch");
 const complete=local.filter(x=>completeOpponents(x.x.h,x.l!,x.x.horseId));
 const nameOnly=jra.filter(x=>explicitClass(x.h.raceName)!==null);
 const known=jra.filter(x=>byId.get(x.h.netKeibaRaceId??"")?.structuredClass||explicitClass(x.h.raceName));
 const opponentSupport=complete.map(({x,l})=>l!.starters.filter(s=>s.horseId!==x.horseId)
 .map(s=>prior(data.historyByHorse[s.horseId],l!).filter(h=>isJraFlat(h.h)&&validFinish(h.h)).length));
 const summarize=(xs:ReturnType<typeof materialFor>[])=>({n:xs.length,
 priorFlat:histogram(xs.map(x=>x.priorFlat===0?"none":x.priorFlat===1?"one":"2+")),
 recentNonJra:histogram(xs.map(x=>x.recentNonJra)),
 sameUsed:histogram(xs.map(x=>x.sameUsed)),nearUsed:histogram(xs.map(x=>x.nearUsed)),
 latestClassMissing:xs.filter(x=>x.latestClass===null).length,
 localPastUnavailable:xs.filter(x=>x.localPast===0).length,completeOpponentSetUnavailable:xs.filter(x=>x.completeOpponents===0).length,
 sameClassKnown:histogram(xs.map(x=>x.sameClassKnown)),nearClassKnown:histogram(xs.map(x=>x.nearClassKnown)),
 latestSameSurface:histogram(xs.map(x=>x.latestSameSurface===null?null:String(x.latestSameSurface))),
 latestExactDistance:histogram(xs.map(x=>x.latestExactDistance===null?null:String(x.latestExactDistance)))});
 const agreement=rows.filter(r=>r.selections.D.horseId===r.selections.market.horseId),different=rows.filter(r=>r.selections.D.horseId!==r.selections.market.horseId);
 const paired=different.map(r=>({raceId:r.raceId,date:r.date,archivedStartTime:r.archivedStartTime,
 independent:r.selections.D,market:r.selections.market,vh:r.selections.A}));
 const cases=firstCases(rows);
 const groups=Object.fromEntries(Object.entries(cases).map(([key,g])=>{
  const xs=different.filter(r=>key==="marketWinsDOut"?r.selections.market.win&&!r.selections.D.place:
   key==="DWinsMarketOut"?r.selections.D.win&&!r.selections.market.place:!r.selections.D.place&&!r.selections.market.place);
  return [key,{n:g.count,material:Object.fromEntries((["D","market"] as const).map(k=>[k,summarize(xs.map(r=>material.get(r.raceId+"/"+r.selections[k].horseId)!))])),
   first:g.first.map(r=>({raceId:r.raceId,date:r.date,conditions:{surface:byId.get(r.raceId)!.surface,distance:byId.get(r.raceId)!.distance,class:byId.get(r.raceId)!.structuredClass},
    selections:Object.fromEntries((["D","market"] as const).map(k=>[k,{horseNumber:r.selections[k].horseNumber,popularity:r.selections[k].popularity,
     positionRaw:r.selections[k].positionRaw,material:material.get(r.raceId+"/"+r.selections[k].horseId)!}]))}))}];
 }));
 const conditions=(xs:Row[])=>Object.fromEntries(["surface","distance","venue","structuredClass","grade"].map(k=>
 [k,histogram(xs.map(r=>byId.get(r.raceId)![k as keyof RaceSpec] as string|number|null))]).concat(
 [["trackCondition",histogram(xs.map(r=>currentConditions[r.raceId]))]]));
 const races=rows.map(r=>byId.get(r.raceId)!);
 return {scope:{races:rows.length,appearances,uniqueHorses:new Set(races.flatMap(r=>r.starters.map(s=>s.horseId))).size,
   uniquePriorFlatRows:uniqueRows.length,uniquePriorJraFlatRows:jra.length,filteredSameOrFuture,filteredNonFlat,
   targetDates:[...new Set(rows.map(r=>r.date))].sort(),
   historyDateRange:[uniqueRows.map(x=>x.h.date).sort()[0],uniqueRows.map(x=>x.h.date).sort().at(-1)]},
  agreement:{n:agreement.length,D:rates(agreement,"D"),market:rates(agreement,"market")},
  disagreement:{n:different.length,D:rates(different,"D"),market:rates(different,"market"),
   winDifferenceCI:pairedRateCI(paired,"independent","market"),placeDifferenceCI:pairedRateCI(paired,"independent","market","place")},
  conditions:{all:conditions(rows),disagreement:conditions(different)},
  current:{n:races.length,classRawMissing:races.filter(r=>!r.classRaw).length,structuredClassMissing:races.filter(r=>!r.structuredClass).length,
   gradeNonNull:races.filter(r=>r.grade!==null).length,trackConditionMissing:races.filter(r=>!currentConditions[r.raceId]).length,
   verifiedPreOffTrackSnapshots:0},
  histories:{n:uniqueRows.length,jra:jra.length,
   missing:Object.fromEntries((["netKeibaRaceId","raceName","distance","surface","trackConditionRaw","fieldSize"] as const).map(k=>[k,uniqueRows.filter(x=>x.h[k]==null).length])),
   surface:histogram(uniqueRows.map(x=>x.h.surface)),trackCondition:histogram(uniqueRows.map(x=>x.h.trackConditionRaw)),
   explicitJraClass:nameOnly.length,localRaceJoin:local.length,combinedJraClassKnown:known.length,
   explicitClassDistribution:histogram(jra.map(x=>explicitClass(x.h.raceName))),
   explicitClassUnknownFirst:jra.filter(x=>explicitClass(x.h.raceName)===null)
    .sort((a,b)=>a.h.date.localeCompare(b.h.date)||a.horseId.localeCompare(b.horseId)).slice(0,3)
    .map(x=>({horseId:x.horseId,date:x.h.date,raceId:x.h.netKeibaRaceId,name:x.h.raceName})),
   localSurfaceMismatch:local.filter(x=>x.l!.surface!==x.x.h.surface).length,
   localDistanceMismatch:local.filter(x=>x.l!.distance!==x.x.h.distance).length,
   localNonStarterRows:nonStarter.length,localNonStarterStatuses:histogram(nonStarter.map(x=>x.x.h.positionRaw)),
   unexplainedLocalHorseNumberMismatch:numberMismatch.length-nonStarter.length,
   localExplicitClassMismatch:local.filter(x=>explicitClass(x.x.h.raceName)!==null&&
     explicitClass(x.x.h.raceName)!==x.l!.structuredClass).length,
   completeLocalOpponentSets:complete.length,distinctCompleteHistoricalRaces:new Set(complete.map(x=>x.l!.raceId)).size,
   opponentSetsAllWithPriorJraFinish:opponentSupport.filter(xs=>xs.length>0&&xs.every(n=>n>0)).length,
   opponentEntries:opponentSupport.flat().length,opponentEntriesWithoutPriorJraFinish:opponentSupport.flat().filter(n=>n===0).length},
  material:{all:summarize([...material.values()]),
   disagreement:Object.fromEntries((["D","market"] as const).map(k=>[k,summarize(different.map(r=>material.get(r.raceId+"/"+r.selections[k].horseId)!))]))},
  groups,fixedEvaluationRead:false,newTraining:false,newPrediction:false,roiCalculated:false};
}
