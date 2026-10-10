/** Label-free material audit; never trains or evaluates predictions. */
import assert from "node:assert/strict";
import { loadDevelopment, prepareInput } from "./simulator/input";
import { flatExclusionReason } from "./simulator/race-kind";
import { prepareInputV2 } from "./stage1-v2-input";
import { derive, independentInput } from "./stage1-independent-v2";
import * as base from "./stage1-independent";
const data = loadDevelopment(), counters = ["cornerPosition","weightChange"].map(name => ({ name, n: 0, missing: 0, reasons: {} as Record<string,number>, values: [] as number[] }));
if(process.argv.length!==2) throw new Error("No alternate paths/conditions");
for(const race of data.races.filter(r=>flatExclusionReason(r)===null)){
  const f=derive(independentInput(prepareInputV2(race,data.historyByHorse)));
  const old=base.derive(base.independentInput(prepareInput(race,data.historyByHorse)));
  f.horses.forEach((h,i)=>{
    assert.deepEqual(h.features.slice(0,5).map(x=>x.value),old.horses[i].features.map(x=>x.value));
    counters.forEach((c,j)=>{const x=h.features[5+j]; c.n++; if(x.value===null){c.missing++;const r=x.missingReason!;c.reasons[r]=(c.reasons[r]??0)+1;}else c.values.push(x.value);});
  });
}
console.log(JSON.stringify({ legacyFiveValuesUnchanged: true, fields:counters.map(c=>({ name:c.name,n:c.n,missing:c.missing,missingRate:c.missing/c.n,reasons:c.reasons,min:Math.min(...c.values),max:Math.max(...c.values),used:c.values.length })) },null,2));
