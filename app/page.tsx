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

type ModelVersion = "v1" | "v2";

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
  modelVersion: ModelVersion;
};

type BacktestStats = {
  racesWithResult: number;
  racesWithEvPositive: number;
  totalBets: number;
  totalReturn: number;
  roi: number;
  hitRate: number;
};

type OddsMaxVariant = {
  overall: BacktestStats;
  byVersion: Record<ModelVersion, BacktestStats>;
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
  byVersion: Record<ModelVersion, BacktestStats>;
  oddsMaxVariants: Record<string, OddsMaxVariant>;
  dataUpdatedAt: string | null;
  latestResultDate: string | null;
  missingResultDates: string[];
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

type BetKind = "tan" | ComboBet["type"];

const DEFAULT_STAKE = 1000;

const EV_MIN = 0.10;
const EDGE_MIN = 0.02;
const ODDS_MAX = 50;

function fmt(n: number) {
  return n.toLocaleString("ja-JP");
}

export default function Home() {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState(0);
  const [score, setScore] = useState<ScoreResponse | null>(null);
  // 券種ごとの賭け金（単勝・馬連・馬単・ワイド・三連複・三連単で個別に設定）
  const [stakeByType, setStakeByType] = useState<Record<BetKind, number>>({
    tan: DEFAULT_STAKE,
    umaren: DEFAULT_STAKE,
    umatan: DEFAULT_STAKE,
    wide: DEFAULT_STAKE,
    sanrenpuku: DEFAULT_STAKE,
    sanrentan: DEFAULT_STAKE,
  });
  // 過去実績（バックテスト）の点数→円換算にのみ使用
  const [unitAmount, setUnitAmount] = useState(1000);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [realDataOnly, setRealDataOnly] = useState(false);
  // 過去実績のモデルバージョン絞り込み（v1/v2 を混ぜて表示しない）
  const [versionFilter, setVersionFilter] = useState<"all" | ModelVersion>("all");
  // ODDS_MAX 並行計測（50 vs 20）の開閉
  const [showOddsCompare, setShowOddsCompare] = useState(false);
  // 階層ナビ
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // レースアコーディオン
  const [openRaces, setOpenRaces] = useState<Set<number>>(new Set());
  // 買い目券種アコーディオン（モバイルでデフォルト折りたたみ）
  const [openBetTypes, setOpenBetTypes] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/races")
      .then((r) => r.json())
      .then((data: Race[]) => {
        setRaces(data);
        if (data.length > 0) setSelectedRaceId((prev) => prev === 0 ? data[0].id : prev);
      });
  }, []);

  useEffect(() => {
    setScore(null);
    fetch(`/api/score?raceId=${selectedRaceId}`)
      .then((r) => r.json())
      .then((data: ScoreResponse) => setScore(data));
  }, [selectedRaceId]);

  useEffect(() => {
    setBacktest(null);
    fetch(`/api/backtest${realDataOnly ? "?realDataOnly=1" : ""}`)
      .then((r) => r.json())
      .then((data: BacktestResponse) => setBacktest(data))
      .catch(() => {});
  }, [realDataOnly]);

  const evPositive = (score?.evRanking ?? []).filter(
    (h) => h.ev > EV_MIN && h.edge > EDGE_MIN && h.odds <= ODDS_MAX
  );

  const topHorse = evPositive[0] ?? null;
  const comboBets = score?.comboBets ?? [];
  const hasBets = evPositive.length > 0 || comboBets.length > 0;

  // 買い目サマリー: 券種ごとにEV上位3件（既にEV降順の配列の先頭3件）のみを対象に、
  // 券種ごとの賭け金で合計投資額・的中時の払戻幅（実オッズ×賭け金）を算出。
  // 4〜5番目の低EV・極端オッズ候補（特に三連単）を除外し、払戻幅が外れ値で
  // 過度に広がるのを防ぐ。※「想定利益」列はEVベース（期待値）なので、
  // ここは実際の払戻計算として別立てにする。
  const SUMMARY_TOP_N = 3;
  const summaryBets = [
    ...evPositive.slice(0, SUMMARY_TOP_N).map((h) => ({ stake: stakeByType.tan, odds: h.odds })),
    ...(["umaren", "umatan", "wide", "sanrenpuku", "sanrentan"] as const).flatMap((type) =>
      comboBets
        .filter((b) => b.type === type)
        .slice(0, SUMMARY_TOP_N)
        .map((b) => ({ stake: stakeByType[type], odds: b.estOdds }))
    ),
  ];
  const totalStake = summaryBets.reduce((s, b) => s + b.stake, 0);
  const payouts = summaryBets.map((b) => b.stake * b.odds);
  const minPayout = payouts.length > 0 ? Math.round(Math.min(...payouts)) : 0;
  const maxPayout = payouts.length > 0 ? Math.round(Math.max(...payouts)) : 0;

  // モデルバージョンで絞り込んだレコード（all の場合は全件）
  const versionRecords = (backtest?.records ?? []).filter(
    (r) => versionFilter === "all" || r.modelVersion === versionFilter
  );
  // 表示する集計統計（all=全体, v1/v2=byVersion）
  const displayStats: BacktestStats | null = !backtest
    ? null
    : versionFilter === "all"
      ? backtest
      : backtest.byVersion[versionFilter];

  // ODDS_MAX 上限別スタッツ（現在の versionFilter を反映）
  const variantStats = (key: string): BacktestStats | null => {
    const v = backtest?.oddsMaxVariants?.[key];
    if (!v) return null;
    return versionFilter === "all" ? v.overall : v.byVersion[versionFilter];
  };

  // 過去実績: EV+レースのみ（ナビ用カウント・統計）
  const activeRecords = versionRecords.filter((r) => r.investedUnits > 0);
  // 全レース（見送り含む）— レース一覧表示に使用
  const allRecords = versionRecords;

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

  // ナビ用カウントは activeRecords（EV+のみ）、表示は allRecords（見送り含む全件）
  const recordsForDate = selectedDate
    ? allRecords.filter((r) => r.date === selectedDate)
    : [];

  const venuesForDate = [...new Set(recordsForDate.map((r) => r.venue))];

  function goTop() {
    setSelectedYear(null);
    setSelectedMonth(null);
    setSelectedDate(null);
    setOpenRaces(new Set());
  }

  function toggleBetType(type: string) {
    setOpenBetTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function toggleRace(raceId: number) {
    setOpenRaces((prev) => {
      const next = new Set(prev);
      if (next.has(raceId)) next.delete(raceId);
      else next.add(raceId);
      return next;
    });
  }

  return (
    <main className="min-h-screen bg-white text-gray-900 lg:grid lg:grid-cols-[2fr_3fr] lg:h-screen lg:overflow-hidden">

      {/* ══ 左カラム：ヘッダー + 本命馬 + 買い目 ══ */}
      <div className="p-4 sm:p-6 lg:overflow-y-auto lg:border-r lg:border-gray-100">
        <div className="space-y-5">

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
                <div className="text-[10px] tracking-[0.2em] text-gray-400 uppercase mb-2">
                  買い目
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
                        <div className="px-4 py-2 bg-gray-50 flex items-center justify-between">
                          <span className="text-xs font-bold text-gray-700 tracking-wider">単勝</span>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={stakeByType.tan}
                              onChange={(e) =>
                                setStakeByType((prev) => ({
                                  ...prev,
                                  tan: Math.max(100, Number(e.target.value)),
                                }))
                              }
                              step={100}
                              min={100}
                              className="w-20 bg-white border border-gray-300 text-right px-1.5 py-0.5 text-xs font-bold text-gray-900 tabular-nums focus:outline-none focus:border-gray-500"
                            />
                            <span className="text-[10px] text-gray-400">円/点</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-[2.5rem_1fr_4rem_4rem_6rem] px-4 py-1.5 text-[10px] text-gray-400 tracking-wider border-b border-gray-50">
                          <span></span>
                          <span>馬名</span>
                          <span className="text-right">オッズ</span>
                          <span className="text-right">EV</span>
                          <span className="text-right">想定利益</span>
                        </div>
                        {evPositive.map((h) => {
                          const profit = Math.round(h.ev * stakeByType.tan);
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

                    {/* 複合券種（モバイルでデフォルト折りたたみ） */}
                    {(["umaren", "umatan", "wide", "sanrenpuku", "sanrentan"] as const).map((type) => {
                      const bets = comboBets.filter((b) => b.type === type);
                      if (bets.length === 0) return null;
                      const isTypeOpen = openBetTypes.has(type);
                      const maxEv = Math.max(...bets.map((b) => b.ev));
                      return (
                        <div key={type}>
                          {/* 見出し：モバイルでタップ開閉、デスクトップは装飾のみ */}
                          <div className="w-full px-4 py-2 bg-gray-50 flex items-center justify-between gap-2">
                            <button
                              className="flex-1 min-w-0 flex items-center justify-between text-left"
                              onClick={() => toggleBetType(type)}
                            >
                              <span className="text-xs font-bold text-gray-700 tracking-wider">
                                {COMBO_LABELS[type]}
                                {!isTypeOpen && (
                                  <span className="lg:hidden text-[10px] font-normal text-gray-400 ml-2 tabular-nums">
                                    {bets.length}件 最大EV+{maxEv.toFixed(2)}
                                  </span>
                                )}
                              </span>
                              <span className="lg:hidden text-gray-300 text-[10px]">
                                {isTypeOpen ? "▾" : "▸"}
                              </span>
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                              <input
                                type="number"
                                value={stakeByType[type]}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  setStakeByType((prev) => ({
                                    ...prev,
                                    [type]: Math.max(100, Number(e.target.value)),
                                  }))
                                }
                                step={100}
                                min={100}
                                className="w-20 bg-white border border-gray-300 text-right px-1.5 py-0.5 text-xs font-bold text-gray-900 tabular-nums focus:outline-none focus:border-gray-500"
                              />
                              <span className="text-[10px] text-gray-400">円/点</span>
                            </div>
                          </div>
                          {/* コンテンツ：モバイルは開閉、デスクトップは常時表示 */}
                          <div className={`${isTypeOpen ? "" : "hidden"} lg:block`}>
                            <div className="grid grid-cols-[1fr_4rem_4rem_6rem] px-4 py-1.5 text-[10px] text-gray-400 tracking-wider border-b border-gray-50">
                              <span>組み合わせ</span>
                              <span className="text-right">推定</span>
                              <span className="text-right">EV</span>
                              <span className="text-right">想定利益</span>
                            </div>
                            {bets.map((bet) => {
                              const profit = Math.round(bet.ev * stakeByType[type]);
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
                        </div>
                      );
                    })}

                  </div>
                )}

                {/* ── サマリー：券種ごとEV上位3件を合計するといくら賭けて、いくら返ってくるか ── */}
                {!score.oddsUnavailable && hasBets && (
                  <div className="mt-2 border border-gray-200 px-4 py-3 bg-gray-50">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[10px] tracking-wider text-gray-400">
                        本命{summaryBets.length}点の投資額
                      </span>
                      <span className="text-lg font-bold text-gray-900 tabular-nums">
                        {fmt(totalStake)}円
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between text-xs">
                      <span className="text-gray-400">
                        外れれば <span className="font-bold text-red-400 tabular-nums">−{fmt(totalStake)}円</span>
                      </span>
                      <span className="text-gray-400">
                        当たれば{" "}
                        <span className="font-bold text-blue-600 tabular-nums">
                          +{fmt(minPayout)}〜+{fmt(maxPayout)}円
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 text-[9px] text-gray-300">
                      各券種EV上位3件までを集計（一覧表示は最大5件）
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

        </div>
      </div>

      {/* ══ 右カラム：過去実績 ══ */}
      <div className="p-4 sm:p-6 lg:overflow-y-auto border-t lg:border-t-0 border-gray-100">
        <div className="space-y-3">

          {/* 右カラムヘッダー */}
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] tracking-[0.2em] text-gray-400 uppercase shrink-0">
              過去実績
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={realDataOnly}
                  onChange={(e) => setRealDataOnly(e.target.checked)}
                  className="w-3 h-3 accent-gray-500"
                />
                <span className="text-[10px] text-gray-400">form実データのみ</span>
              </label>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400">1点</span>
                <input
                  type="number"
                  value={unitAmount}
                  onChange={(e) =>
                    setUnitAmount(Math.max(100, Number(e.target.value)))
                  }
                  step={100}
                  min={100}
                  className="w-20 bg-white border border-gray-300 text-right px-1.5 py-0.5 text-xs font-bold text-gray-900 tabular-nums focus:outline-none focus:border-gray-500"
                />
                <span className="text-[10px] text-gray-400">円</span>
              </div>
            </div>
          </div>

          {/* データ鮮度インジケータ（自動更新の欠落を目視で検知） */}
          {backtest && (
            <div className="text-[10px]">
              {backtest.missingResultDates.length > 0 ? (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700">
                  <span>⚠</span>
                  <span>
                    {backtest.missingResultDates.join("・")} の結果が未反映です
                    （<code>npm run fetch-results</code> で復旧）
                  </span>
                </div>
              ) : (
                <div className="text-gray-400 px-1">
                  最新結果 <span className="text-gray-600">{backtest.latestResultDate ?? "—"}</span>
                  {backtest.dataUpdatedAt && (
                    <span className="text-gray-300">
                      {" "}· 更新 {backtest.dataUpdatedAt.slice(0, 16).replace("T", " ")} UTC
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* モデルバージョン切替（v1/v2 を混ぜて表示しない） */}
          <div className="flex items-center gap-1 text-[10px]">
            {([
              ["all", "全体"],
              ["v2", "v2（実データ）"],
              ["v1", "v1（旧）"],
            ] as const).map(([v, label]) => {
              const count = !backtest
                ? 0
                : v === "all"
                  ? backtest.racesWithResult
                  : backtest.byVersion[v].racesWithResult;
              return (
                <button
                  key={v}
                  onClick={() => setVersionFilter(v)}
                  className={`px-2 py-0.5 border tracking-wide transition-colors ${
                    versionFilter === v
                      ? "border-gray-800 bg-gray-800 text-white"
                      : "border-gray-200 text-gray-400 hover:border-gray-400"
                  }`}
                >
                  {label}
                  <span className="ml-1 tabular-nums opacity-70">{count}R</span>
                </button>
              );
            })}
          </div>

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
            <>
              {/* サマリー（1行）— 選択中モデルバージョンの集計 */}
              <div className="flex items-center gap-4 px-1 py-1 text-xs text-gray-500 border-b border-gray-100">
                <span>
                  ROI{" "}
                  <span className={`font-bold tabular-nums ${(displayStats?.roi ?? 0) >= 0 ? "text-blue-600" : "text-red-400"}`}>
                    {(displayStats?.roi ?? 0) >= 0 ? "+" : ""}{(displayStats?.roi ?? 0).toFixed(1)}%
                  </span>
                </span>
                <span>
                  的中率{" "}
                  <span className="font-bold text-gray-900 tabular-nums">
                    {(displayStats?.hitRate ?? 0).toFixed(0)}%
                  </span>
                </span>
                <span>
                  対象{" "}
                  <span className="font-bold text-gray-900 tabular-nums">
                    {displayStats?.racesWithEvPositive ?? 0}R
                  </span>
                </span>
              </div>

              {/* ODDS_MAX 並行計測（本番=50 / 引き下げ案=20）— 折りたたみ */}
              {backtest.oddsMaxVariants && (
                <div className="border border-gray-100">
                  <button
                    onClick={() => setShowOddsCompare((v) => !v)}
                    className="w-full flex items-center justify-between px-2 py-1 text-[10px] text-gray-400 hover:text-gray-600"
                  >
                    <span className="tracking-wide">ODDS上限 並行計測（50 vs 20）</span>
                    <span>{showOddsCompare ? "−" : "+"}</span>
                  </button>
                  {showOddsCompare && (
                    <div className="px-2 pb-2">
                      <table className="w-full text-[10px] tabular-nums">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-100">
                            <th className="text-left font-normal py-0.5">ODDS上限</th>
                            <th className="text-right font-normal">ROI</th>
                            <th className="text-right font-normal">的中率</th>
                            <th className="text-right font-normal">対象</th>
                            <th className="text-right font-normal">点数</th>
                          </tr>
                        </thead>
                        <tbody>
                          {["50", "20"].map((key) => {
                            const s = variantStats(key);
                            return (
                              <tr key={key} className="border-b border-gray-50 last:border-0">
                                <td className="py-0.5 text-gray-600">
                                  ≤{key}{key === "50" ? "（本番）" : ""}
                                </td>
                                <td className={`text-right font-bold ${(s?.roi ?? 0) >= 0 ? "text-blue-600" : "text-red-400"}`}>
                                  {(s?.roi ?? 0) >= 0 ? "+" : ""}{(s?.roi ?? 0).toFixed(1)}%
                                </td>
                                <td className="text-right text-gray-700">{(s?.hitRate ?? 0).toFixed(0)}%</td>
                                <td className="text-right text-gray-700">{s?.racesWithEvPositive ?? 0}R</td>
                                <td className="text-right text-gray-700">{s?.totalBets ?? 0}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="mt-1 text-[9px] text-gray-300">
                        本番の買い目・表示は ODDS≤50 のまま。20 は人気薄バイアス検証用の参考値。
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* パンくずリスト */}
              {selectedYear && (
                <div className="flex items-center gap-1 text-[10px] text-gray-400">
                  <button onClick={goTop} className="hover:text-gray-700 underline">
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
                        onClick={() => { setSelectedDate(d); setOpenRaces(new Set()); }}
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

              {/* ── 開催場所 → レース一覧（アコーディオン）── */}
              {selectedDate && (
                <div className="space-y-2">
                  {venuesForDate.map((venue) => {
                    const venueRecords = recordsForDate.filter((r) => r.venue === venue);
                    return (
                      <div key={venue} className="border border-gray-200">
                        {/* 会場バー */}
                        <div className="px-4 py-1.5 bg-gray-50 text-[10px] font-bold text-gray-500 tracking-widest uppercase">
                          {venue}
                        </div>

                        {venueRecords.map((r) => {
                          const isMissPass = r.investedUnits === 0;
                          const netYen = Math.round(
                            (r.returnUnits - r.investedUnits) * unitAmount
                          );
                          const isOpen = openRaces.has(r.raceId);

                          // 見送りレース（EV+の馬なし）
                          if (isMissPass) {
                            return (
                              <div key={r.raceId} className="border-t border-gray-100 flex items-center gap-2 px-4 py-2.5 text-xs">
                                <span className="shrink-0 font-bold text-gray-200 w-3">−</span>
                                <span className="shrink-0 text-gray-300 tabular-nums w-6">{r.raceNumber}R</span>
                                <span className="flex-1 text-gray-300 truncate">{r.raceName}</span>
                                <span className="shrink-0 text-[10px] text-gray-300 border border-gray-200 rounded px-1">見送り</span>
                                <span className="shrink-0 w-3"></span>
                              </div>
                            );
                          }

                          return (
                            <div key={r.raceId} className="border-t border-gray-100">
                              {/* サマリー行（タップで開閉） */}
                              <button
                                onClick={() => toggleRace(r.raceId)}
                                className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-left hover:bg-gray-50"
                              >
                                <span className={`shrink-0 font-bold w-3 ${r.hit ? "text-blue-600" : "text-gray-300"}`}>
                                  {r.hit ? "○" : "✗"}
                                </span>
                                <span className="shrink-0 text-gray-400 tabular-nums w-6">{r.raceNumber}R</span>
                                <span className="flex-1 font-bold text-gray-900 truncate">{r.raceName}</span>
                                <span className={`shrink-0 font-bold tabular-nums ${netYen >= 0 ? "text-blue-600" : "text-red-400"}`}>
                                  {netYen >= 0 ? "+" : ""}{fmt(netYen)}円
                                </span>
                                <span className="shrink-0 text-gray-300 text-[9px] w-3">
                                  {isOpen ? "▾" : "▸"}
                                </span>
                              </button>

                              {/* 展開時：全馬個別表示（的中・外れ問わず） */}
                              {isOpen && (
                                <div className="px-4 pb-3 space-y-1 border-t border-gray-50">
                                  {r.horses.map((h) => {
                                    const horseNet = h.hit
                                      ? Math.round((h.returnUnits - 1) * unitAmount)
                                      : -unitAmount;
                                    return (
                                      <div key={h.horse} className={`flex items-center gap-2 text-xs py-1.5 px-2 -mx-2 ${h.hit ? "bg-blue-50" : ""}`}>
                                        <span className={`shrink-0 font-bold w-3 ${h.hit ? "text-blue-500" : "text-gray-300"}`}>
                                          {h.hit ? "◎" : "✗"}
                                        </span>
                                        <span className={`flex-1 min-w-0 font-bold break-all ${h.hit ? "text-blue-700" : "text-gray-600"}`}>
                                          {h.horse}
                                        </span>
                                        <span className="shrink-0 text-gray-400 tabular-nums">{h.odds}倍</span>
                                        <span className={`shrink-0 font-bold tabular-nums w-[5.5rem] text-right ${h.hit ? "text-blue-600" : "text-gray-400"}`}>
                                          {h.hit ? `+${fmt(horseNet)}` : `−${fmt(unitAmount)}`}円
                                        </span>
                                      </div>
                                    );
                                  })}
                                  <div className="text-[10px] text-gray-300 text-right pt-1 border-t border-gray-50 tabular-nums">
                                    {r.investedUnits}点 / 投資 {fmt(r.investedUnits * unitAmount)}円 / 払戻 {fmt(Math.round(r.returnUnits * unitAmount))}円
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}

                  {/* 日付合計 */}
                  <div className="text-[10px] text-gray-300 text-right tabular-nums">
                    {recordsForDate.reduce((s, r) => s + r.investedUnits, 0)}点 /
                    {" "}投資 {fmt(recordsForDate.reduce((s, r) => s + r.investedUnits, 0) * unitAmount)}円 /
                    {" "}払戻 {fmt(Math.round(recordsForDate.reduce((s, r) => s + r.returnUnits, 0) * unitAmount))}円
                  </div>
                </div>
              )}
            </>
          )}

        </div>
      </div>

    </main>
  );
}
