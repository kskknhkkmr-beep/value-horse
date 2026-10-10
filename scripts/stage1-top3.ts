/** Independent marginal Top3 model. No market or filesystem access. */
import assert from "node:assert/strict";
import { developmentDate, frozenClone, isoDate, sha256 } from "./simulator/canonical";
import { RACE_KIND_VERSION } from "./simulator/race-kind";
import type { Truth } from "./simulator/types";
import { FEATURES, SETTINGS as V2, type FeaturedRace } from "./stage1-independent-v2";
export const SETTINGS = frozenClone({ version: "stage1-independent-top3-v1", iterations: V2.iterations,
 learningRate: V2.learningRate, l2: V2.l2, objective: "race-average horse-average BCE",
 calibrationStatus: "uncalibrated", probabilityEvent: "top3", seed: 20261011 });
export function label(raw: string|null, fieldSize: number): 0|1 {
 if(raw && /^[1-9][0-9]*$/.test(raw)) {assert(Number(raw)<=fieldSize,"Rank outside field");return Number(raw)<=3?1:0;}
 if(["中","中止","失","失格"].includes(raw??""))return 0;
 throw new Error("Unknown/non-starter Top3 label: "+String(raw));
}
export type Example={input:FeaturedRace; labels:{horseId:string;raw:string|null;y:0|1}[]};
export function example(input:FeaturedRace,truth:Truth,cutoff:string):Example {
 developmentDate(input.date);developmentDate(cutoff);
 assert(input.date<=cutoff && truth.date===input.date && truth.raceId===input.raceId,"Training date/ID");
 assert.equal(input.inputClassificationVersion,RACE_KIND_VERSION);
 assert.equal(new Set(input.horses.map(h=>h.horseId)).size,input.horses.length);
 assert.equal(new Set(input.horses.map(h=>h.horseNumber)).size,input.horses.length);
 assert.equal(new Set(truth.horses.map(h=>h.horseId)).size,truth.horses.length);
 assert.equal(new Set(truth.horses.map(h=>h.horseNumber)).size,truth.horses.length);
 for(const h of truth.horses) if(!input.horses.some(s=>s.horseId===h.horseId))
  assert(["取","除","取消","除外"].includes(h.positionRaw??""),"Unmatched starter/result");
 return {input,labels:input.horses.map(h=>{const t=truth.horses.find(x=>x.horseId===h.horseId);
  assert(t && t.horseNumber===h.horseNumber,"Starter/truth ID mismatch");return {horseId:h.horseId,raw:t.positionRaw,y:label(t.positionRaw,input.horses.length)};})};
}
export const sigmoid=(z:number)=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
export const bce=(z:number,y:number)=>Math.max(z,0)-y*z+Math.log1p(Math.exp(-Math.abs(z)));
export function vector(h:FeaturedRace["horses"][number],means:number[]) {
 assert.deepEqual(h.features.map(f=>f.name),[...FEATURES]);assert.equal(means.length,7);
 return [...h.features.map((f,i)=>(f.value??means[i])-means[i]),...h.features.map(f=>Number(f.value===null))];
}
export type Artifact={settings:typeof SETTINGS;probabilityEvent:"top3";inputClassificationVersion:string;
 features:readonly string[];means:number[];weights:number[];intercept:number;trainedThroughDate:string;
 trainingRaceIds:string[];trainingSha256:string;labelsSha256:string;trace:{step:number;loss:number;gradientNorm:number}[]};
