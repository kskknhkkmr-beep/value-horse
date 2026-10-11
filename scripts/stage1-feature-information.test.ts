import assert from "node:assert/strict";
import { test } from "node:test";
import { audit,FEATURE_NAMES,finish,overlap,pairedCI,material,describe } from "./stage1-feature-information-core";
import type { Forecast } from "./run-stage1-top3";
import { canonical } from "./simulator/canonical";
import { prior,localRace,explicitClass } from "./stage1-next-feature-audit-core";
import type { Dataset,History,RaceSpec } from "./simulator/types";
test("Numeric fourth or worse is distinct from cancellation, DNF and unknown",()=>{
 for(const raw of [null,"中","取","除","失","**"])assert.equal(finish(raw).category,"special");
 assert.equal(finish("3").top3,1);assert.equal(finish("4").category,"fourPlus");assert.equal(finish("1").win,1);
});
test("Race paired bootstrap is deterministic and preserves zero difference",()=>{
 assert.deepEqual(pairedCI([1,-1,0],200),pairedCI([1,-1,0],200));assert.deepEqual(pairedCI([0,0],200)?.ci95,[0,0]);
 assert.equal(pairedCI([]),null);
});
test("Source identity, not equal numerical score, defines duplicated evidence",()=>{
 const a=[{raceId:"a",date:"2026-02-07"}];assert.equal(overlap(a,a).identicalNonempty,true);
 assert.equal(overlap(a,[{raceId:"b",date:"2026-02-07"}]).jaccard,0);assert.equal(overlap([],[]).identicalNonempty,false);
 const unknown=[{raceId:null,date:"2026-02-07"}];assert.equal(overlap(unknown,unknown).identicalNonempty,false);
 assert.equal(overlap(unknown,unknown).jaccard,null);
});
test("Past audit excludes same day, target ID, future and obstacle histories without mutating input",()=>{
 const race={raceId:"target",date:"2026-06-21",surface:"芝",distance:1600,structuredClass:"one_win"} as RaceSpec;
 const make=(date:string,id:string,surface="芝")=>({date,netKeibaRaceId:id,surface,position:2,positionRaw:"2",fieldSize:10,distance:1600,raceName:"不明"}) as History;
 const histories=[make("2026-06-20","past"),make("2026-06-21","same"),make("2026-06-22","future"),make("2026-06-01","target"),make("2026-06-01","jump","障")];
 const before=canonical(histories);assert.deepEqual(prior(histories,race).map(x=>x.h.netKeibaRaceId),["past"]);
 const data={races:[race],historyByHorse:{horse:histories}} as unknown as Dataset;
 const x=material(data,race,"horse");assert.equal(x.validFinishes,1);assert.equal(x.completeOpponents,0);
 assert.equal(x.classRelation,"unknown");assert.equal(canonical(histories),before);
 assert.throws(()=>localRace(histories[1],race,new Map([["same",{...race,raceId:"same"}]])));
 assert.equal(explicitClass("500万円以下"),null);
});
test("Empty strata have no fabricated rates and serialize without undefined",()=>{
 const x=describe([]);assert.equal(x.n,0);assert.equal(x.top3.market.rate,null);assert.doesNotThrow(()=>canonical(x));
});
test("Saved prediction audit rejects future provenance and incorrect horse-number mapping",()=>{
 const race={raceId:"target",date:"2026-06-21",surface:"芝",distance:1600,starters:[{horseId:"horse",horseNumber:1}]} as RaceSpec;
 const data={races:[race]} as Dataset;
 const forecast={raceId:"target",date:race.date,predictions:[{horseId:"horse",horseNumber:1,rank:1,probabilityEvent:"top3",
  reasons:FEATURE_NAMES.map(name=>({name,value:1,sourceRows:[{date:"2026-06-21",raceId:"sameDay"}]}))}]} as unknown as Forecast;
 assert.throws(()=>audit([forecast],data,{target:race.starters}),/Future source provenance/);
 assert.throws(()=>audit([forecast],data,{target:[{horseId:"horse",horseNumber:2}]}));
});
