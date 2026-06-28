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
  horseNumber: number;
  odds: number;
  pTrue: number;
  p_market: number;
  edge: number;
  ev: number;
  valueRating: number;
};

type ComboBet = {
  type: "umaren" | "umatan" | "wide" | "sanrenpuku" | "sanrentan";
  label: string;
  horses: string[];
  horseNumbers: number[];
  estOdds: number;
  ev: number;
};

type BacktestHorse = {
  horse: string;
  odds: number;
  hit: boolean;
  returnUnits: number;
};

type BacktestRaceRecord = {
  raceId: number;
  raceNumber: number;
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
  realDataOnly: boolean;
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
  comboBets?: ComboBet[];
};

const COMBO_LABELS: Record<string, string> = {
  umaren: "馬連",
  umatan: "馬単",
  wide: "ワイド",
  sanrenpuku: "三連複",
  sanrentan: "三連単",
};

const EV_MIN = 0.10;
const EDGE_MIN = 0.02;
const ODDS_MAX = 50;

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
  const [realDataOnly, setRealDataOnly] = useState(false);
  // 階層ナビ
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/races")
      .then((r) => r.json())
      .then((data: Race[]) => setRaces(data));
  }, []);

  useEffect(() => {
    setScore(null);
    fetch(`/api/score?raceId=${selectedRaceId}`)
      .then((r) => r.json())
      .then((data: ScoreResponse) => setScore(data));
  }, [selectedRaceId]);

  useEffect(() => {
    if (!showBacktest) return;
    setBacktest(null);
    fetch(`/api/backtest${realDataOnly ? "?realDataOnly=1" : ""}`)
      .then((r) => r.json())
      .then((data: BacktestResponse) => setBacktest(data))
      .catch(() => {});
  }, [showBacktest, realDataOnly]);

  const evPositive = (score?.evRanking ?? []).filter(
    (h) => h.ev > EV_MIN && h.edge > EDGE_MIN && h.odds <= ODDS_MAX
  );

  const topHorse = score?.evRanking?.[0] ?? null;
  const comboBets = score?.comboBets ?? [];
  const hasBets = evPositive.length > 0 || comboBets.length > 0;

  // 過去実績の階層ナビ用データ
  const activeRecords = (backtest?.records ?? []).filter((r) => r.investedUnits > 0);

  const years = [...new Set(activeRecords.map((r) => r.date.slice(0, 4)))].sort().reverse();

  const monthsForYear = selectedYear
    ? [...new Set(
        activeRecords
          .filter((r) => r.date.slice(0, 4) === selectedYear)
          .map((r) => r.date.slice(5, 7))
      )].sort().reverse()
    : [];

  const datesForMonth =
    selectedYear && selectedMonth
      ? [...new Set(
          activeRecords
            .filter((r) => r.date.startsWith(`${selectedYear}-${selectedMonth}`))
            .map((r) => r.date)
        )].sort().reverse()
      : [];

  const recordsForDate = selectedDate
    ? activeRecords.filter((r) => r.date === selectedDate)
    : [];

  const venuesForDate = [...new Set(recordsForDate.map((r) => r.venue))];

  function goTop() {
    setSelectedYear(null);
    setSelectedMonth(null);
    setSelectedDate(null);
  }

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

        {/* 出走登録前 */}
        {score?.entriesPending && (
          <div className="border border-gray-200 px-4 py-8 text-center text-xs text-gray-400 space-y-1">
            <div>出走登録前</div>
            <div className="text-gray-300">金曜〜土曜朝に npm run fetch-all で更新してください</div>
          </div>
        )}

        {/* ① 本命馬 + ② 買い目 */}
        {score && !score.entriesPending && (
          <>
            {/* ── ① 本命馬 ── */}
            <section>
              <div className="text-[10px] tracking-[0.2em] text-gray-400 uppercase mb-2">
                本命馬
              </div>

              {score.oddsUnavailable ? (
                <div className="border border-gray-200 px-4 py-6 text-center text-xs text-gray-400">
                  オッズ確定後に表示されます
                </div>
              ) : topHorse ? (
                <div className="border border-gray-200 px-4 py-4 flex items-center gap-3">
                  <span className="text-base text-gray-500 shrink-0 w-5">◎</span>
                  <span className="text-xs text-gray-400 tabular-nums w-6 text-center shrink-0">
                    {topHorse.horseNumber}
                  </span>
                  <span className="font-bold text-gray-900 flex-1 text-sm truncate">
                    {topHorse.horse}
                  </span>
                  <div className="text-right shrink-0 space-y-0.5">
                    <div className="text-xs text-gray-500 tabular-nums">{topHorse.odds}倍</div>
                    <div className={`text-sm font-bold tabular-nums ${topHorse.ev > 0 ? "text-blue-600" : "text-gray-400"}`}>
                      {topHorse.ev > 0 ? "+" : ""}{topHorse.ev.toFixed(3)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border border-gray-200 px-4 py-6 text-center text-xs text-gray-400">
                  データなし
                </div>
              )}
            </section>

            {/* ── ② 買い目 ── */}
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

              {score.oddsUnavailable ? (
                <div className="border border-gray-200 px-4 py-6 text-center text-xs text-gray-400">
                  オッズ確定後に表示されます
                </div>
              ) : !hasBets ? (
                <div className="border border-gray-200 px-4 py-8 text-center text-xs text-gray-400">
                  期待値のある買い目はありません
                </div>
              ) : (
                <div className="border border-gray-200 divide-y divide-gray-100">

                  {/* 単勝 */}
                  {evPositive.length > 0 && (
                    <div>
                      <div className="px-4 py-2 bg-gray-50">
                        <span className="text-xs font-bold text-gray-700 tracking-wider">単勝</span>
                      </div>
                      <div className="grid grid-cols-[2.5rem_1fr_4rem_4rem_6rem] px-4 py-1.5 text-[10px] text-gray-400 tracking-wider border-b border-gray-50">
                        <span></span>
                        <span>馬名</span>
                        <span className="text-right">オッズ</span>
                        <span className="text-right">EV</span>
                        <span className="text-right">想定利益</span>
                      </div>
                      {evPositive.map((h) => {
                        const profit = Math.round(h.ev * unitAmount);
                        return (
                          <div
                            key={h.horse}
                            className="grid grid-cols-[2.5rem_1fr_4rem_4rem_6rem] items-center px-4 py-2.5 text-xs border-t border-gray-50"
                          >
                            <span className="text-gray-400 tabular-nums text-center">{h.horseNumber}</span>
                            <span className="font-bold text-gray-900 truncate pr-2">{h.horse}</span>
                            <span className="text-right text-gray-500 tabular-nums">{h.odds}倍</span>
                            <span className="text-right font-bold text-blue-600 tabular-nums">+{h.ev.toFixed(2)}</span>
                            <span className="text-right font-bold text-blue-600 tabular-nums">+{fmt(profit)}円</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 複合券種 */}
                  {(["umaren", "umatan", "wide", "sanrenpuku", "sanrentan"] as const).map((type) => {
                    const bets = comboBets.filter((b) => b.type === type);
                    if (bets.length === 0) return null;
                    return (
                      <div key={type}>
                        <div className="px-4 py-2 bg-gray-50">
                          <span className="text-xs font-bold text-gray-700 tracking-wider">
                            {COMBO_LABELS[type]}
                          </span>
                        </div>
                        <div className="grid grid-cols-[1fr_4rem_4rem_6rem] px-4 py-1.5 text-[10px] text-gray-400 tracking-wider border-b border-gray-50">
                          <span>組み合わせ</span>
                          <span className="text-right">推定</span>
                          <span className="text-right">EV</span>
                          <span className="text-right">想定利益</span>
                        </div>
                        {bets.map((bet) => {
                          const profit = Math.round(bet.ev * unitAmount);
                          return (
                            <div
                              key={bet.label}
                              className="grid grid-cols-[1fr_4rem_4rem_6rem] items-center px-4 py-2.5 text-xs border-t border-gray-50"
                            >
                              <span className="font-bold text-gray-900 tabular-nums">{bet.label}</span>
                              <span className="text-right text-gray-500 tabular-nums">{bet.estOdds.toFixed(1)}倍</span>
                              <span className="text-right font-bold text-blue-600 tabular-nums">+{bet.ev.toFixed(2)}</span>
                              <span className="text-right font-bold text-blue-600 tabular-nums">+{fmt(profit)}円</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}

                </div>
              )}
            </section>
          </>
        )}

        {/* ── 過去実績 ── */}
        <section>
          <div className="flex items-center justify-between py-2 border-t border-gray-100">
            <button
              onClick={() => {
                const next = !showBacktest;
                setShowBacktest(next);
                if (!next) { goTop(); }
              }}
              className="text-[10px] tracking-[0.2em] text-gray-400 uppercase"
            >
              過去実績 {showBacktest ? "▲" : "▼"}
            </button>
            {showBacktest && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={realDataOnly}
                  onChange={(e) => setRealDataOnly(e.target.checked)}
                  className="w-3 h-3 accent-gray-500"
                />
                <span className="text-[10px] text-gray-400">form実データのみ</span>
              </label>
            )}
          </div>

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

                  {/* パンくずリスト */}
                  {selectedYear && (
                    <div className="flex items-center gap-1 text-[10px] text-gray-400">
                      <button
                        onClick={goTop}
                        className="hover:text-gray-700 underline"
                      >
                        年一覧
                      </button>
                      <span>›</span>
                      <button
                        onClick={() => { setSelectedMonth(null); setSelectedDate(null); }}
                        className={selectedMonth ? "hover:text-gray-700 underline" : "text-gray-700 font-bold"}
                      >
                        {selectedYear}年
                      </button>
                      {selectedMonth && (
                        <>
                          <span>›</span>
                          <button
                            onClick={() => setSelectedDate(null)}
                            className={selectedDate ? "hover:text-gray-700 underline" : "text-gray-700 font-bold"}
                          >
                            {parseInt(selectedMonth)}月
                          </button>
                        </>
                      )}
                      {selectedDate && (
                        <>
                          <span>›</span>
                          <span className="text-gray-700 font-bold">
                            {selectedDate.slice(5).replace("-", "/")}
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  {/* ── 年一覧 ── */}
                  {!selectedYear && (
                    <div className="border border-gray-200 divide-y divide-gray-100">
                      {years.map((y) => {
                        const cnt = activeRecords.filter((r) => r.date.startsWith(y)).length;
                        return (
                          <button
                            key={y}
                            onClick={() => setSelectedYear(y)}
                            className="w-full flex items-center justify-between px-4 py-3 text-xs hover:bg-gray-50 text-left"
                          >
                            <span className="font-bold text-gray-900">{y}年</span>
                            <span className="text-gray-400">{cnt}R ›</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* ── 月一覧 ── */}
                  {selectedYear && !selectedMonth && (
                    <div className="border border-gray-200 divide-y divide-gray-100">
                      {monthsForYear.map((m) => {
                        const cnt = activeRecords.filter((r) =>
                          r.date.startsWith(`${selectedYear}-${m}`)
                        ).length;
                        return (
                          <button
                            key={m}
                            onClick={() => setSelectedMonth(m)}
                            className="w-full flex items-center justify-between px-4 py-3 text-xs hover:bg-gray-50 text-left"
                          >
                            <span className="font-bold text-gray-900">{parseInt(m)}月</span>
                            <span className="text-gray-400">{cnt}R ›</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* ── 開催日一覧 ── */}
                  {selectedYear && selectedMonth && !selectedDate && (
                    <div className="border border-gray-200 divide-y divide-gray-100">
                      {datesForMonth.map((d) => {
                        const dayRecords = activeRecords.filter((r) => r.date === d);
                        const hits = dayRecords.filter((r) => r.hit).length;
                        const netUnit = dayRecords.reduce(
                          (s, r) => s + r.returnUnits - r.investedUnits,
                          0
                        );
                        const netYen = Math.round(netUnit * unitAmount);
                        return (
                          <button
                            key={d}
                            onClick={() => setSelectedDate(d)}
                            className="w-full flex items-center justify-between px-4 py-3 text-xs hover:bg-gray-50 text-left"
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-gray-900">
                                {d.slice(5).replace("-", "/")}
                              </span>
                              <span className="text-gray-400">
                                {dayRecords.length}R / {hits}的中
                              </span>
                            </div>
                            <div className={`font-bold tabular-nums ${netYen >= 0 ? "text-blue-600" : "text-red-400"}`}>
                              {netYen >= 0 ? "+" : ""}{fmt(netYen)}円 ›
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* ── 開催場所 → レース一覧 ── */}
                  {selectedDate && (
                    <div className="space-y-3">
                      {venuesForDate.map((venue) => {
                        const venueRecords = recordsForDate.filter((r) => r.venue === venue);
                        return (
                          <div key={venue} className="border border-gray-200">
                            <div className="px-4 py-2 bg-gray-50 text-xs font-bold text-gray-700">
                              {venue}
                            </div>
                            {venueRecords.map((r) => {
                              const netYen = Math.round(
                                (r.returnUnits - r.investedUnits) * unitAmount
                              );
                              return (
                                <div key={r.raceId}>
                                  {/* レースヘッダー */}
                                  <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100">
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className={`font-bold ${r.hit ? "text-blue-600" : "text-gray-300"}`}>
                                        {r.hit ? "○" : "✗"}
                                      </span>
                                      <span className="text-gray-400 tabular-nums">{r.raceNumber}R</span>
                                      <span className="font-bold text-gray-900">{r.raceName}</span>
                                    </div>
                                    <div className={`text-xs font-bold tabular-nums ${netYen >= 0 ? "text-blue-600" : "text-red-400"}`}>
                                      {netYen >= 0 ? "+" : ""}{fmt(netYen)}円
                                    </div>
                                  </div>

                                  {/* 馬ヘッダー */}
                                  <div className="grid grid-cols-[1fr_4rem_5rem_3rem_6rem] px-4 py-1.5 text-[10px] text-gray-400 tracking-wider border-t border-gray-50">
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
                                        className={`grid grid-cols-[1fr_4rem_5rem_3rem_6rem] px-4 py-2 text-xs border-t border-gray-50 last:border-0 ${h.hit ? "bg-blue-50" : ""}`}
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
                                    <span>
                                      {r.investedUnits}点 / 投資 {fmt(r.investedUnits * unitAmount)}円 / 払戻 {fmt(Math.round(r.returnUnits * unitAmount))}円
                                    </span>
                                    <span className={`font-bold ${netYen >= 0 ? "text-blue-600" : "text-red-400"}`}>
                                      {netYen >= 0 ? "+" : ""}{fmt(netYen)}円
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}

                      {/* 日付合計 */}
                      <div className="text-[10px] text-gray-300 text-right">
                        {recordsForDate.reduce((s, r) => s + r.investedUnits, 0)}点 /
                        {" "}投資 {fmt(recordsForDate.reduce((s, r) => s + r.investedUnits, 0) * unitAmount)}円 /
                        {" "}払戻 {fmt(Math.round(recordsForDate.reduce((s, r) => s + r.returnUnits, 0) * unitAmount))}円
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
