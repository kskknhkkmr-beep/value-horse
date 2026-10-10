/** Accounting on a pre-fixed common cohort; no training or feature selection. */
import assert from "node:assert/strict";
import { compare } from "./stage1-first-audit-core";
import type { AuditRow, Outcome } from "./stage1-first-audit-core";
import { pairedRateCI } from "./stage1-v2-audit-core";
import { pairedAccounts, changedPick, outcomeGroups, firstExamples } from "./stage1-v2-diagnosis-core";
export const MODELS=["A","B","C","D"] as const;
export const KEYS=[...MODELS,"market"] as const;
export type Key=typeof KEYS[number];
export type Row={raceId:string;date:string;archivedStartTime:string|null;selections:Record<Key,Outcome>};
export function pair(rows:Row[],left:Key,right:Key):AuditRow[] {
 return rows.map(r=>({raceId:r.raceId,date:r.date,archivedStartTime:r.archivedStartTime,
 independent:r.selections[left],vh:r.selections[right],market:r.selections.market}));
}
export function accounts(rows:Row[]) {
 return Object.fromEntries(KEYS.map(k=>[k,{...pairedAccounts(pair(rows,k,k)).v2,top3:rows.filter(r=>r.selections[k].top3).length}])) as Record<Key,ReturnType<typeof pairedAccounts>["v2"] & {top3:number}>;
}
export function comparisons(rows:Row[]) {
 assert(rows.length>0 && new Set(rows.map(r=>r.raceId)).size===rows.length);
 const combinations: [Key,Key][]=[];
 MODELS.forEach((right,i)=>MODELS.slice(i+1).forEach(left=>combinations.push([left,right])));
 MODELS.forEach(left=>combinations.push([left,"market"]));
 return combinations.map(([left,right])=>{
  const xs=pair(rows,left,right),changed=xs.filter(changedPick),groups=outcomeGroups(changed);
  return {left,right,win:pairedRateCI(xs,"independent","vh"),money:compare(xs,"independent","vh"),
   changedCount:changed.length,changed:pairedAccounts(changed),
   changedOutcomes:Object.fromEntries(Object.entries(groups).map(([name,g])=>[name,{n:g.length,below20Hits:Math.min(g.filter(r=>r.independent!.win).length,g.filter(r=>r.vh!.win).length)<20}])),
   examples:firstExamples(xs)};
 });
}
export function sensitivity(rows:Row[]) {
 const value=(r:Row)=>Math.max(...MODELS.map(k=>r.selections[k].settlement.returnYen!));
 const ordered=rows.filter(r=>value(r)>0).sort((a,b)=>value(b)-value(a)||a.date.localeCompare(b.date)||a.raceId.localeCompare(b.raceId));
 return [1,2].map(k=>{
  const removed=ordered.slice(0,k),ids=new Set(removed.map(r=>r.raceId));
  return {requested:k,removed:removed.map(r=>({raceId:r.raceId,date:r.date,returns:Object.fromEntries(KEYS.map(key=>[key,r.selections[key].settlement.returnYen]))})),
   remainingIds:rows.filter(r=>!ids.has(r.raceId)).map(r=>r.raceId),accounts:accounts(rows.filter(r=>!ids.has(r.raceId)))};
 });
}
