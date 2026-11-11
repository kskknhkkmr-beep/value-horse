import assert from "node:assert/strict";
import { test } from "node:test";
import { describe,diagnose,distribution,featureComparison,popularityBand,validate,wilson,type AxisRow } from "./stage1-top3-v2-axis-core";
const names=["recentFinish","surfaceFinish","distanceFinish","historyCount","restDays","cornerPosition","weightChange","classExperience","previousClassChanged","sameSurfaceCount","nearDistanceCount","sameSurfaceAge","nearDistanceAge"];
function row(id=1,good=true,popularity:number|null=2,q=.30):AxisRow {
 const features=names.map(name=>({name,value:.5 as number|null,contribution:0,missingReason:null as string|null,sourceCount:3}));
 features[6].value=0;features[9].value=1/3;features[10].value=1/3;features[11].value=28/365;features[12].value=84/365;
 const allHorseCounts=Array.from({length:6},()=>({flatRows:4,actualFlatStarts:3,validFlatRows:3,recentUsed:3,missingCount:0}));
 const settlement={kind:"fuku" as const,horses:[2],stakeYen:1000,status:good?"win" as const:"loss" as const,returnYen:good?1200:0,profitYen:good?200:-1000,note:null};
 return {raceId:"2026060303"+String(id).padStart(2,"0"),date:"2026-04-04",time:"10:00",horseId:"2023100002",horseNumber:2,horse:"fixture",positionRaw:good?"2":"6",popularity,
  marketHorseId:"2023100001",marketHorseNumber:1,marketPositionRaw:"1",surface:"芝",distance:1600,classRaw:"3歳未勝利",classCode:"maiden",fieldSize:6,
  score:Math.log(q/(1-q)),q,intercept:Math.log(q/(1-q)),features:[...features,...features.map(f=>({...f,name:f.name+":missing",value:0}))],
  priorRows:5,flatRows:4,actualFlatStarts:3,validFlatRows:3,recentUsed:3,restDays:28,missingCount:0,settlement,marketSettlement:{...settlement,horses:[1],status:"win",returnYen:1100,profitYen:100},allHorseCounts};
}
test("Fixed popularity boundaries and unknowns; diagnostic groups never change picks",()=>{
 assert.deepEqual([1,3,4,5,6,9,10,18,null].map(popularityBand),["1-3","1-3","4-5","4-5","6-9","6-9","10+","10+","unknown"]);
 const rs=[row(),row(2,false,10)],before=JSON.stringify(rs),r=diagnose(rs,20);
 assert.equal(r.popularity.reduce((n,g)=>n+g.summary.races,0),2);assert.equal(r.divergence.find(g=>g.name==="market4+")!.summary.races,1);
 assert.equal(r.divergence.find(g=>g.name==="market6+")!.summary.races,1);assert.equal(JSON.stringify(rs),before);
});
test("True median/quantiles, missing denominator, and empty-group Wilson remain explicit",()=>{
 assert.equal(distribution([1,2,3,4,null]).median,2.5);assert.equal(distribution([null]).mean,null);assert.equal(wilson(0,0),null);
 assert.equal(wilson(0,10)![0],0);assert(wilson(10,10)![0]>.7);assert.throws(()=>wilson(11,10));
});
test("Top3 distinct from fuku; specials retained in failures and paired race comparison",()=>{
 const a=row(),b=row(2,false);a.positionRaw="3";a.settlement={...a.settlement,status:"loss",returnYen:0,profitYen:-1000};b.positionRaw="中止";
 const d=describe([a,b]);assert.equal(d.success,1);assert.equal(d.special,1);const r=diagnose([a,b],20);
 assert.equal(r.popularity[0].axisAccount.hitRaces,0);assert.equal(r.overall.summary.failure,1);assert.equal(r.overall.paired.right.top3,2);
});
test("Zero/one/two/three experience differs from capped model usage; freshness boundary exact",()=>{
 const rs=[0,1,2,12].map((n,i)=>({...row(i+1,i%2===0),priorRows:n+2,flatRows:n,actualFlatStarts:n,validFlatRows:n,recentUsed:Math.min(n,3)}));
 const r=diagnose(rs,20);assert.deepEqual(r.experience.map(g=>g.summary.races),[1,1,1,1]);
 assert.equal(r.conditions.surfaceAge[0].band,"0-28");assert.equal(r.conditions.distanceAge[0].band,"29-84");
});
test("13 raw and 13 missing indicators compared separately, independent group bootstrap deterministic",()=>{
 const a=row(),b=row(2,false);b.features[0].value=null;b.features[0].missingReason="no prior history";b.features[13].value=1;b.missingCount=1;
 const f=featureComparison([a,b],30);assert.deepEqual(f,featureComparison([a,b],30));assert.equal(f.length,26);
 assert.equal(f[0].failure.missing,1);assert.equal(f[0].ci95,null);assert.deepEqual(f[13].ci95,[-1,-1]);
});
test("Reject duplicate races, wrong indicators, leaked dates, invalid probability or logit attribution",()=>{
 const a=row();assert.throws(()=>validate([a,a]));assert.throws(()=>validate([{...a,date:"2026-06-27"}]));
 assert.throws(()=>validate([{...a,q:NaN}]));assert.throws(()=>validate([{...a,score:a.score+1}]));
 const b=row(2,false);b.features[13].value=1;assert.throws(()=>validate([b]));
});
test("Score bins include all 20 intervals; high-score failures and low-score success examples not performance-selected",()=>{
 const rs=[row(1,true,4,.20),row(2,false,2,.40)];const r=diagnose(rs,20);
 assert.equal(r.scoreBands.length,20);assert.equal(r.scoreBands.reduce((n,b)=>n+b.races,0),2);
 assert.equal(r.cases.highQFailure?.raceId,rs[1].raceId);assert.equal(r.cases.lowQSuccess?.raceId,rs[0].raceId);
 assert(r.cases.failure.length<=15&&r.cases.success.length<=10);
});
test("ROI sensitivity removes same race from VH and market and never invents extra hits",()=>{
 const r=diagnose([row(),row(2,false)],20),g=r.popularity[0];assert.equal(g.sensitivity[0].axis.betRaces,g.sensitivity[0].market.betRaces);
 assert.equal(g.sensitivity[0].axis.hitRaces,0);assert.equal(g.sensitivity[0].removed.length,1);
 assert.equal(r.popularity[1].summary.successRate,null);assert.equal(r.popularity[1].axisAccount.roiNet,null);
});
