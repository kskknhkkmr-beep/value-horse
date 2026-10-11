/** Independent Top3 v2. Two approved information groups; no market, weather, opponents or filesystem. */
import assert from "node:assert/strict";
import { frozenClone,sha256,isoDate,developmentDate } from "./simulator/canonical";
import { independentInput,derive as legacyDerive,assertIndependent,FEATURES as LEGACY,type IndependentInput,type FeaturedRace } from "./stage1-independent-v2";
import { example,sigmoid,bce,SETTINGS as OLD,type Example } from "./stage1-top3";
import type { PreRaceInput } from "./simulator/types";
import { RACE_KIND_VERSION } from "./simulator/race-kind";
export { example };
export const SETTINGS=frozenClone({...OLD,version:"stage1-independent-top3-v2",countCap:3,ageCapDays:365,distanceBandMetres:200});
export const ADDED=["classExperience","previousClassChanged","sameSurfaceCount","nearDistanceCount","sameSurfaceAge","nearDistanceAge"] as const;
export const FEATURES=[...LEGACY,...ADDED];
const CLASSES=["newcomer","maiden","one_win","two_win","three_win","open","listed","G3","G2","G1"];
type Past=IndependentInput["horses"][number]["history"][number]&{classRaw:string|null;classCode:string|null};
export type Input=Omit<IndependentInput,"horses">&{currentClass:string|null;horses:(Omit<IndependentInput["horses"][number],"history">&{history:Past[]})[]};
/** Explicit class identity only; no ordinal ability scale. Ambiguous labels stay unknown. */
export function parseClass(raw:string|null,date:string):string|null {
 if(!raw)return null;const s=raw.normalize("NFKC"),found=new Set<string>();
 const add=(re:RegExp,c:string)=>{if(re.test(s))found.add(c);};
 add(/新馬/,"newcomer");add(/未勝利/,"maiden");add(/1勝/,"one_win");add(/2勝/,"two_win");add(/3勝/,"three_win");
 add(/\(L\)|リステッド/,"listed");add(/オープン|\(OP\)/i,"open");
 const g=s.match(/\((G)(III|II|I|[1-3])\)/i);if(g)found.add("G"+({I:"1",II:"2",III:"3"}[g[2].toUpperCase()]??g[2]));
 if(isoDate(date)<="2019-05-31"){add(/(?:^|[^0-9])500万(?:下|円以下)/,"one_win");add(/(?:^|[^0-9])1000万(?:下|円以下)/,"two_win");add(/(?:^|[^0-9])1600万(?:下|円以下)/,"three_win");}
 return found.size===1?[...found][0]:null;
}
const strip=(r:Past)=>{const {classRaw,classCode,...rest}=r;void classRaw;void classCode;return rest;};
function base(input:Input):IndependentInput {
 const {currentClass,...rest}=input;void currentClass;
 return {...rest,horses:input.horses.map(h=>({...h,history:h.history.map(strip)}))};
}
export function assertInput(input:Input){
 assert(Object.keys(input).every(k=>["raceId","date","surface","distance","horses","currentClass"].includes(k)),"Unapproved Top3 v2 field");
 assert(input.currentClass===null||CLASSES.includes(input.currentClass));
 for(const h of input.horses)for(const r of h.history){
  assert(r.classCode===null||CLASSES.includes(r.classCode));assert(r.classCode===null||r.eligibleJra);
  assert.equal(r.classCode,r.eligibleJra?parseClass(r.classRaw,r.date):null,"Class provenance");}
 assertIndependent(base(input));
}
export function project(input:PreRaceInput):Input {
 const b=independentInput(input);
 const projected={...b,currentClass:CLASSES.includes(input.structuredClass??"")?input.structuredClass:null,
  horses:b.horses.map(h=>{const raw=input.horses.find(x=>x.horseId===h.horseId)!;
   return {...h,history:h.history.map((r,i)=>{const source=raw.history[i];assert.equal(isoDate(source.date),r.date);assert.equal(source.netKeibaRaceId,r.raceId);
    return {...r,classRaw:r.eligibleJra?source.raceName:null,classCode:r.eligibleJra?parseClass(source.raceName,r.date):null};})};})};
 assertInput(projected);return frozenClone(projected);
}
const started=(r:Past)=>Number.isInteger(r.position)&&Number.isInteger(r.fieldSize)&&r.fieldSize!>=2&&r.position!>=1&&r.position!<=r.fieldSize!&&
 r.positionRaw!==null&&/^[1-9][0-9]*$/.test(r.positionRaw)&&Number(r.positionRaw)===r.position||["中","中止","失","失格"].includes(r.positionRaw??"");
