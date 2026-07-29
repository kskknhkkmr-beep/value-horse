/**
 * ハーネスの忠実性検証: パラメータ化した scoreRace(BASELINE) が
 * 本番 lib/engine.ts の calculateScore と数値まで一致することを確認する。
 * ここが一致しない限り、A/B の差分は信用できない。
 */
import { calculateScore } from "../lib/engine";
import { buildDataset, scoreRace, applyJockeyMode, evaluate, BASELINE } from "./_ab-backtest";

const races = buildDataset();
console.log(`データセット: ${races.length}R  (v2=${races.filter((r) => r.version === "v2").length}R, v1=${races.filter((r) => r.version === "v1").length}R)`);

let maxDiff = 0, checked = 0;
for (const race of races) {
  const eh = applyJockeyMode(race.horses, "clamp");
  const mine = scoreRace(eh, BASELINE);
  const prod = calculateScore(eh.map((h, i) => ({ id: i, name: String(i), ...h })));
  prod.finalScores.forEach((p, i) => {
    maxDiff = Math.max(maxDiff, Math.abs(p.probability - mine[i].prob), Math.abs(p.ev - mine[i].ev), Math.abs(p.edge - mine[i].edge));
    checked++;
  });
}
console.log(`\n本番エンジンとの一致検証: ${checked} 頭  最大絶対差 = ${maxDiff.toExponential(3)}`);
console.log(maxDiff < 1e-12 ? "  ✓ 完全一致（ハーネスは本番と同一挙動）" : "  ✗ 不一致あり — 調査が必要");

for (const v of ["v2", "v1"] as const) {
  const sub = races.filter((r) => r.version === v);
  const m = evaluate(sub, BASELINE);
  console.log(`\n── ベースライン [${v}] ${m.races}R / ${m.horses}頭 ──`);
  console.log(`  AUC(strength)=${m.aucStrength.toFixed(4)}  AUC(最終確率)=${m.aucFinal.toFixed(4)}  本命的中=${(m.top1 * 100).toFixed(1)}%`);
  console.log(`  確率ばらつき比(モデル/市場)=${m.probSdRatio.toFixed(3)}`);
  console.log(`  ベット: 対象${m.targetRaces}R / ${m.bets}点  的中率=${(m.hitRate * 100).toFixed(1)}%  ROI=${(m.roi * 100).toFixed(1)}%`);
}
