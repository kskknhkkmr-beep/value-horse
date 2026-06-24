"use client";

import { useEffect, useState } from "react";

type Race = {
  id: number;
  raceName: string;
  date: string;
  venue: string;
  raceNumber: number;
  postTime: string;
};

type HorseScore = {
  horse: string;
  odds: number;
  pTrue: number;
  p_market: number;
  edge: number;
  ev: number;
  valueRating: number;
};

type BacktestHorse = {
  horse: string;
  odds: number;
  hit: boolean;
  returnUnits: number;
};

type BacktestRaceRecord = {
  raceId: number;
  raceName: string;
  date: string;
  venue: string;
  winner: string | null;
  horses: BacktestHorse[];
  hit: boolean;
  investedUnits: number;
  returnUnits: number;
};

type BacktestResponse = {
  totalRaces: number;
  racesWithResult: number;
  racesWithEvPositive: number;
  totalBets: number;
  totalReturn: number;
  roi: number;
  hitRate: number;
  records: BacktestRaceRecord[];
};

type ScoreResponse = {
  raceId: number;
  raceName: string;
  date: string;
  venue: string;
  raceNumber: number;
  postTime: string;
  entriesPending?: boolean;
  oddsUnavailable?: boolean;
  evRanking: HorseScore[];
  valueRanking: HorseScore[];
};

function fmt(n: number) {
  return n.toLocaleString("ja-JP");
}