export function derive(input:Input):FeaturedRace {
 assertInput(input);const old=legacyDerive(base(input));
 const horses=old.horses.map(h=>{const all=[...input.horses.find(x=>x.horseId===h.horseId)!.history].sort((a,b)=>b.date.localeCompare(a.date)||(a.raceId??"").localeCompare(b.raceId??""));
  const past=all.filter(r=>r.eligibleJra&&started(r)),same=past.filter(r=>r.surface===input.surface);
  const badDistance=same.some(r=>r.distance===null||!Number.isFinite(r.distance)||r.distance<=0);
  const near=same.filter(r=>r.distance!==null&&Number.isFinite(r.distance)&&Math.abs(r.distance-input.distance)<=SETTINGS.distanceBandMetres);
  const unknownClass=past.some(r=>r.classCode===null),classMissing=input.currentClass===null?"unknown current class":unknownClass?"unknown prior class":null;
  const previous=all[0];const previousReason=input.currentClass===null?"unknown current class":!previous?"no prior history":
   all[1]?.date===previous.date?"ambiguous previous date":!previous.eligibleJra?"previous not confirmed JRA flat":
   !started(previous)?"previous not confirmed starter":previous.classCode===null?"unknown previous class":null;
  const feature=(name:string,value:number|null,sourceRows:Past[],missingReason:string|null,unit:string)=>({name,value,sourceRows,missingReason,unit});
  const count=(rows:Past[])=>Math.min(rows.length,SETTINGS.countCap)/SETTINGS.countCap;
  const age=(rows:Past[])=>rows.length?Math.min((Date.parse(input.date)-Date.parse(rows[0].date))/86400000,SETTINGS.ageCapDays)/SETTINGS.ageCapDays:null;
  return {...h,features:[...h.features,
   feature("classExperience",classMissing?null:count(past.filter(r=>r.classCode===input.currentClass)),past,classMissing,"min(same class starts,3)/3"),
   feature("previousClassChanged",previousReason?null:Number(previous.classCode!==input.currentClass),previous?[previous]:[],previousReason,"same=0/different=1; not ordinal class strength"),
   feature("sameSurfaceCount",count(same),same,null,"min(same surface starts,3)/3"),
   feature("nearDistanceCount",badDistance?null:count(near),same,badDistance?"unknown matching historical distance":null,"min(same surface +/-200m starts,3)/3"),
   feature("sameSurfaceAge",age(same),same.slice(0,1),same.length?null:"no matching JRA starts","min(days,365)/365"),
   feature("nearDistanceAge",badDistance?null:age(near),badDistance?same:near.slice(0,1),badDistance?"unknown matching historical distance":near.length?null:"no matching JRA distance starts","min(days,365)/365") ]};});
 return frozenClone({...old,horses});
}
function check(input:FeaturedRace){
 assert.equal(input.inputClassificationVersion,RACE_KIND_VERSION);
 developmentDate(input.date);assert(input.horses.length);assert.equal(new Set(input.horses.map(h=>h.horseId)).size,input.horses.length);
 assert.equal(new Set(input.horses.map(h=>h.horseNumber)).size,input.horses.length);
 for(const h of input.horses){assert.deepEqual(h.features.map(f=>f.name),FEATURES);
  for(const f of h.features){assert(f.value===null||Number.isFinite(f.value));for(const r of f.sourceRows)
   assert(isoDate(r.date)<input.date&&r.raceId!==input.raceId,"Future feature");}}
}
export const vector=(h:FeaturedRace["horses"][number],means:number[])=>[...h.features.map((f,i)=>(f.value??means[i])-means[i]),...h.features.map(f=>Number(f.value===null))];
export type Artifact={settings:typeof SETTINGS;features:string[];inputClassificationVersion:string;probabilityEvent:"top3";means:number[];weights:number[];intercept:number;
 trainedThroughDate:string;trainingRaceIds:string[];trainingSha256:string;labelsSha256:string;trace:{step:number;loss:number;gradientNorm:number}[]};
