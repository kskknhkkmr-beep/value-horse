import test from "node:test";
import assert from "node:assert/strict";
import { prior,explicitClass,completeOpponents,localRace,firstCases,validFinish,confirmedNonStarter } from "./stage1-next-feature-audit-core";
import { assertInputPath } from "./simulator/input";
import type { History,RaceSpec,Truth } from "./simulator/types";
import type { Row } from "./stage1-feature-ablation-audit-core";
const history=(overrides:Partial<History>={}):History=>({netKeibaRaceId:"202605010101",date:"2026-02-07",venue:"東京",
 venueRaw:"1東京1",raceName:"3歳未勝利",weatherRaw:"晴",surface:"芝",distance:1600,trackConditionRaw:"良",
 fieldSize:2,frameNumber:1,horseNumber:1,positionRaw:"1",position:1,marginRaw:null,raceTimeRaw:null,
 cornerPositionsRaw:"1-1",final3fRaw:null,jockey:null,jockeyId:null,carriedWeightRaw:null,horseWeightRaw:null,
 oddsRaw:null,popularity:null,...overrides});
const target={raceId:"202605010201",date:"2026-02-08",surface:"芝",distance:1600,starters:[] } as unknown as RaceSpec;
test("Same-day, future, target-self, jump and unknown histories excluded",()=>{
 const xs=[history(),history({date:"2026-02-08"}),history({date:"2026-02-09"}),history({netKeibaRaceId:target.raceId}),
 history({surface:"障"}),history({surface:null})];assert.deepEqual(prior(xs,target).map(x=>x.index),[0]);
});
test("Strict chronological ordering does not consult odds or finishing ability",()=>{
 const a=history(),b=history({date:"2026-02-06",oddsRaw:"9999",popularity:1});
 assert.deepEqual(prior([b,a],target).map(x=>x.index),[1,0]);
});
test("Ambiguous special race, cash labels and regional classes not guessed",()=>{
 assert.equal(explicitClass("青葉特別"),null);assert.equal(explicitClass("3歳以上500万下"),null);
 assert.equal(explicitClass("C1二"),null);assert.equal(explicitClass(null),null);
 assert.equal(explicitClass("4歳以上2勝クラス"),"two_win");assert.equal(explicitClass("大阪杯(GI)"),"G1");
});
test("Local class join rejects inconsistent historical dates or target day",()=>{
 const h=history();assert.equal(localRace(h,target,new Map()),null);
 assert.throws(()=>localRace(h,target,new Map([[h.netKeibaRaceId!,{...target,date:"2026-02-06"}]])));
 assert.throws(()=>localRace(history({date:target.date}),target,new Map([[h.netKeibaRaceId!,target]])));
});
test("Full opponent set requires date join plus horse ID/number, field size and JRA eligibility",()=>{
 const own={horseId:"2020100001",horseNumber:1},other={horseId:"2020100002",horseNumber:2};
 const linked={...target,raceId:history().netKeibaRaceId!,date:history().date,starters:[own,other]} as RaceSpec;
 assert(completeOpponents(history(),linked,own.horseId));
 assert(!completeOpponents(history({fieldSize:3}),linked,own.horseId));
 assert(!completeOpponents(history({horseNumber:2}),linked,own.horseId));
 assert(!completeOpponents(history({venue:"大井"}),linked,own.horseId));
 assert(!completeOpponents(history(),null,own.horseId));
});
test("Chronological examples are invariant to prices and input ordering",()=>{
 const row=(id:string,date:string):Row=>({raceId:id,date,archivedStartTime:null,
 selections:{D:{horseId:"d",win:false,place:false,popularity:2,finalOdds:10},
 market:{horseId:"m",win:true,place:true,popularity:1,finalOdds:1}} as Row["selections"]});
 const rows=[row("4","2026-04-08"),row("2","2026-04-06"),row("1","2026-04-05"),row("3","2026-04-07")];
 assert.deepEqual(firstCases(rows).marketWinsDOut.first.map(x=>x.raceId),["1","2","3"]);
 rows[2].selections.D.finalOdds=1000;rows[2].selections.D.popularity=18;
 assert.deepEqual(firstCases([...rows].reverse()).marketWinsDOut.first.map(x=>x.raceId),["1","2","3"]);
});
test("Non-starters / unknown finishes are not valid support",()=>{
 assert(validFinish(history()));assert(!validFinish(history({positionRaw:"中",position:null})));
 assert(!validFinish(history({fieldSize:1})));
});
test("Absent historical starter requires matching cancellation evidence, not silent ID substitution",()=>{
 const truth={horses:[{horseId:"2020100001",horseNumber:1,positionRaw:"取"}]} as Truth;
 assert(confirmedNonStarter(history({positionRaw:"取",position:null}),"2020100001",truth));
 assert(!confirmedNonStarter(history({positionRaw:"除",position:null}),"2020100001",truth));
 assert(!confirmedNonStarter(history({positionRaw:"取",horseNumber:2}),"2020100001",truth));
 assert(!confirmedNonStarter(history({positionRaw:"取"}),"2020100002",truth));
});
test("Sealed/full-source paths rejected before filesystem access",()=>{
 assert.throws(()=>assertInputPath(".sealed-data/anything.json"));
 assert.throws(()=>assertInputPath("lib/backfill/../other.json"));
});
