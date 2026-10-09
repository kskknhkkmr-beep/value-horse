import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonl, payoutRow } from "./backfill-enrich-raw";

const directory = mkdtempSync(join(tmpdir(), "value-horse-checkpoint-test-"));
const file = join(directory, "checkpoint.jsonl");
try {
  writeFileSync(file, JSON.stringify({ horseId: "synthetic", rows: [{ date: "2025/01/01" }] }) + "\n");
  assert.equal(readJsonl<{ horseId: string }>(file)[0].horseId, "synthetic");
  writeFileSync(file, "{broken");
  assert.throws(() => readJsonl(file));
} finally {
  unlinkSync(file);
  rmdirSync(directory);
}
const row = (combo: string, amount: string) =>
  `<tr><th class="sanfuku">三連複</th><td>${combo}</td><td>${amount}</td></tr>`;
assert.equal(payoutRow(row("1-2-3<br>1-2-4", "1,000<br>2,000"), "sanfuku", "combo").entries.length, 2);
const multi = payoutRow(row("1-2-3", "1,000") + row("1-2-4", "2,000"), "sanfuku", "combo");
assert.equal(multi.entries.length, 2);
assert.equal(multi.rows?.length, 2);
assert.equal(payoutRow(row("返還", "返還"), "sanfuku", "combo").status, "refund");
assert.equal(payoutRow(row("発売なし", "発売なし"), "sanfuku", "combo").status, "not_offered");
assert.equal(payoutRow("", "sanfuku", "combo").status, "missing");
assert.equal(payoutRow(row("**", "**"), "sanfuku", "combo").status, "unparsed");
console.log("Raw checkpoint and payout regression tests passed (synthetic data only).");
