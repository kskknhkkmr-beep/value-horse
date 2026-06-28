import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";
import { races } from "@/lib/mockData";
import type { RacesCache } from "@/scripts/fetch-races";

function loadRacesCache(): RacesCache | null {
  try {
    const p = join(process.cwd(), "lib", "races-cache.json");
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf-8")) as RacesCache;
    return raw.races?.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const cache = loadRacesCache();
  if (cache) {
    // latestDates がなければ dates の末尾2件（土日）を使用
    const latestDates = cache.latestDates ?? cache.dates.slice(-2);
    const visible = cache.races.filter((r) => latestDates.includes(r.date));
    return NextResponse.json(
      visible.map((r) => ({
        id: r.id,
        date: r.date,
        venue: r.venue,
        raceNumber: r.raceNumber,
        raceName: r.raceName,
        postTime: r.postTime,
      }))
    );
  }
  return NextResponse.json(races);
}
