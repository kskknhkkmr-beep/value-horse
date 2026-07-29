/**
 * 是正案②の検証用: 騎手の生スタッツ(wins/rides/places)を取得して退避する。
 * scores-cache には clamp 済み jockeyScore しか無く、40/95 に張り付いた値からは
 * 元の raw を復元できないため、騎手単位で取り直す。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchJockeyStats } from "../lib/scraper";
import type { RacesCache } from "./fetch-races";
import type { JockeyStats } from "../lib/scorer";

const SP = "scripts/_cache";

function loadJSON<T>(f: string): T | null {
  const p = join(process.cwd(), "lib", f);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

async function main() {
  const racesCache = loadJSON<RacesCache>("races-cache.json")!;
  const jockeys = new Map<string, string>();
  for (const r of racesCache.races) {
    if (r.entriesPending || !r.horses.length) continue;
    for (const h of r.horses) if (h.jockeyId) jockeys.set(h.jockeyId, h.jockey ?? "");
  }

  const out: Record<string, (JockeyStats & { name: string }) | null> = {};
  const outPath = `${SP}/jockey_raw.json`;
  if (existsSync(outPath)) Object.assign(out, JSON.parse(readFileSync(outPath, "utf-8")));

  const todo = [...jockeys].filter(([id]) => !(id in out));
  console.log(`騎手 ${jockeys.size} 人（未取得 ${todo.length} 人・推定 ${Math.round((todo.length * 1.3) / 60)} 分）`);

  let done = 0;
  for (const [id, name] of todo) {
    const s = await fetchJockeyStats(id);
    out[id] = s ? { ...s, name } : null;
    done++;
    if (done % 20 === 0) {
      console.log(`  ${done}/${todo.length}`);
      writeFileSync(outPath, JSON.stringify(out), "utf-8");
    }
  }
  writeFileSync(outPath, JSON.stringify(out), "utf-8");
  const ok = Object.values(out).filter((v) => v != null).length;
  console.log(`\n✓ 完了: ${ok}/${Object.keys(out).length} 人の実データ → ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
