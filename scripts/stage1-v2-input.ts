/** Development adapter; raw data remains unchanged. Non-flat prior rows are only abstention evidence. */
import { prepareInput } from "./simulator/input";
import { frozenClone, isoDate } from "./simulator/canonical";
import { classifyRaceKind } from "./simulator/race-kind";
import type { Dataset, History, PreRaceInput, RaceSpec } from "./simulator/types";
const VENUES = ["札幌", "函館", "福島", "新潟", "東京", "中山", "中京", "京都", "阪神", "小倉"];
export function isJraFlat(row: History): boolean {
  const code = row.netKeibaRaceId?.match(/^\d{4}(0[1-9]|10)\d{6}$/)?.[1];
  return !!code && VENUES[Number(code) - 1] === row.venue && ["芝", "ダ"].includes(row.surface!);
}
export function prepareInputV2(race: RaceSpec, histories: Dataset["historyByHorse"]): PreRaceInput {
  const base = prepareInput(race, histories);
  return frozenClone({ ...base, horses: base.horses.map(h => ({ ...h,
    history: histories[h.horseId].filter(r => isoDate(r.date) < base.date && r.netKeibaRaceId !== race.raceId).map(r => {
      const kind = classifyRaceKind({ surface: r.surface, raceName: r.raceName }).kind;
      return { ...r, date: isoDate(r.date), surface: kind === "unknown" ? null : kind };
    }).sort((a, b) => a.date.localeCompare(b.date) || (a.netKeibaRaceId ?? "").localeCompare(b.netKeibaRaceId ?? ""))
  })) });
}