export function train(examples:Example[],cutoff:string):Artifact {
 developmentDate(cutoff);assert(examples.length);assert.equal(new Set(examples.map(e=>e.input.raceId)).size,examples.length);
 const ordered=[...examples].sort((a,b)=>a.input.date.localeCompare(b.input.date)||a.input.raceId.localeCompare(b.input.raceId));
 for(const e of ordered){assert(e.input.date<=cutoff);assert.equal(e.input.inputClassificationVersion,RACE_KIND_VERSION);
  assert.deepEqual(e.labels.map(l=>l.horseId),e.input.horses.map(h=>h.horseId));
  for(const l of e.labels)assert.equal(l.y,label(l.raw,e.labels.length));
  for(const h of e.input.horses)for(const f of h.features){assert(f.value===null||Number.isFinite(f.value));
   for(const r of f.sourceRows)assert(isoDate(r.date)<e.input.date&&r.raceId!==e.input.raceId,"Future feature");}}
 const means=FEATURES.map((_,i)=>{const values=ordered.flatMap(e=>e.input.horses.map(h=>h.features[i].value)).filter((v):v is number=>v!==null);
  assert(values.length);return values.reduce((a,b)=>a+b,0)/values.length;});
 const rows=ordered.map(e=>({x:e.input.horses.map(h=>vector(h,means)),y:e.labels.map(l=>l.y)}));
 let intercept=0;const weights=Array<number>(14).fill(0),trace:Artifact["trace"]=[];
 for(let step=0;step<=SETTINGS.iterations;step++){
  const grad=weights.map(w=>SETTINGS.l2*w);let bias=0,loss=SETTINGS.l2/2*weights.reduce((a,w)=>a+w*w,0);
  for(const r of rows)r.x.forEach((x,i)=>{const z=intercept+x.reduce((a,v,j)=>a+v*weights[j],0),s=1/(rows.length*r.x.length),d=(sigmoid(z)-r.y[i])*s;
   loss+=bce(z,r.y[i])*s;bias+=d;x.forEach((v,j)=>grad[j]+=d*v);});
  const gradientNorm=Math.sqrt(bias*bias+grad.reduce((a,g)=>a+g*g,0));
  assert([loss,gradientNorm,intercept,...weights].every(Number.isFinite),"Numerical failure");trace.push({step,loss,gradientNorm});
  if(step<SETTINGS.iterations){intercept-=SETTINGS.learningRate*bias;weights.forEach((w,j)=>weights[j]=w-SETTINGS.learningRate*grad[j]);}
 }
 return frozenClone({settings:SETTINGS,probabilityEvent:"top3",inputClassificationVersion:RACE_KIND_VERSION,features:FEATURES,
  means,weights,intercept,trainedThroughDate:cutoff,trainingRaceIds:ordered.map(e=>e.input.raceId),
  trainingSha256:sha256(ordered),labelsSha256:sha256(ordered.map(e=>({raceId:e.input.raceId,labels:e.labels}))),trace});
}
export function predict(artifact:Artifact,input:FeaturedRace) {
 assert.deepEqual(artifact.settings,SETTINGS);assert.equal(artifact.probabilityEvent,"top3");
 assert.equal(artifact.inputClassificationVersion,RACE_KIND_VERSION);assert.equal(input.inputClassificationVersion,RACE_KIND_VERSION);
 developmentDate(input.date);assert(input.date>artifact.trainedThroughDate&&!artifact.trainingRaceIds.includes(input.raceId),"In-sample/future model");
 assert.deepEqual(artifact.features,[...FEATURES]);assert.equal(artifact.weights.length,14);
 const predictions=input.horses.map(h=>{for(const f of h.features)for(const r of f.sourceRows)
  assert(isoDate(r.date)<input.date&&r.raceId!==input.raceId,"Future prediction feature");
  const x=vector(h,artifact.means),reasons=x.map((v,j)=>{const f=h.features[j%7];return {name:j<7?f.name:f.name+":missing",
   contribution:v*artifact.weights[j],value:f.value,unit:f.unit,missingReason:f.missingReason,sourceRows:f.sourceRows,
   trainingMean:artifact.means[j%7],weight:artifact.weights[j],transformed:v,details:f.details??null};});
  const rawLogit=artifact.intercept+reasons.reduce((a,r)=>a+r.contribution,0),rawTop3Probability=sigmoid(rawLogit);
  assert(Number.isFinite(rawLogit)&&rawTop3Probability>=0&&rawTop3Probability<=1);
  return {horseId:h.horseId,horseNumber:h.horseNumber,rawLogit,rawTop3Probability,intercept:artifact.intercept,
   probabilityEvent:"top3" as const,calibrationStatus:"uncalibrated" as const,reasons};
 }).sort((a,b)=>b.rawLogit-a.rawLogit||a.horseNumber-b.horseNumber);
 assert.equal(new Set(predictions.map(p=>p.horseId)).size,input.horses.length);
 return frozenClone(predictions.map((p,i)=>({...p,rank:i+1,mark:["◎","○","▲","△"][i]??null})));
}
