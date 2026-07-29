/**
 * ③の掘り下げ: TEMP は AUC で選ぶと誤る。
 * 市場ブレンド(0.35)が入っているため、TEMP を下げてモデル寄与を薄めるほど
 * 予測は「市場そのもの」に近づき AUC は上がる。AUC最大化＝モデルを使わない、になる。
 * 選定基準は較正(calibration)とベット構成で見る。
 */
import { buildDataset, evaluate, applyJockeyMode, scoreRace, BASELINE, type EngineOpts } from "./_ab-backtest";

const races = buildDataset().filter((r) => r.version === "v2");
const pad = (s: string, n: number) => s.padStart(n);

type Cal = { logloss: number; brier: number; slope: number; betAvgOdds: number; longshotBets: number; favBets: number };

function calib(o: EngineOpts): Cal {
  let ll = 0, br = 0, n = 0;
  const xs: number[] = [], ys: number[] = [];
  let betOddsSum = 0, bets = 0, longshot = 0, fav = 0;
  for (const race of races) {
    const sc = scoreRace(applyJockeyMode(race.horses, o.jockeyMode), o);
    sc.forEach((s, i) => {
      const y = race.horses[i].hit ? 1 : 0;
      const p = Math.min(Math.max(s.prob, 1e-9), 1 - 1e-9);
      ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      br += (p - y) ** 2;
      xs.push(Math.log(p / (1 - p))); ys.push(y);
      n++;
      if (s.ev > 0.10 && s.edge > 0.02 && s.odds <= 50) {
        bets++; betOddsSum += s.odds;
        if (s.odds >= 20) longshot++;
        if (s.odds < 7) fav++;
      }
    });
  }
  // 較正スロープ: y を logit(p) で単回帰。1.0 が理想、<1 は自信過剰、>1 は自信不足
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slopeRaw = num / den;
  // 確率スケールの回帰係数を logit スケールの目安へ（p(1-p)平均で割り戻す）
  const varp = ys.length ? xs.map((l) => { const p = 1 / (1 + Math.exp(-l)); return p * (1 - p); }).reduce((a, b) => a + b, 0) / xs.length : 1;
  return { logloss: ll / n, brier: br / n, slope: slopeRaw / varp, betAvgOdds: bets ? betOddsSum / bets : 0, longshotBets: longshot, favBets: fav };
}

console.log(`対象: v2 ${races.length}R\n`);
console.log("TEMP | ばらつき比 | LogLoss | Brier | 較正slope | AUC最終 |  点数 | うち20倍超 | うち7倍未満 | 平均オッズ | 的中率 |     ROI");
console.log("-".repeat(122));
for (const t of [4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 12.0]) {
  const o: EngineOpts = { ...BASELINE, temp: t };
  const m = evaluate(races, o), c = calib(o);
  console.log(
    `${pad(t.toFixed(1), 4)} | ${pad(m.probSdRatio.toFixed(3), 9)} | ${pad(c.logloss.toFixed(4), 7)} | ${pad(c.brier.toFixed(4), 5)} | ` +
    `${pad(c.slope.toFixed(3), 9)} | ${pad(m.aucFinal.toFixed(4), 7)} | ${pad(String(m.bets), 5)} | ${pad(String(c.longshotBets), 10)} | ` +
    `${pad(String(c.favBets), 11)} | ${pad(c.betAvgOdds.toFixed(1), 10)} | ${pad((m.hitRate * 100).toFixed(1) + "%", 6)} | ${pad((m.roi * 100).toFixed(1) + "%", 7)}`
  );
}

// 市場単独（モデルを一切使わない）を参照値として出す
const pureMarket: EngineOpts = { ...BASELINE, marketWeight: 1.0 };
const pm = evaluate(races, pureMarket);
console.log(`\n参照: 市場100%(モデル不使用) AUC最終=${pm.aucFinal.toFixed(4)}`);
console.log("→ AUC最終が最大になるのは「モデルを使わない」場合。TEMP選定にAUCを使ってはいけない。");
