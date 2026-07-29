/**
 * 仕上げ: (A) TEMP引き上げの効果は本当に「較正の改善」か、それとも単に
 * 高オッズ馬を買わなくなるだけか を ODDS_MAX と分離して確認する。
 * (B) ①②③ の組み合わせを評価する。
 */
import { buildDataset, applyJockeyMode, scoreRace, evaluate, bootstrapDelta, BASELINE, auc, type EngineOpts, type DRace } from "./_ab-backtest";

const races = buildDataset().filter((r) => r.version === "v2");
const pad = (s: string, n: number) => s.padStart(n);

function betStats(rs: DRace[], o: EngineOpts, oddsMax: number) {
  let bets = 0, invested = 0, returned = 0, hitRaces = 0, target = 0;
  for (const race of rs) {
    const sc = scoreRace(applyJockeyMode(race.horses, o.jockeyMode), o);
    const picked = sc.map((s, i) => ({ s, hit: race.horses[i].hit }))
      .filter((x) => x.s.ev > 0.10 && x.s.edge > 0.02 && x.s.odds <= oddsMax);
    if (!picked.length) continue;
    target++; bets += picked.length; invested += picked.length;
    returned += picked.reduce((a, x) => a + (x.hit ? x.s.odds : 0), 0);
    if (picked.some((x) => x.hit)) hitRaces++;
  }
  return { target, bets, hitRate: target ? hitRaces / target : 0, roi: invested ? (returned - invested) / invested : 0 };
}

console.log(`対象: v2 ${races.length}R\n`);
console.log("════ (A) TEMP と ODDS_MAX の分離 ════");
console.log("TEMP を上げる効果が「高オッズ馬を買わなくなる」だけなら、TEMP=4 のまま");
console.log("ODDS_MAX を絞っても同じ ROI が出るはず。\n");
console.log("設定                          |  点数 | 的中率 |     ROI");
console.log("-".repeat(58));
for (const [t, om] of [[4, 50], [4, 30], [4, 20], [4, 15], [8, 50], [10, 50], [10, 20]] as const) {
  const s = betStats(races, { ...BASELINE, temp: t }, om);
  console.log(`TEMP=${pad(String(t), 2)} / ODDS_MAX=${pad(String(om), 2)}              | ${pad(String(s.bets), 5)} | ${pad((s.hitRate * 100).toFixed(1) + "%", 6)} | ${pad((s.roi * 100).toFixed(1) + "%", 7)}`);
}

console.log("\n════ (B) 是正案の組み合わせ ════");
console.log("①(training除去)・②(jockeyクランプ解除)は本番実装済み。BASELINE(cache)が①+②適用後の状態。");
const variants: Array<[string, EngineOpts]> = [
  ["①+②適用後(現行, cache)", BASELINE],
  ["②raw再計算(検算用)", { ...BASELINE, jockeyMode: "raw" }],
  ["①+②+③(TEMP=5)", { ...BASELINE, temp: 5 }],
  ["①+②+③(TEMP=8)", { ...BASELINE, temp: 8 }],
];
console.log("設定                          | AUC強 | AUC最終 | ばらつき比 |  点数 | 的中率 |     ROI");
console.log("-".repeat(84));
for (const [label, o] of variants) {
  const m = evaluate(races, o);
  console.log(`${label.padEnd(28)} | ${pad(m.aucStrength.toFixed(4), 6)} | ${pad(m.aucFinal.toFixed(4), 6)} | ${pad(m.probSdRatio.toFixed(3), 9)} | ${pad(String(m.bets), 5)} | ${pad((m.hitRate * 100).toFixed(1) + "%", 6)} | ${pad((m.roi * 100).toFixed(1) + "%", 7)}`);
}

console.log("\n  ベースライン比のブートストラップCI(400回, レース単位):");
for (const [label, o] of variants.slice(1)) {
  const m = evaluate(races, o);
  const b = evaluate(races, BASELINE);
  const ci = bootstrapDelta(races, BASELINE, o, 400);
  console.log(
    `  ${label.padEnd(20)} AUC強 ${(m.aucStrength - b.aucStrength >= 0 ? "+" : "") + (m.aucStrength - b.aucStrength).toFixed(4)} [${ci.aucStrength.map((x) => x.toFixed(4)).join(", ")}]` +
    `  ROI ${((m.roi - b.roi) * 100 >= 0 ? "+" : "") + ((m.roi - b.roi) * 100).toFixed(1)}pt [${ci.roi.map((x) => (x * 100).toFixed(1)).join(", ")}]`
  );
}

// 騎手クランプ解除の効果を「騎手特徴量単独AUC」で直接見る
console.log("\n════ (C) 参考: 騎手特徴量そのものの単独AUC ════");
for (const mode of ["cache", "raw", "percentile"] as const) {
  const pairs: Array<{ score: number; hit: boolean }> = [];
  for (const race of races) {
    const eh = applyJockeyMode(race.horses, mode);
    eh.forEach((h, i) => { if (h.jockeyScore != null) pairs.push({ score: h.jockeyScore, hit: race.horses[i].hit }); });
  }
  console.log(`  ${mode.padEnd(12)} 単独AUC = ${auc(pairs).toFixed(4)}  (n=${pairs.length})`);
}