export default function Home() {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState(1);
  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [unitAmount, setUnitAmount] = useState(1000);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [showBacktest, setShowBacktest] = useState(false);

  useEffect(() => {
    fetch("/api/races")
      .then((r) => r.json())
      .then((data: Race[]) => setRaces(data));
  }, []);

  useEffect(() => {
    fetch(`/api/score?raceId=${selectedRaceId}`)
      .then((r) => r.json())
      .then((data: ScoreResponse) => setScore(data));
  }, [selectedRaceId]);

  useEffect(() => {
    if (!showBacktest || backtest) return;
    fetch("/api/backtest")
      .then((r) => r.json())
      .then((data: BacktestResponse) => setBacktest(data))
      .catch(() => {});
  }, [showBacktest, backtest]);

  // EV正の馬フィルター（3条件すべて満たす馬のみ）
  // EV_MIN:   期待値10%以上（投資額の1.10倍以上のリターンを期待）
  // EDGE_MIN: 公正市場確率比でモデルが2pp以上上回る（オーバーラウンド補正済み）
  // ODDS_MAX: 30倍以下（高オッズ馬はスコア推定誤差が拡大するため除外）
  const EV_MIN = 0.10;
  const EDGE_MIN = 0.02;
  const ODDS_MAX = 30;
  const evPositive = (score?.evRanking ?? []).filter(
    (h) => h.ev > EV_MIN && h.edge > EDGE_MIN && h.odds <= ODDS_MAX
  );

  const allByEV = score?.evRanking ?? [];
  const axis = evPositive[0] ?? null;
  const partners = allByEV
    .filter((h) => h.horse !== axis?.horse)
    .slice(0, 4);

  const tanshoTotal = evPositive.length * unitAmount;
  const tanshoProfit = Math.round(
    evPositive.reduce((s, h) => s + h.ev * unitAmount, 0)
  );

  const comboCount = partners.length;
  const wideTotal = comboCount * unitAmount;
  const umarenTotal = comboCount * unitAmount;
  const grandTotal = tanshoTotal + wideTotal + umarenTotal;

  return (
    <main className="min-h-screen bg-white text-gray-900 p-4 sm:p-6">
      <div className="max-w-xl mx-auto space-y-5">

        {/* ── ヘッダー ── */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-base font-bold tracking-[0.2em] text-gray-900">
            VALUE HORSE
          </div>
          <select
            value={selectedRaceId}
            onChange={(e) => setSelectedRaceId(Number(e.target.value))}
            className="flex-1 max-w-xs bg-white border border-gray-300 px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-gray-500 cursor-pointer"
          >
            {races.map((r) => (
              <option key={r.id} value={r.id}>
                {r.date}　{r.venue}{r.raceNumber}R　{r.raceName}
              </option>
            ))}
          </select>
        </div>

        {!score && (
          <div className="text-center py-16 text-gray-300 text-xs tracking-widest">
            LOADING...
          </div>
        )}

        {score?.entriesPending && (
          <div className="border border-gray-200 px-4 py-8 text-center text-xs text-gray-400 space-y-1">
            <div>出走登録前</div>
            <div className="text-gray-300">金曜〜土曜朝に npm run fetch-all で更新してください</div>
          </div>
        )}

        {score?.oddsUnavailable && (
          <div className="border border-gray-200 px-4 py-8 text-center text-xs text-gray-400 space-y-1">
            <div>出走登録済み</div>
            <div className="text-gray-300">オッズ確定後に npm run fetch-all を実行してください</div>
          </div>
        )}

        {score && !score.oddsUnavailable && !score.entriesPending && (
          <>
            {/* ── ① EV正の馬 ── */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] tracking-[0.2em] text-gray-400 uppercase">
                  EV正の馬
                </span>
                <span className="text-[10px] text-gray-400">
                  {evPositive.length} 頭
                </span>
              </div>

              {evPositive.length === 0 ? (
                <div className="border border-gray-200 px-4 py-8 text-center text-gray-400 text-xs">
                  EV正の馬はありません
                </div>
              ) : (
                <div className="border border-gray-200">
                  <div className="grid grid-cols-[1fr_5rem_5rem_5rem] px-4 py-2 border-b border-gray-100 text-[10px] text-gray-400 tracking-wider">
                    <span>馬名</span>
                    <span className="text-right">オッズ</span>
                    <span className="text-right">EV</span>
                    <span className="text-right">ROI</span>
                  </div>

                  {evPositive.map((h, i) => {
                    const roi = Math.round((h.ev + 1) * 100);
                    const isTop = i === 0;
                    return (
                      <div
                        key={h.horse}
                        className={`grid grid-cols-[1fr_5rem_5rem_5rem] px-4 py-3 border-b border-gray-50 last:border-0 ${
                          isTop ? "bg-gray-50" : ""
                        }`}
                      >
                        <span className={`font-bold truncate pr-2 text-gray-900`}>
                          {isTop && (
                            <span className="text-[10px] text-gray-400 mr-1.5">◎</span>
                          )}
                          {h.horse}
                        </span>
                        <span className="text-right text-gray-500 tabular-nums text-xs">
                          {h.odds}倍
                        </span>
                        <span className="text-right font-bold tabular-nums text-xs text-blue-600">
                          +{h.ev.toFixed(3)}
                        </span>
                        <span className="text-right font-bold tabular-nums text-xs text-gray-900">
                          {roi}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ── ② 買い目 ── */}
            {evPositive.length > 0 && axis && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] tracking-[0.2em] text-gray-400 uppercase">
                    買い目
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400">1点</span>
                    <input
                      type="number"
                      value={unitAmount}
                      onChange={(e) =>
                        setUnitAmount(Math.max(100, Number(e.target.value)))
                      }
                      step={100}
                      min={100}
                      className="w-24 bg-white border border-gray-300 text-right px-2 py-1 text-sm font-bold text-gray-900 tabular-nums focus:outline-none focus:border-gray-500"
                    />
                    <span className="text-[10px] text-gray-400">円</span>
                  </div>
                </div>

                <div className="border border-gray-200 divide-y divide-gray-100">

                  {/* 単勝 */}
                  <div>
                    <div className="px-4 py-2 bg-gray-50 flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-700 tracking-wider">単勝</span>
                      <span className="text-[10px] text-gray-400">{evPositive.length}頭 / 全EV正</span>
                    </div>

                    {evPositive.map((h) => {
                      const profit = Math.round(h.ev * unitAmount);
                      return (
                        <div
                          key={h.horse}
                          className="grid grid-cols-[1fr_4rem_4rem_6rem] items-center px-4 py-2.5 border-t border-gray-50 text-xs"
                        >
                          <span className="text-gray-900 font-bold truncate pr-2">{h.horse}</span>
                          <span className="text-right text-gray-400 tabular-nums">{h.odds}倍</span>
                          <span className="text-right text-gray-400 tabular-nums">{fmt(unitAmount)}円</span>
                          <span className="text-right font-bold text-blue-600 tabular-nums">+{fmt(profit)}円</span>
                        </div>
                      );
                    })}

                    <div className="px-4 py-2.5 border-t border-gray-200 flex justify-between text-xs">
                      <span className="text-gray-400 tabular-nums">
                        {evPositive.length}点　計 {fmt(tanshoTotal)}円
                      </span>
                      <span className="font-bold text-blue-600 tabular-nums">
                        想定利益　+{fmt(tanshoProfit)}円
                      </span>
                    </div>
                  </div>

                  {/* ワイド */}
                  {partners.length > 0 && (
                    <div>
                      <div className="px-4 py-2 bg-gray-50 flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-700 tracking-wider">ワイド</span>
                        <span className="text-[10px] text-gray-400">ながし</span>
                      </div>
                      <div className="px-4 py-3 space-y-1.5 text-xs">
                        <div className="flex gap-3 items-baseline">
                          <span className="text-gray-400 w-5 shrink-0">軸</span>
                          <span className="font-bold text-gray-900">{axis.horse}</span>
                        </div>
                        <div className="flex gap-3 items-baseline">
                          <span className="text-gray-400 w-5 shrink-0">相手</span>
                          <span className="text-gray-600">{partners.map((h) => h.horse).join("　/　")}</span>
                        </div>
                      </div>
                      <div className="px-4 py-2.5 border-t border-gray-200 flex justify-between text-xs">
                        <span className="text-gray-400 tabular-nums">
                          {comboCount}通り　計 {fmt(wideTotal)}円
                        </span>
                        <span className="text-gray-300">想定利益　─</span>
                      </div>
                    </div>
                  )}

                  {/* 馬連 */}
                  {partners.length > 0 && (
                    <div>
                      <div className="px-4 py-2 bg-gray-50 flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-700 tracking-wider">馬連</span>
                        <span className="text-[10px] text-gray-400">ながし</span>
                      </div>
                      <div className="px-4 py-3 space-y-1.5 text-xs">
                        <div className="flex gap-3 items-baseline">
                          <span className="text-gray-400 w-5 shrink-0">軸</span>
                          <span className="font-bold text-gray-900">{axis.horse}</span>
                        </div>
                        <div className="flex gap-3 items-baseline">
                          <span className="text-gray-400 w-5 shrink-0">相手</span>
                          <span className="text-gray-600">{partners.map((h) => h.horse).join("　/　")}</span>
                        </div>
                      </div>
                      <div className="px-4 py-2.5 border-t border-gray-200 flex justify-between text-xs">
                        <span className="text-gray-400 tabular-nums">
                          {comboCount}通り　計 {fmt(umarenTotal)}円
                        </span>
                        <span className="text-gray-300">想定利益　─</span>
                      </div>
                    </div>
                  )}

                  {/* 合計 */}
                  <div className="px-4 py-4 flex justify-between items-center bg-gray-50">
                    <span className="text-xs text-gray-500 tracking-wider">合計投資</span>
                    <span className="text-lg font-bold tabular-nums text-gray-900">
                      {fmt(grandTotal)}円
                    </span>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
        {/* ── バックテスト ── */}
        <section>
          <button
            onClick={() => setShowBacktest((v) => !v)}
            className="w-full flex items-center justify-between py-2 text-[10px] tracking-[0.2em] text-gray-400 uppercase border-t border-gray-100"
          >
            <span>実績</span>
            <span>{showBacktest ? "▲" : "▼"}</span>
          </button>

          {showBacktest && (
            <div className="mt-2">
              {!backtest ? (
                <div className="text-center py-8 text-gray-300 text-xs tracking-widest">
                  LOADING...
                </div>
              ) : backtest.racesWithResult === 0 ? (
                <div className="border border-gray-200 px-4 py-8 text-center text-xs text-gray-400 space-y-1">
                  <div>結果データなし</div>
                  <div className="text-gray-300">npm run fetch-results を実行してください</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* サマリー */}
                  <div className="border border-gray-200 grid grid-cols-3 divide-x divide-gray-100">
                    <div className="px-3 py-3 text-center">
                      <div className="text-[10px] text-gray-400 mb-1">ROI</div>
                      <div className={`text-lg font-bold tabular-nums ${backtest.roi >= 0 ? "text-blue-600" : "text-red-400"}`}>
                        {backtest.roi >= 0 ? "+" : ""}{backtest.roi.toFixed(1)}%
                      </div>
                    </div>
                    <div className="px-3 py-3 text-center">
                      <div className="text-[10px] text-gray-400 mb-1">的中率</div>
                      <div className="text-lg font-bold tabular-nums text-gray-900">
                        {backtest.hitRate.toFixed(0)}%
                      </div>
                    </div>
                    <div className="px-3 py-3 text-center">
                      <div className="text-[10px] text-gray-400 mb-1">対象</div>
                      <div className="text-lg font-bold tabular-nums text-gray-900">
                        {backtest.racesWithEvPositive}<span className="text-xs font-normal text-gray-400">R</span>
                      </div>
                    </div>
                  </div>

                  {/* レース別 */}
                  <div className="border border-gray-200 divide-y divide-gray-100">
                    {backtest.records.filter((r) => r.investedUnits > 0).map((r) => {
                      const netYen = Math.round((r.returnUnits - r.investedUnits) * unitAmount);
                      return (
                        <div key={r.raceId}>
                          {/* レースヘッダー */}
                          <div className="flex items-center justify-between px-4 py-2 bg-gray-50">
                            <div className="flex items-center gap-2 text-xs">
                              <span className={`font-bold ${r.hit ? "text-blue-600" : "text-gray-300"}`}>
                                {r.hit ? "○" : "✗"}
                              </span>
                              <span className="text-gray-400">{r.date.slice(5)}</span>
                              <span className="text-gray-500">{r.venue}</span>
                              <span className="font-bold text-gray-900">{r.raceName}</span>
                            </div>
                            <div className={`text-xs font-bold tabular-nums ${netYen >= 0 ? "text-blue-600" : "text-red-400"}`}>
                              {netYen >= 0 ? "+" : ""}{fmt(netYen)}円
                            </div>
                          </div>

                          {/* 馬ヘッダー */}
                          <div className="grid grid-cols-[1fr_4rem_5rem_3rem_6rem] px-4 py-1.5 text-[10px] text-gray-400 tracking-wider border-b border-gray-50">
                            <span>馬名</span>
                            <span className="text-right">オッズ</span>
                            <span className="text-right">賭け金</span>
                            <span className="text-center">結果</span>
                            <span className="text-right">払戻</span>
                          </div>

                          {/* 馬ごと */}
                          {r.horses.map((h) => {
                            const betYen = unitAmount;
                            const payYen = Math.round(h.returnUnits * unitAmount);
                            return (
                              <div
                                key={h.horse}
                                className={`grid grid-cols-[1fr_4rem_5rem_3rem_6rem] px-4 py-2 text-xs border-b border-gray-50 last:border-0 ${h.hit ? "bg-blue-50" : ""}`}
                              >
                                <span className={`font-bold truncate pr-2 ${h.hit ? "text-blue-700" : "text-gray-700"}`}>
                                  {h.horse}
                                </span>
                                <span className="text-right text-gray-500 tabular-nums">{h.odds}倍</span>
                                <span className="text-right text-gray-500 tabular-nums">{fmt(betYen)}円</span>
                                <span className={`text-center font-bold ${h.hit ? "text-blue-600" : "text-gray-300"}`}>
                                  {h.hit ? "○" : "✗"}
                                </span>
                                <span className={`text-right font-bold tabular-nums ${h.hit ? "text-blue-600" : "text-red-400"}`}>
                                  {h.hit ? `+${fmt(payYen - betYen)}円` : `−${fmt(betYen)}円`}
                                </span>
                              </div>
                            );
                          })}

                          {/* レース小計 */}
                          <div className="grid grid-cols-[1fr_auto] px-4 py-2 text-[10px] text-gray-400 tabular-nums border-t border-gray-100">
                            <span>{r.investedUnits}点 / 投資 {fmt(r.investedUnits * unitAmount)}円 / 払戻 {fmt(Math.round(r.returnUnits * unitAmount))}円</span>
                            <span className={`font-bold ${netYen >= 0 ? "text-blue-600" : "text-red-400"}`}>
                              {netYen >= 0 ? "+" : ""}{fmt(netYen)}円
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-[10px] text-gray-300 text-right">
                    {backtest.totalBets}点 / 投資 {fmt(backtest.totalBets * unitAmount)}円 / 払戻 {fmt(Math.round(backtest.totalReturn * unitAmount))}円
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
