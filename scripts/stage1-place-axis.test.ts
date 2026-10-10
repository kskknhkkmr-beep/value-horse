import assert from "node:assert/strict";
import { test } from "node:test";
import { settleTicket } from "./simulator/settlement";
import type { Truth } from "./simulator/types";
import { cohort,describe,finish,pair,resolved,type Row,type Pick } from "./stage1-place-axis-core";
import { noLinks } from "./stage1-feature-ablation-reference";
const truth=():Truth=>({raceId:"202606030301",date:"2026-04-04",archivedStartTime:"10:05",
 horses:[1,2,3,4].map(n=>({horseId:String(n),horseNumber:n,positionRaw:String(n),raceTimeRaw:null,marginRaw:null,
 final3fRaw:null,cornerPositionsRaw:null,finalOddsRaw:null,popularity:n})),
 payouts:Object.fromEntries(["tan","fuku","wide","umaren","umatan","sanfuku","santan"].map(k=>[k,{
 status:"ok",rawCombination:null,rawPayout:null,entries:k==="fuku"?[{horse:1,payout:120},{horse:2,payout:210}]:[{horse:1,payout:200}]}])) as Truth["payouts"]});
function pick(n:number,t=truth()):Pick {return {horseId:String(n),horseNumber:n,positionRaw:t.horses[n-1].positionRaw,popularity:n,
 tan:settleTicket({kind:"tan",horses:[n],stakeYen:1000},t),fuku:settleTicket({kind:"fuku",horses:[n],stakeYen:1000},t)}}
const row=(id:string,a=1,b=2,c=3):Row=>({raceId:id,date:"2026-04-04",archivedStartTime:"10:05",picks:{A:pick(a),B:pick(b),C:pick(c)}});
test("top3 is not fuku hit in two-place race",()=>{const r=row("1",3,3,3),d=describe([r],"B");assert.equal(d.top3,1);assert.equal(d.fuku.hitRaces,0);assert.equal(d.fuku.profitYen,-1000)});
test("actual 100-yen payout, three places and dead heat entries preserved",()=>{const t=truth();t.payouts.fuku.entries.push({horse:3,payout:300},{horse:4,payout:400});t.horses[3].positionRaw="3";
 assert.equal(pick(3,t).fuku.returnYen,3000);assert.equal(pick(4,t).fuku.returnYen,4000)});
test("missing, malformed and cancellation are unresolved, never losing",()=>{const t=truth();t.payouts.fuku.status="missing";assert.equal(pick(1,t).fuku.status,"unresolved");
 const r=row("1");r.picks.A!.fuku=pick(1,t).fuku;assert.equal(resolved([r],["A","B","C"]).length,0);assert.throws(()=>describe([r],"A"));
 t.payouts.fuku.status="ok";t.horses[0].positionRaw="取消";assert.equal(pick(1,t).fuku.status,"unresolved");
 t.horses[0].positionRaw="1";t.payouts.fuku.rawPayout="120";assert.equal(pick(1,t).fuku.status,"unresolved")});
test("verified refund excluded from risk and miss streak",()=>{const t=truth();t.refunds=[{kind:"fuku",horses:[1],evidence:"verified"}];const r=row("1");r.picks.A=pick(1,t);
 const d=describe([r],"A");assert.equal(d.fuku.refundYen,1000);assert.equal(d.fuku.riskedYen,0);assert.equal(d.fuku.maxNoHitStreak,0)});
test("special finishes not falsely grouped as 4+",()=>{assert.equal(finish("中止"),"unknown");assert.equal(finish("取消"),"cancelled");assert.equal(finish("除外"),"excluded");assert.equal(finish("18"),"4+");assert.equal(finish(null),"unknown")});
test("paired common cohort required and duplicate races rejected",()=>{const r=row("1");delete r.picks.A;assert.throws(()=>pair([r],"A","B"));assert.throws(()=>pair([row("1"),row("1")],"B","C"))});
test("paired bootstrap deterministic and identical picks zero",()=>{const rs=[row("1",1,1,1),row("2",2,2,2)];const p=pair(rs,"B","C",100);
 assert.deepEqual(p,pair(rs,"B","C",100));assert.deepEqual(p!.roiCI,[0,0]);assert.deepEqual(p!.top3CI,[0,0]);assert.equal(p!.fukuTicketJaccard,1)});
test("shared highest payouts removed from every strategy, inputs preserved",()=>{const rs=[row("1",1,1,1),row("2",2,2,2),row("3",3,3,3)],before=JSON.stringify(rs);
 const x=cohort(rs,["A","B","C"]);assert.deepEqual(x.sensitivity[0].removed,["2"]);for(const d of Object.values(x.sensitivity[0].results))assert.equal(d.races,2);assert.equal(JSON.stringify(rs),before)});
test("chronological account includes DD and longest losing streak",()=>{const d=describe([row("3",1),row("1",3),row("2",3)],"A");assert.equal(d.fuku.maxNoHitStreak,2);assert.equal(d.fuku.maxDrawdownYen,2000)});
test("sealed and parent paths rejected before any read",()=>{assert.throws(()=>noLinks(".sealed-data/x"));assert.throws(()=>noLinks("../data"));assert.throws(()=>noLinks("C:/x"))});
test("future dates forbidden by settlement",()=>{const t=truth();t.date="2026-06-27";assert.throws(()=>pick(1,t))});
