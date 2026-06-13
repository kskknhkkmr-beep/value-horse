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

type HorseFeatures = {
  form: number;
  pedigree: number;
  training: number;
  jockey: number;
};

type HorseScore = {
  horse: string;
  odds: number;
  pTrue: number;
  p_market: number;
  edge: number;
  ev: number;
  valueRating: number;
  features: HorseFeatures | null;
};

type ScoreResponse = {
  raceId: number;
  raceName: string;
  date: string;
  venue: string;
  raceNumber: number;
  postTime: string;
  finalScores: HorseScore[];
  valueRanking: HorseScore[];
  evRanking: HorseScore[];
  edgeRanking: HorseScore[];
};

function CircularGauge({ pct, size = 160 }: { pct: number; size?: number }) {
  const r = (size - 20) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(Math.max(pct, 0), 1);
  const cx = size / 2;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", position: "absolute" }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle
          cx={cx} cy={cx} r={r}
          fill="none" stroke="#1d4ed8" strokeWidth="10"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="text-center z-10">
        <div className="text-4xl font-bold text-gray-900">
          {Math.round(pct * 100)}<span className="text-lg">%</span>
        </div>
        <div className="text-xs text-gray-400">勝率</div>
      </div>
    </div>
  );
}

function RadarChart({ scores }: { scores: { label: string; value: number }[] }) {
  const cx = 90, cy = 90, r = 62;
  const n = scores.length;
  const angles = scores.map((_, i) => (i / n) * 2 * Math.PI - Math.PI / 2);
  const pt = (a: number, s: number) => [cx + r * s * Math.cos(a), cy + r * s * Math.sin(a)] as [number, number];
  const poly = (scale: number) => angles.map((a) => pt(a, scale).join(",")).join(" ");

  return (
    <svg width={180} height={180} viewBox="0 0 180 180">
      {[1, 0.66, 0.33].map((s) => (
        <polygon key={s} points={poly(s)} fill="none" stroke="#e5e7eb" strokeWidth="1" />
      ))}
      {angles.map((a, i) => {
        const [x, y] = pt(a, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e7eb" strokeWidth="1" />;
      })}
      <polygon
        points={angles.map((a, i) => pt(a, scores[i].value / 100).join(",")).join(" ")}
        fill="rgba(29,78,216,0.08)"
        stroke="#1d4ed8"
        strokeWidth="2"
      />
      {scores.map((s, i) => {
        const [lx, ly] = pt(angles[i], 1.24);
        return (
          <text key={i} x={lx} y={ly} fill="#374151" fontSize="9" textAnchor="middle" dominantBaseline="middle">
            {s.label}
          </text>
        );
      })}
    </svg>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const w = 140, h = 32;
  const min = Math.min(...data), max = Math.max(...data);
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - ((v - min) / (max - min || 1)) * h * 0.8 - h * 0.1,
  ]);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h}>
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#bfdbfe" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke="url(#sg)" strokeWidth="1.5" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2" fill="#1d4ed8" opacity="0.6" />
      ))}
    </svg>
  );
}

function StatBox({ label, value, unit = "" }: { label: string; value: string; unit?: string }) {
  return (
    <div className="border border-gray-200 p-2 text-center">
      <div className="text-lg font-bold text-gray-900">{value}<span className="text-xs text-gray-400">{unit}</span></div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  );
}

