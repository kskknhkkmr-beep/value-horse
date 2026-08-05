/**
 * 検証: バックフィルで遡及導出したスコアが、本番がレース前にライブで算出した
 * スコアと一致するか。
 *
 * 本番の scores-cache.json は「レース前」に計算された値なので、定義上リークが無い。
 * 遡及導出がこれを再現できるなら、cutoff が正しく効いていることの強い証拠になる。
 * 逆に formScore が系統的に高く出るなら、レース後の走りが混入している。
 *
 * 併せて、確定単勝オッズ（バックフィルで取得可能な唯一のオッズ）と
 * 本番が保存した発走前オッズのズレも実測する。
 *
 * 使い方: npx tsx scripts/_verify-backfill-vs-live.ts --dir=lib/backfill-test
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HorseScores } from "../lib/scorer";
import type { RacesCache } from "./fetch-races";

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const DIR = arg("dir") ?? "lib/backfill";

function load<T>(dir: string, file: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), dir, file), "utf-8")) as T;
}

type ScoresFile = { scores: Record<string, HorseScores> };

function stats(xs: number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const q = (p: number) => s[Math.floor(p * (s.length - 1))];
  return { n: s.length, mean, p05: q(0.05), p50: q(0.5), p95: q(0.95), min: s[0], max: s[s.length - 1] };
}

function show(label: string, xs: number[], exactZero: number) {
  const st = stats(xs);
  if (!st) return console.log(`${label}: 比較対象なし`);
  console.log(
    `${label.padEnd(14)} n=${String(st.n).padStart(4)} 完全一致=${((exactZero / st.n) * 100).toFixed(1)}% ` +
      `平均差 ${st.mean >= 0 ? "+" : ""}${st.mean.toFixed(2)} 中央 ${st.p50} ` +
      `[p05 ${st.p05}, p95 ${st.p95}] 範囲 ${st.min}〜${st.max}`
  );
}

function main() {
  const liveRaces = load<RacesCache>("lib", "races-cache.json");
  const liveScores = load<ScoresFile>("lib", "scores-cache.json").scores;
  const bfRaces = load<RacesCache>(DIR, "races-cache.json");
  const bfScores = load<ScoresFile>(DIR, "scores-cache.json").scores;

  const liveById = new Map(liveRaces.races.map((r) => [r.netKeibaRaceId, r]));

  const dForm: number[] = [];
  const dPed: number[] = [];
  const dJockey: number[] = [];
  const dOddsPct: number[] = [];
  let formExact = 0, pedExact = 0, jockeyExact = 0, oddsExact = 0;
  let matchedRaces = 0, matchedHorses = 0;

  for (const bf of bfRaces.races) {
    const live = liveById.get(bf.netKeibaRaceId);
    if (!live || live.entriesPending) continue;
    matchedRaces++;

    const liveByNum = new Map(live.horses.map((h) => [h.horseNumber, h]));
    for (const bh of bf.horses) {
      const lh = liveByNum.get(bh.horseNumber);
      if (!lh) continue;
      const ls = liveScores[lh.id];
      const bs = bfScores[bh.id];
      if (!ls || !bs) continue;
      // 本番側が v2(実データ)で算出した馬のみ比較（v1 はデフォルト固定なので比較にならない）
      if ((ls.modelVersion ?? "v1") !== "v2") continue;
      matchedHorses++;

      const df = bs.formScore - ls.formScore;
      const dp = bs.pedigreeScore - ls.pedigreeScore;
      dForm.push(df); if (df === 0) formExact++;
      dPed.push(dp); if (dp === 0) pedExact++;

      if (bs.jockeyScore != null && ls.jockeyScore != null) {
        const dj = bs.jockeyScore - ls.jockeyScore;
        dJockey.push(dj); if (dj === 0) jockeyExact++;
      }
      if (bh.odds != null && lh.odds != null && lh.odds > 0) {
        const pct = ((bh.odds - lh.odds) / lh.odds) * 100;
        dOddsPct.push(pct); if (Math.abs(pct) < 1e-9) oddsExact++;
      }
    }
  }

  console.log(`=== バックフィル vs 本番ライブ の一致検証 (dir=${DIR}) ===\n`);
  console.log(`突き合わせ: ${matchedRaces}R / ${matchedHorses}頭（本番側 v2 のみ）\n`);
  console.log("--- スコア差（バックフィル − 本番ライブ）---");
  show("formScore", dForm, formExact);
  show("pedigreeScore", dPed, pedExact);
  console.log("\n--- jockeyScore（定義が違うので一致しないのが正しい）---");
  show("jockeyScore", dJockey, jockeyExact);
  console.log("\n--- 単勝オッズ差 %（確定 − 発走前）---");
  show("odds%", dOddsPct, oddsExact);

  const big = dForm.filter((d) => Math.abs(d) > 5).length;
  console.log(`\nformScore が 5点超ズレた馬: ${big}/${dForm.length} 頭`);
}

main();
