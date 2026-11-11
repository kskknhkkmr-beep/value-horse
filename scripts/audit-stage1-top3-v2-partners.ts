/** One append-only development-only saved forecast diagnosis. Never imports a model runner. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync,mkdirSync,writeFileSync } from "node:fs";
import { bytes,json,noLinks,verifyProtection } from "./stage1-feature-ablation-reference";
import { sha256 } from "./simulator/canonical";
import { KINDS,WAYS,plan,join,diagnose,type Row } from "./stage1-top3-v2-partner-core";
import type { Truth } from "./simulator/types";
import type { Row as SavedRow } from "./stage1-top3-v2-audit";
import type { Plan } from "./stage1-axis-bet-core";
const BASE="lib/simulation-runs/stage1-top3-v2-9ba64d047cfb624b266ceabe8cc27c41a05c95ee22d7e5a29f2add28a80f2acb";
const RAW="lib/backfill-stage1/race-details-raw.json";
const CODE=["scripts/stage1-top3-v2-partner-core.ts","scripts/audit-stage1-top3-v2-partners.ts","scripts/stage1-top3-v2-partner.test.ts"];
function main(){
 assert.equal(process.argv.length,2,"No user supplied data path or tuning arguments");
 const old=json<{sourceHashes:Record<string,string>;protectedHashes:Record<string,string>;reportSha256:string;
  report:{rows:SavedRow[];overall:{bets:Record<string,Record<string,Record<string,unknown>>>}}}>(BASE+"/summary.json");
 assert.equal(old.reportSha256,"a36f2d01e6686b9000e2be648a42ed0d7e361b581b782e39ea43ef1e2c3fc9b7");
 assert.equal(sha256(old.report),old.reportSha256);
 const protectedHashes={...old.protectedHashes,...old.sourceHashes,...Object.fromEntries(["preflight","models","predictions","plans","summary"].map(n=>[BASE+"/"+n+".json",bytes(BASE+"/"+n+".json")])),
  ...Object.fromEntries(["scripts/stage1-top3-v2.ts","scripts/stage1-axis-bet-core.ts","scripts/simulator/settlement.ts"].map(p=>[p,bytes(p)]))};
 verifyProtection(protectedHashes);assert.equal(bytes(RAW),old.sourceHashes[RAW]);
 const codeHashes=Object.fromEntries(CODE.map(p=>[p,bytes(p)])),specHash=bytes("docs/STAGE1_TOP3_V2_PARTNER_AUDIT.md");
 const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
 const id=sha256({parent:old.reportSha256,codeHashes,specHash}),out="lib/simulation-runs/stage1-top3-v2-partners-"+id;
 noLinks(out);assert(!existsSync(out),"Append-only diagnosis already exists");
 const raw=json<{races:Record<string,{netKeibaRaceId:string;date:string;preRace:{postTimeRaw:string|null};horses:{horseId:string;horseNumber:number;horse:string;
  result:{positionRaw:string|null;popularity:number|null}}[];labels:{payouts:Truth["payouts"]}}>}>(RAW).races;
 const prior=json<{raceId:string;date:string;plans:Record<string,Plan>}[]>(BASE+"/plans.json");
 assert.equal(prior.length,742);const plansById=new Map(prior.map(r=>[r.raceId,r]));assert.equal(plansById.size,742);
 assert.equal(old.report.rows.length,742);assert.equal(sha256(old.report.rows.map(r=>r.raceId)),"087f212b172c902c2fdb570d3b340826d0db1ad07a317cb354376f38c05c89aa");
 // Build plans from saved identity/rank arrays only; no outcomes or payouts enter plan().
 const planned=old.report.rows.map(r=>{const plans=plan({raceId:r.raceId,date:r.date,starters:r.orders.C,vh:r.orders.C,market:r.orders.D});
  const p=plansById.get(r.raceId);assert(p&&p.date===r.date);assert.deepEqual(plans.A,p.plans.B);assert.deepEqual(plans.B,p.plans["B-market"]);assert.deepEqual(plans.E,p.plans.C);
  assert.deepEqual(plans.C.tickets.wide,plans.B.tickets.wide);return {raceId:r.raceId,date:r.date,plans};});
 mkdirSync(out);const save=(name:string,x:unknown)=>writeFileSync(out+"/"+name,JSON.stringify(x),{flag:"wx"});
 save("preflight.json",{id,sourceCommit,codeHashes,specHash,parent:old.reportSha256,protectedHashes,performanceViewed:false});
 save("plans.json",planned);assert.equal(sha256(json(out+"/plans.json")),sha256(planned));
 console.log("742 saved axes/rankings and prior A/B/E plans match; fixed mixed plans saved before settlement");
 const rows:Row[]=old.report.rows.map(r=>{const d=raw[r.raceId];assert(d&&d.date===r.date&&d.netKeibaRaceId===r.raceId);
  assert.equal(new Set(d.horses.map(h=>h.horseId)).size,d.horses.length);assert.equal(new Set(d.horses.map(h=>h.horseNumber)).size,d.horses.length);
  const truth:Truth={raceId:r.raceId,date:r.date,archivedStartTime:d.preRace.postTimeRaw,payouts:d.labels.payouts,horses:d.horses.map(h=>({horseId:h.horseId,horseNumber:h.horseNumber,
   positionRaw:h.result.positionRaw,popularity:h.result.popularity,raceTimeRaw:null,marginRaw:null,final3fRaw:null,cornerPositionsRaw:null,finalOddsRaw:null}))};
  const ids=new Set(r.orders.C.map(h=>h.horseId));const market=truth.horses.filter(h=>ids.has(h.horseId)).sort((a,b)=>a.popularity!-b.popularity!||a.horseNumber-b.horseNumber);
  for(const h of market)assert(h.popularity&&h.popularity>0);assert.deepEqual(market.map(h=>({horseId:h.horseId,horseNumber:h.horseNumber})),r.orders.D);
  for(const w of ["C","D"] as const)r.orders[w].forEach((h,i)=>{const t=truth.horses.find(t=>t.horseId===h.horseId);assert(t&&t.horseNumber===h.horseNumber);assert.equal(t.positionRaw,r.outcomes[w][i].raw);});
  return join({raceId:r.raceId,date:r.date,truth,vh:r.orders.C,market:r.orders.D},Object.fromEntries(KINDS.map(k=>[k,{A:r.settlements[k].C,B:r.settlements[k]["C-market"],E:r.settlements[k].D}])) as Parameters<typeof join>[1]);});
 const report=diagnose(rows);
 for(const k of KINDS)for(const[w,prior]of [["A","C"],["B","C-market"],["E","D"]] as const){
  const now=(report.overall[k] as Record<string,Record<string,unknown>>)[w],was=old.report.overall.bets[k][prior];
  for(const key of Object.keys(was))assert.deepEqual(now[key],was[key],"Frozen account drift "+k+"/"+w+"/"+key);}
 verifyProtection(protectedHashes);verifyProtection(codeHashes);assert.equal(bytes("docs/STAGE1_TOP3_V2_PARTNER_AUDIT.md"),specHash);
 const reportHash=sha256(report);save("summary.json",{id,sourceCommit,codeHashes,specHash,parent:old.reportSha256,protectedHashes,reportHash,report,
  constraints:["742 development only; no sealed access or model execution","Fixed final-market diagnostic, not executable pre-race strategy","No adoption/optimization; paired unadjusted intervals"]});
 console.log(JSON.stringify({out,id,reportHash,omissions:report.omissions,overall:report.overall,failure:report.failure,ways:WAYS}));
}
if(require.main===module)main();