function EVBar({ value }: { value: number }) {
  const capped = Math.min(Math.max(value, -1), 3);
  const pct = ((capped + 1) / 4) * 100;
  return (
    <div className="w-16 bg-gray-100 h-1.5 rounded">
      <div
        className={`h-1.5 rounded transition-all ${value >= 0 ? "bg-blue-500" : "bg-red-400"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

type MarkedHorse = { name: string; mark: string };

type BetTicketData = {
  betType: string;
  formation: string;
  axis: MarkedHorse[];
  axis2: MarkedHorse[];
  partners: MarkedHorse[];
  count: number;
  unitAmount: number;
};

function buildBets(score: ScoreResponse, unitAmount: number): BetTicketData[] {
  const ranked = score.valueRanking;
  const MARKS = ["◎", "○", "▲", "△", "×", "×", "×"];
  const mark = (i: number) => MARKS[i] ?? "×";

  const positiveEV = ranked.filter((h) => h.ev > 0);
  const top6 = ranked.slice(0, 6);

  // 単勝: EV正の馬を対象
  const tanshoTargets: MarkedHorse[] = positiveEV.slice(0, 5).map((h, i) => ({ name: h.horse, mark: mark(i) }));

  // ワイド: pTrue上位1頭軸ながし
  const probTop = [...ranked].sort((a, b) => b.pTrue - a.pTrue);
  const wideAxis: MarkedHorse[] = [{ name: probTop[0].horse, mark: "◎" }];
  const widePartners: MarkedHorse[] = probTop.slice(1, 5).map((h, i) => ({ name: h.horse, mark: mark(i + 1) }));

  // 馬連: EV1位軸ながし
  const umarenAxis: MarkedHorse[] = [{ name: top6[0].horse, mark: "◎" }];
  const umarenPartners: MarkedHorse[] = top6.slice(1, 5).map((h, i) => ({ name: h.horse, mark: mark(i + 1) }));

  // 三連複: EV1位軸・相手5頭ながし (C(5,2)=10通り)
  const sanfukuAxis: MarkedHorse[] = [{ name: top6[0].horse, mark: "◎" }];
  const sanfukuPartners: MarkedHorse[] = top6.slice(1, 6).map((h, i) => ({ name: h.horse, mark: mark(i + 1) }));
  const sanfukuCount = (sanfukuPartners.length * (sanfukuPartners.length - 1)) / 2;

  // 三連単: 1着◎固定・2着○固定・3着相手ながし
  const santanAxis1: MarkedHorse[] = [{ name: top6[0].horse, mark: "◎" }];
  const santanAxis2: MarkedHorse[] = [{ name: top6[1].horse, mark: "○" }];
  const santanPartners: MarkedHorse[] = top6.slice(2, 6).map((h, i) => ({ name: h.horse, mark: mark(i + 2) }));

  return [
    {
      betType: "単勝",
      formation: "単式",
      axis: tanshoTargets,
      axis2: [],
      partners: [],
      count: tanshoTargets.length,
      unitAmount,
    },
    {
      betType: "ワイド",
      formation: "ながし",
      axis: wideAxis,
      axis2: [],
      partners: widePartners,
      count: widePartners.length,
      unitAmount,
    },
    {
      betType: "馬連",
      formation: "ながし",
      axis: umarenAxis,
      axis2: [],
      partners: umarenPartners,
      count: umarenPartners.length,
      unitAmount,
    },
    {
      betType: "三連複",
      formation: "1頭軸ながし",
      axis: sanfukuAxis,
      axis2: [],
      partners: sanfukuPartners,
      count: sanfukuCount,
      unitAmount,
    },
    {
      betType: "三連単",
      formation: "2頭軸ながし",
      axis: santanAxis1,
      axis2: santanAxis2,
      partners: santanPartners,
      count: santanPartners.length,
      unitAmount,
    },
  ];
}

const MARK_STYLE: Record<string, string> = {
  "◎": "bg-red-600 text-white border-red-600",
  "○": "bg-white text-gray-800 border-gray-400",
  "▲": "bg-gray-900 text-white border-gray-900",
  "△": "bg-white text-gray-500 border-gray-400",
  "×": "bg-white text-gray-300 border-gray-200",
};

function MarkBadge({ mark }: { mark: string }) {
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full border-2 text-xs font-bold shrink-0 ${MARK_STYLE[mark] ?? MARK_STYLE["×"]}`}>
      {mark}
    </span>
  );
}

