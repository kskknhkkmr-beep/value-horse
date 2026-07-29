/**
 * 是正案②③の個別A/B検証（①trainingScore除去は本番実装済みのため対象外）。
 * v2レース（実スコア保有）のみを対象にする。
 * v1 はスコアが全頭デフォルト値で race 内に差が無く、特徴量の改変を評価できないため除外。
 */
import { buildDataset, evaluate, bootstrapDelta, BASELINE, type EngineOpts, type Metrics } from "./_ab-backtest";

const all = buildDataset();
const races = all.filter((r) => r.version === "v2");
const base = evaluate(races, BASELINE);

const pad = (s: string, n: number) => s.padStart(n);
const pct = (x: number, d = 1) => (x * 100).toFixed(d) + "%";
const sign = (x: number, d = 4) => (x >= 0 ? "+" : "") + x.toFixed(d);

function row(label: string, m: Metrics) {
  console.log(
    `${label.padEnd(30)} | ${pad(m.aucStrength.toFixed(4), 6)} | ${pad(m.aucFinal.toFixed(4), 6)} | ` +
    `${pad(m.probSdRatio.toFixed(3), 5)} | ${pad(String(m.bets), 4)} | ${pad(pct(m.hitRate), 6)} | ${pad(pct(m.roi), 7)}`
  );
}
function header(title: string) {
  console.log(`\n════ ${title} ════`);
  console.log("変更内容".padEnd(30) + " | AUC強 | AUC最終 | ばらつき比 | 点数 | 的中率 |     ROI");
  console.log("-".repeat(92));
}
function delta(label: string, o: EngineOpts) {
  const m = evaluate(races, o);
  const ci = bootstrapDelta(races, BASELINE, o, 400);
  console.log(
    `  → ${label}: AUC最終 ${sign(m.aucFinal - base.aucFinal)} [${ci.aucFinal.map((x) => x.toFixed(4)).join(", ")}]  ` +
    `ROI ${sign((m.roi - base.roi) * 100, 1)}pt [${ci.roi.map((x) => (x * 100).toFixed(1)).join(", ")}]`
  );
}

console.log(`対象: v2 ${races.length}R / ${base.horses}頭  （ROIは${base.bets}点ベースでノイズが大きい点に注意）`);

// ── ② jockeyScore の正規化 ──────────────────────────────────────────────────
// 本番実装済み: scores-cache の jockeyScore は既にクランプ解除済み(BASELINE=cache)。
// ここでは jockey_raw.json からの再計算(raw)・パーセンタイル化との一致/差分を確認する。
header("② jockeyScore の正規化方式の比較");
row("ベースライン(cache=クランプ解除済み)", base);
const jRaw: EngineOpts = { ...BASELINE, jockeyMode: "raw" };
const jPct: EngineOpts = { ...BASELINE, jockeyMode: "percentile" };
row("jockey_raw.jsonから再計算(raw)", evaluate(races, jRaw));
row("パーセンタイル正規化", evaluate(races, jPct));
delta("raw再計算との差分", jRaw);
delta("パーセンタイル化", jPct);

// ── ③ TEMP（確率ばらつき）の補正 ────────────────────────────────────────────
header("③ softmax温度 TEMP の見直し（ばらつき比 1.0 が目標）");
for (const t of [4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 12.0]) {
  const o: EngineOpts = { ...BASELINE, temp: t };
  row(`TEMP=${t.toFixed(1)}${t === 4 ? " (現行)" : ""}`, evaluate(races, o));
}
console.log();
for (const t of [6.0, 8.0, 10.0]) delta(`TEMP=${t.toFixed(1)}`, { ...BASELINE, temp: t });
