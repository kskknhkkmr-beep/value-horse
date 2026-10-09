/** Development-only quality audit. No predictions or performance metrics. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "lib", "backfill-stage1");
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const source = Object.values(read(join(process.cwd(), "lib", "backfill", "races.json")).races) as Array<{
  netKeibaRaceId: string; date: string; horses: Array<{ horseId: string }>;
}>;
if (source.length !== 1338 || source.some((r) => r.date < "2026-02-07" || r.date > "2026-06-21")) {
  throw new Error("Development input mismatch");
}
const races = read(join(root, "race-details-raw.json")).races;
const horses = read(join(root, "horse-history-raw.json")).horses;
const sourceHorseIds = new Set(source.flatMap((r) => r.horses.map((h) => h.horseId)));
const errors: string[] = [];
const extraStatuses: Record<string, number> = {};
let resultHorseRows = 0;
if (Object.keys(races).length !== 1338 || Object.keys(horses).length !== 7851) errors.push("Collection count mismatch");
for (const id of Object.keys(horses)) if (!sourceHorseIds.has(id)) errors.push(`Extra horse ${id}`);
for (const id of sourceHorseIds) if (!horses[id]) errors.push(`Missing horse ${id}`);
for (const r of source) {
  const collected = races[r.netKeibaRaceId];
  if (!collected || collected.date !== r.date) { errors.push(`Missing/date mismatch ${r.netKeibaRaceId}`); continue; }
  const ids = new Set<string>(collected.horses.map((h: { horseId: string }) => h.horseId));
  if (ids.size !== collected.horses.length) errors.push(`Duplicate horse ${r.netKeibaRaceId}`);
  for (const h of r.horses) if (!ids.has(h.horseId)) errors.push(`Missing entry ${r.netKeibaRaceId}/${h.horseId}`);
  const sourceIds = new Set(r.horses.map((h) => h.horseId));
  for (const h of collected.horses) if (!sourceIds.has(h.horseId)) {
    const status = h.result.positionRaw ?? "missing";
    extraStatuses[status] = (extraStatuses[status] ?? 0) + 1;
    if (!/^(取|除)/.test(status)) errors.push(`Unexpected extra ${r.netKeibaRaceId}/${h.horseId}`);
  }
  for (const [kind, length] of [["sanfuku", 3], ["santan", 3], ["umaren", 2], ["umatan", 2], ["wide", 2]] as const) {
    for (const e of collected.labels.payouts[kind].entries) {
      if (e.combo.length !== length || new Set(e.combo).size !== length ||
          e.combo.some((n: number) => !Number.isInteger(n) || n < 1 || n > 18) ||
          !Number.isInteger(e.payout) || e.payout <= 0) errors.push(`Invalid payout parse ${r.netKeibaRaceId}/${kind}`);
    }
  }
  resultHorseRows += collected.horses.length;
}
let historyRows = 0;
for (const id of Object.keys(horses)) for (const row of horses[id].rows) {
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(row.date) || row.date > "2026/06/21") errors.push(`Invalid history date ${id}`);
  historyRows++;
}
const failurePath = join(root, "checkpoint", "failures.jsonl");
const failures = existsSync(failurePath) ? readFileSync(failurePath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((s) => JSON.parse(s)) : [];
const unresolved = failures.filter((f) => f.type === "horse" ? !horses[f.id] : !races[f.id]);
console.log(JSON.stringify({ developmentRaces: source.length,
  sourceStarts: source.reduce((n, r) => n + r.horses.length, 0),
  uniqueHorses: sourceHorseIds.size, resultHorseRows, extraCancelledOrExcluded: extraStatuses,
  historyRows, failureEvents: failures.length, unresolvedFailures: unresolved.length, errors }, null, 2));
if (errors.length || unresolved.length) process.exitCode = 1;