function BetTicketSection({ score }: { score: ScoreResponse }) {
  const unitAmount = 100;
  const bets = buildBets(score, unitAmount);
  const MARKS = ["◎", "○", "▲", "△", "×", "×", "×"];
  const topHorses = score.valueRanking.slice(0, 6).map((h, i) => ({ ...h, mark: MARKS[i] }));
  const totalAmount = bets.reduce((sum, b) => sum + b.count * b.unitAmount, 0);

  return (
    <div className="bg-white border border-gray-200 text-xs">
      {/* Horse ticket header */}
      <div className="flex items-stretch border-b border-gray-200">
        <div className="w-2 bg-gray-800 shrink-0" />
        <div className="flex-1 px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-y-1 gap-x-6">
          {topHorses.map((h) => (
            <div key={h.horse} className="flex items-center gap-1.5">
              <span className={`font-bold w-4 shrink-0 text-[11px] ${h.mark === "◎" ? "text-red-600" : "text-gray-700"}`}>
                {h.mark}
              </span>
              <span className="text-gray-700 truncate text-[11px]">{h.horse}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Table header */}
      <div className="flex border-b border-gray-200 bg-gray-50">
        <div className="w-28 px-3 py-1.5 border-r border-gray-200 text-center text-[10px] text-gray-500">
          券種・方式
        </div>
        <div className="flex-1 px-3 py-1.5 text-[10px] text-gray-500">
          組み合わせ・点数・金額
        </div>
      </div>

      {/* Bet rows */}
      {bets.map((bet, idx) => (
        <div key={bet.betType} className={`flex ${idx < bets.length - 1 ? "border-b border-gray-100" : ""}`}>
          <div className="w-28 px-3 py-3 border-r border-gray-200 flex flex-col items-center justify-center text-center shrink-0">
            <div className="font-bold text-gray-800 text-xs">{bet.betType}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              {bet.betType === "単勝" ? `${bet.count}頭` : bet.formation}
            </div>
          </div>
          <div className="flex-1 px-3 py-2">
            <div className="border border-dashed border-red-300 px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-7 shrink-0 text-[11px]">
                  {bet.betType === "三連単" ? "1着" : "軸"}
                </span>
                <span className="text-gray-300">:</span>
                <div className="flex gap-1 flex-wrap">
                  {bet.axis.map((h) => <MarkBadge key={h.name} mark={h.mark} />)}
                </div>
              </div>
              {bet.axis2.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 w-7 shrink-0 text-[11px]">2着</span>
                  <span className="text-gray-300">:</span>
                  <div className="flex gap-1">
                    {bet.axis2.map((h) => <MarkBadge key={h.name} mark={h.mark} />)}
                  </div>
                </div>
              )}
              {bet.partners.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 w-7 shrink-0 text-[11px]">相手</span>
                  <span className="text-gray-300">:</span>
                  <div className="flex gap-1 flex-wrap">
                    {bet.partners.map((h) => <MarkBadge key={h.name} mark={h.mark} />)}
                  </div>
                </div>
              )}
              <div className="text-[10px] text-gray-400 border-t border-gray-100 pt-1.5">
                {bet.count}通り　各{bet.unitAmount.toLocaleString()}円　計{(bet.count * bet.unitAmount).toLocaleString()}円
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Grand total */}
      <div className="flex justify-between items-center border-t border-gray-300 px-4 py-3 bg-gray-50">
        <span className="text-gray-500 text-xs">合計</span>
        <span className="font-bold text-base text-gray-900">{totalAmount.toLocaleString()}円</span>
      </div>
    </div>
  );
}

export default function Home() {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState(1);
  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [selectedHorse, setSelectedHorse] = useState<HorseScore | null>(null);

  useEffect(() => {
    fetch("/api/races")
      .then((r) => r.json())
      .then((data: Race[]) => setRaces(data));
  }, []);

  useEffect(() => {
    fetch(`/api/score?raceId=${selectedRaceId}`)
      .then((r) => r.json())
      .then((data: ScoreResponse) => {
        setScore(data);
        setSelectedHorse(data.valueRanking[0]);
      });
  }, [selectedRaceId]);

  const [investment, setInvestment] = useState(10000);

  const topHorse = score?.valueRanking[0];
  const sparkData = [0.4, 0.9, 0.6, 1.3, 0.8, 1.6, 2.1];
  const candidates = (score?.evRanking ?? []).filter((h) => h.ev > 0);

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 text-sm p-2 sm:p-4">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* ── Row 1 ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Panel A */}
          <div className="border border-gray-200 bg-white p-5 flex flex-col gap-4">
            <div>
              <div className="text-4xl font-bold text-gray-900 tracking-widest leading-none">VALUE</div>
              <div className="text-4xl font-bold text-gray-900 tracking-widest leading-none">HORSE</div>
              <div className="text-xs text-gray-400 mt-1">EV最大化・市場乖離検出システム</div>
            </div>

            <div>
              <div className="text-xs text-gray-400 mb-2 border-b border-gray-100 pb-1">今週の成績</div>
              <div className="grid grid-cols-1 gap-2">
                <StatBox label="回収率" value="108.4" unit="%" />
              </div>
            </div>

            <div>
              <div className="text-xs text-gray-400 mb-1">EV 週次推移</div>
              <Sparkline data={sparkData} />
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-gray-500">現在分析中</span>
            </div>

            <button className="mt-auto border border-gray-300 text-gray-700 text-xs py-2 hover:bg-gray-50 transition-colors">
              次の高EV馬を探す →
            </button>
          </div>

          {/* Panel B */}
          <div className="border border-gray-200 bg-white p-5 flex flex-col gap-4">
            <div>
              <div className="text-xs text-gray-400 mb-1">レース選択</div>
              <select
                value={selectedRaceId}
                onChange={(e) => setSelectedRaceId(Number(e.target.value))}
                className="w-full bg-white border border-gray-300 text-gray-800 text-xs p-2 focus:outline-none focus:border-blue-400"
              >
                {races.map((r) => (
                  <option key={r.id} value={r.id}>{r.raceName}</option>
                ))}
              </select>
            </div>

            {topHorse ? (
              <>
                <div className="flex justify-center">
                  <CircularGauge pct={topHorse.pTrue} size={164} />
                </div>
                <div className="space-y-1.5 text-xs">
                  {[
                    ["レース名", score?.raceName],
                    ["発走時刻", score ? `${score.date} ${score.postTime}` : ""],
                    ["会場", score?.venue],
                    ["推奨馬", topHorse.horse],
                    ["推奨EV", `+${topHorse.ev.toFixed(3)}`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b border-gray-100 pb-1">
                      <span className="text-gray-400">{k}</span>
                      <span className={k === "推奨馬" ? "text-gray-900 font-bold" : k === "推奨EV" ? "text-blue-600 font-bold" : "text-gray-700"}>{v}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-gray-300 text-xs text-center py-8">読み込み中...</div>
            )}
          </div>

          {/* Panel C */}
          <div className="border border-gray-200 bg-white p-5">
            <div className="text-xs text-gray-400 mb-3 border-b border-gray-100 pb-1">
              出走馬 / EV RANKING
            </div>
            {score ? (
              <div className="space-y-0.5">
                {score.valueRanking.map((h, i) => (
                  <button
                    key={h.horse}
                    onClick={() => setSelectedHorse(h)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 text-xs border-b border-gray-100 hover:bg-gray-50 transition-colors ${selectedHorse?.horse === h.horse ? "bg-gray-50 border-l-2 border-l-gray-800" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-300 w-4 shrink-0">{i + 1}</span>
                      <span className={`truncate max-w-[120px] ${i === 0 ? "text-gray-900 font-bold" : "text-gray-600"}`}>
                        {h.horse}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <EVBar value={h.ev} />
                      <span className={`font-bold w-14 text-right ${h.ev > 0 ? "text-blue-600" : "text-red-500"}`}>
                        {h.ev > 0 ? "+" : ""}{h.ev.toFixed(2)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-gray-300 text-xs">読み込み中...</div>
            )}
          </div>
        </div>

        {/* ── 投資対象馬 ── */}
        {score && candidates.length > 0 && (
          <div className="border border-gray-900 bg-white">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 py-3 border-b border-gray-200">
              <div>
                <span className="text-xs font-bold text-gray-900 tracking-wider uppercase">投資対象馬</span>
                <span className="ml-2 text-xs text-gray-400">— ROIベース / EV正の馬のみ</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">1口</span>
                <input
                  type="number"
                  value={investment}
                  onChange={(e) => setInvestment(Math.max(0, Number(e.target.value)))}
                  step={1000}
                  min={0}
                  className="w-28 border border-gray-300 text-right px-2 py-1 text-sm font-bold text-gray-900 focus:outline-none focus:border-gray-600 tabular-nums"
                />
                <span className="text-xs text-gray-400">円</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3">
              {candidates.slice(0, 3).map((h, i) => {
                const roiPct = Math.round((h.ev + 1) * 100);
                const profit = Math.round(investment * h.ev);
                return (
                  <div key={h.horse} className="px-5 py-4 flex flex-col gap-3 border-b sm:border-b-0 sm:border-r border-gray-100 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] text-gray-400 mb-1">#{i + 1}</div>
                        <div className="text-base font-bold text-gray-900 leading-tight">{h.horse}</div>
                        <div className="text-xs text-gray-400 mt-0.5 tabular-nums">単勝 {h.odds}倍</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-gray-400 tracking-widest mb-0.5">ROI</div>
                        <div className="tabular-nums leading-none">
                          <span className="text-4xl font-bold text-gray-900">{roiPct}</span>
                          <span className="text-lg text-gray-400 ml-0.5">%</span>
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
                      <span className="text-xs text-gray-400">想定利益</span>
                      <span className="text-sm font-bold text-gray-900 tabular-nums">
                        +{profit.toLocaleString()}<span className="text-xs font-normal text-gray-400 ml-0.5">円</span>
                      </span>
                    </div>
                  </div>
                );
              })}
              {candidates.length > 3 && (
                <div className="col-span-1 sm:col-span-3 border-t border-gray-100 px-5 py-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
                  {candidates.slice(3).map((h) => {
                    const roiPct = Math.round((h.ev + 1) * 100);
                    const profit = Math.round(investment * h.ev);
                    return (
                      <div key={h.horse} className="flex items-center gap-3 text-xs text-gray-600">
                        <span className="font-bold text-gray-900">{h.horse}</span>
                        <span className="tabular-nums text-gray-500">ROI <span className="font-bold text-gray-900">{roiPct}%</span></span>
                        <span className="tabular-nums text-gray-500">単勝 {h.odds}倍</span>
                        <span className="tabular-nums text-gray-500">想定利益 <span className="font-bold text-gray-900">+{profit.toLocaleString()}円</span></span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Row 2 ── */}
        {selectedHorse && score && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* Panel D */}
            <div className="border border-gray-200 bg-white p-5 flex flex-col gap-3">
              <div className="text-xs text-gray-400 border-b border-gray-100 pb-1">選択馬 詳細</div>
              <div>
                <div className="text-base font-bold text-gray-900">{selectedHorse.horse}</div>
                <div className="text-3xl font-bold text-gray-900 mt-1">
                  {selectedHorse.ev > 0 ? "+" : ""}{selectedHorse.ev.toFixed(2)}
                  <span className="text-xs text-gray-400 ml-1">EV</span>
                </div>
              </div>

              <div className="flex justify-center">
                <RadarChart
                  scores={[
                    { label: "フォーム", value: selectedHorse.features?.form ?? 70 },
                    { label: "血統", value: selectedHorse.features?.pedigree ?? 70 },
                    { label: "調教", value: selectedHorse.features?.training ?? 70 },
                    { label: "騎手", value: selectedHorse.features?.jockey ?? 70 },
                    { label: "乖離", value: Math.min(100, Math.max(0, 50 + selectedHorse.edge * 250)) },
                  ]}
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ["モデル勝率", `${(selectedHorse.pTrue * 100).toFixed(1)}%`],
                  ["市場確率", `${(selectedHorse.p_market * 100).toFixed(1)}%`],
                  ["エッジ", `${selectedHorse.edge > 0 ? "+" : ""}${(selectedHorse.edge * 100).toFixed(1)}pt`],
                  ["オッズ", `${selectedHorse.odds}倍`],
                ].map(([k, v]) => (
                  <div key={k} className="border border-gray-100 p-2">
                    <div className="text-gray-400">{k}</div>
                    <div className={`font-bold ${k === "エッジ" ? (selectedHorse.edge > 0 ? "text-blue-600" : "text-red-500") : "text-gray-900"}`}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel E */}
            <div className="border border-gray-200 bg-white p-5 flex flex-col gap-4">
              <div className="text-xs text-gray-400 border-b border-gray-100 pb-1">AI 分析</div>

              <div className="text-xs text-gray-600 leading-relaxed space-y-2">
                {selectedHorse.ev >= 0.5 ? (
                  <>
                    <p>▶ <span className="text-gray-900 font-bold">{selectedHorse.horse}</span> はモデル確率が市場を有意に上回る。正のエッジを検出。</p>
                    <p>▶ EV <span className="text-blue-600 font-bold">+{selectedHorse.ev.toFixed(3)}</span> — 長期ベットで期待収益プラス。</p>
                    <p>▶ モデル勝率 <span className="font-medium text-gray-800">{(selectedHorse.pTrue * 100).toFixed(1)}%</span> vs 市場 <span className="font-medium text-gray-800">{(selectedHorse.p_market * 100).toFixed(1)}%</span>。乖離 <span className="font-medium text-gray-800">{(selectedHorse.edge * 100).toFixed(1)}pt</span>。</p>
                    <p className="text-gray-900 font-bold border border-gray-300 px-2 py-1 inline-block">◎ 推奨：ベット対象</p>
                  </>
                ) : selectedHorse.ev >= 0 ? (
                  <>
                    <p>▶ <span className="text-gray-900 font-bold">{selectedHorse.horse}</span> のEVは微プラス。エッジは小さく確信度は低い。</p>
                    <p>▶ EV <span className="text-gray-700 font-bold">{selectedHorse.ev.toFixed(3)}</span></p>
                    <p className="text-yellow-700 font-bold border border-yellow-300 px-2 py-1 inline-block">△ 推奨：様子見</p>
                  </>
                ) : (
                  <>
                    <p>▶ <span className="text-gray-900 font-bold">{selectedHorse.horse}</span> は市場に過剰評価されている。</p>
                    <p>▶ EV <span className="text-red-500 font-bold">{selectedHorse.ev.toFixed(3)}</span> — 期待収益マイナス。</p>
                    <p className="text-red-600 font-bold border border-red-300 px-2 py-1 inline-block">✕ 推奨：見送り</p>
                  </>
                )}
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">信頼度スコア</span>
                  <span className="text-gray-500">{Math.min(100, Math.abs(selectedHorse.valueRating) * 1.5).toFixed(0)}</span>
                </div>
                <div className="w-full bg-gray-100 h-2">
                  <div
                    className="bg-blue-500 h-2 transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.abs(selectedHorse.valueRating) * 1.5)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="border border-gray-100 p-2">
                  <div className="text-gray-400">EVランク</div>
                  <div className="text-gray-900 font-bold">
                    #{score.valueRanking.findIndex((h) => h.horse === selectedHorse.horse) + 1}
                    <span className="text-gray-400 font-normal"> / {score.valueRanking.length}</span>
                  </div>
                </div>
                <div className="border border-gray-100 p-2">
                  <div className="text-gray-400">VALUE SCORE</div>
                  <div className={`font-bold ${selectedHorse.valueRating > 0 ? "text-blue-600" : "text-red-500"}`}>
                    {selectedHorse.valueRating.toFixed(1)}
                  </div>
                </div>
              </div>
            </div>

            {/* Panel F */}
            <div className="border border-gray-200 bg-white p-5">
              <div className="text-xs text-gray-400 border-b border-gray-100 pb-1 mb-3">全馬スコア一覧</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left pb-2 font-normal">馬名</th>
                    <th className="text-right pb-2 font-normal">勝率</th>
                    <th className="text-right pb-2 font-normal hidden sm:table-cell">Edge</th>
                    <th className="text-right pb-2 font-normal">EV</th>
                  </tr>
                </thead>
                <tbody>
                  {score.finalScores
                    .slice()
                    .sort((a, b) => b.ev - a.ev)
                    .map((h) => (
                      <tr
                        key={h.horse}
                        onClick={() => setSelectedHorse(h)}
                        className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${selectedHorse.horse === h.horse ? "bg-gray-50" : ""}`}
                      >
                        <td className="py-1 truncate max-w-[80px] text-gray-700">{h.horse}</td>
                        <td className="py-1 text-right text-gray-400">{(h.pTrue * 100).toFixed(0)}%</td>
                        <td className={`py-1 text-right hidden sm:table-cell ${h.edge > 0 ? "text-blue-500" : "text-red-400"}`}>
                          {h.edge > 0 ? "+" : ""}{(h.edge * 100).toFixed(1)}
                        </td>
                        <td className={`py-1 text-right font-bold ${h.ev > 0 ? "text-blue-600" : "text-red-500"}`}>
                          {h.ev > 0 ? "+" : ""}{h.ev.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Row 3: 参照買い目 ── */}
        {score && (
          <div>
            <div className="text-xs text-gray-400 mb-2 border-b border-gray-200 pb-1">
              参照買い目 <span className="text-gray-300">— EV・モデル確率ベース自動生成</span>
            </div>
            <BetTicketSection score={score} />
          </div>
        )}
      </div>
    </main>
  );
}