export function train(examples:Example[],cutoff:string):Artifact {
 developmentDate(cutoff);assert(examples.length);assert.equal(new Set(examples.map(e=>e.input.raceId)).size,examples.length);
 const ordered=[...examples].sort((a,b)=>a.input.date.localeCompare(b.input.date)||a.input.raceId.localeCompare(b.input.raceId));
 for(const e of ordered){check(e.input);assert(e.input.date<=cutoff);assert.deepEqual(example(e.input,{raceId:e.input.raceId,date:e.input.date,
  horses:e.labels.map(l=>({horseId:l.horseId,horseNumber:e.input.horses.find(h=>h.horseId===l.horseId)!.horseNumber,positionRaw:l.raw}))} as never,cutoff).labels,e.labels);}
 const means=FEATURES.map((_,i)=>{const xs=ordered.flatMap(e=>e.input.horses.map(h=>h.features[i].value)).filter((v):v is number=>v!==null);assert(xs.length,"All-missing training column");return xs.reduce((a,b)=>a+b,0)/xs.length;});
 const rows=ordered.map(e=>({x:e.input.horses.map(h=>vector(h,means)),y:e.labels.map(l=>l.y)}));
 let intercept=0;const weights=Array<number>(FEATURES.length*2).fill(0),trace:Artifact["trace"]=[];
 for(let step=0;step<=SETTINGS.iterations;step++){const grad=weights.map(w=>SETTINGS.l2*w);let bias=0,loss=SETTINGS.l2/2*weights.reduce((a,w)=>a+w*w,0);
  for(const r of rows)r.x.forEach((x,i)=>{const z=intercept+x.reduce((a,v,j)=>a+v*weights[j],0),s=1/(rows.length*r.x.length),d=(sigmoid(z)-r.y[i])*s;
   loss+=bce(z,r.y[i])*s;bias+=d;x.forEach((v,j)=>grad[j]+=d*v);});
  const gradientNorm=Math.sqrt(bias*bias+grad.reduce((a,g)=>a+g*g,0));assert([loss,gradientNorm,intercept,...weights].every(Number.isFinite));trace.push({step,loss,gradientNorm});
  if(step<SETTINGS.iterations){intercept-=SETTINGS.learningRate*bias;weights.forEach((w,j)=>weights[j]=w-SETTINGS.learningRate*grad[j]);}}
 return frozenClone({settings:SETTINGS,features:FEATURES,inputClassificationVersion:ordered[0].input.inputClassificationVersion,probabilityEvent:"top3",means,weights,intercept,trainedThroughDate:cutoff,
  trainingRaceIds:ordered.map(e=>e.input.raceId),trainingSha256:sha256(ordered),labelsSha256:sha256(ordered.map(e=>({raceId:e.input.raceId,labels:e.labels}))),trace});
}
export function predict(a:Artifact,input:FeaturedRace){
 assert.equal(a.probabilityEvent,"top3");
 check(input);assert.deepEqual(a.settings,SETTINGS);assert.deepEqual(a.features,FEATURES);assert.equal(a.weights.length,FEATURES.length*2);assert.equal(a.means.length,FEATURES.length);
 assert.equal(a.inputClassificationVersion,input.inputClassificationVersion);assert(input.date>a.trainedThroughDate&&!a.trainingRaceIds.includes(input.raceId),"Future/in-sample model");
 const p=input.horses.map(h=>{const x=vector(h,a.means),n=FEATURES.length,reasons=x.map((v,j)=>{const f=h.features[j%n];return {name:j<n?f.name:f.name+":missing",value:f.value,
  contribution:v*a.weights[j],unit:f.unit,missingReason:f.missingReason,sourceRows:f.sourceRows,trainingMean:a.means[j%n],weight:a.weights[j],transformed:v,details:f.details??null};});
  const rawLogit=a.intercept+reasons.reduce((s,r)=>s+r.contribution,0),rawTop3Probability=sigmoid(rawLogit);assert(Number.isFinite(rawLogit)&&Number.isFinite(rawTop3Probability));
  return {horseId:h.horseId,horseNumber:h.horseNumber,rawLogit,rawTop3Probability,intercept:a.intercept,probabilityEvent:"top3" as const,calibrationStatus:"uncalibrated" as const,reasons};
 }).sort((x,y)=>y.rawLogit-x.rawLogit||x.horseNumber-y.horseNumber);
 return frozenClone(p.map((h,i)=>({...h,rank:i+1,mark:["◎","○","▲","△"][i]??null})));
}
