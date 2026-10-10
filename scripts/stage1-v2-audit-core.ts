/** Fixed development diagnostics; never fits or chooses features. */
import type { AuditRow, Strategy } from "./stage1-first-audit-core";
export function pairedRateCI(rows: AuditRow[], left: Strategy, right: Strategy, field: "win" | "place" = "win") {
  if (!rows.length || rows.some(r=>!r[left]||!r[right])) throw new Error("Incomplete paired rate cohort");
  const differences=rows.map(r=>Number(r[left]![field])-Number(r[right]![field]));
  let seed=20261010;
  const samples=Array.from({length:10000},()=>{let total=0;
    for(let i=0;i<rows.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;total+=differences[Math.floor(seed/4294967296*rows.length)];}
    return total/rows.length;
  }).sort((a,b)=>a-b);
  return { difference:differences.reduce((a,b)=>a+b,0)/rows.length,
    ci95:[samples[Math.floor((samples.length-1)*.025)],samples[Math.floor((samples.length-1)*.975)]],seed:20261010,iterations:10000 };
}
