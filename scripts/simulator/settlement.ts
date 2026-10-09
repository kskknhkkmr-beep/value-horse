import { canonical, developmentDate } from "./canonical";
import type { Run, Ticket, Truth } from "./types";

export type Settlement = Ticket & {
  status: "win" | "loss" | "refunded" | "unresolved";
  returnYen: number | null; profitYen: number | null; note: string | null;
};
export type Event = { raceId: string; date: string; archivedStartTime: string | null; settlements: Settlement[] };
const arity = { tan: 1, fuku: 1, wide: 2, umaren: 2, umatan: 2, sanfuku: 3, santan: 3 };
const selection = (kind: Ticket["kind"], horses: number[]) =>
  ["wide", "umaren", "sanfuku"].includes(kind) ? [...horses].sort((a, b) => a - b) : [...horses];
export function settleTicket(ticket: Ticket, truth: Truth): Settlement {
  developmentDate(truth.date);
  if (!Number.isSafeInteger(ticket.stakeYen) || ticket.stakeYen <= 0 || ticket.stakeYen % 100 ||
      !Object.hasOwn(arity, ticket.kind) || ticket.horses.length !== arity[ticket.kind] ||
      new Set(ticket.horses).size !== ticket.horses.length ||
      ticket.horses.some((n) => !Number.isInteger(n) || n < 1 || n > 18)) throw new Error("Invalid stake/selection");
  const unresolved = (note: string): Settlement => ({ ...ticket, status: "unresolved", returnYen: null, profitYen: null, note });
  const selected = selection(ticket.kind, ticket.horses);
  const refund = truth.refunds?.find((r) => r.kind === ticket.kind &&
    canonical(selection(r.kind, r.horses)) === canonical(selected));
  if (refund) {
    if (!refund.evidence) return unresolved("Refund has no verified evidence");
    return { ...ticket, status: "refunded", returnYen: ticket.stakeYen, profitYen: 0, note: refund.evidence };
  }
  const field = new Map(truth.horses.map((h) => [h.horseNumber, h]));
  if (ticket.horses.some((n) => !field.has(n) || /^(取|除)/.test(field.get(n)?.positionRaw ?? ""))) {
    return unresolved("Absent/cancelled entrant: ticket-specific refund data required");
  }
  const payout = truth.payouts[ticket.kind];
  if (!payout || payout.status !== "ok" || !payout.entries.length) return unresolved("Missing/refund/unoffered/unparsed payout is NOT a losing ticket");
  if ((payout.rawCombination && payout.rawCombination.trim().split(/\s+/).length !== payout.entries.length) ||
      (payout.rawPayout && payout.rawPayout.trim().split(/\s+/).length !== payout.entries.length)) {
    return unresolved("Raw payout rows and parsed entries do not match");
  }
  const seen = new Set<string>();
  let amount: number | undefined;
  for (const entry of payout.entries) {
    const numbers = entry.horse == null ? entry.combo : [entry.horse];
    if (!numbers || numbers.length !== arity[ticket.kind] || new Set(numbers).size !== numbers.length ||
        numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 18) ||
        !Number.isSafeInteger(entry.payout) || entry.payout <= 0) return unresolved("Malformed confirmed payout");
    const key = canonical(selection(ticket.kind, numbers));
    if (seen.has(key)) return unresolved("Duplicate confirmed payout combination"); seen.add(key);
    if (key === canonical(selected)) amount = entry.payout;
  }
  const returnYen = amount == null ? 0 : amount * (ticket.stakeYen / 100);
  if (!Number.isSafeInteger(returnYen)) throw new Error("Unsafe yen arithmetic");
  return { ...ticket, status: amount == null ? "loss" : "win", returnYen,
    profitYen: returnYen - ticket.stakeYen, note: null };
}

/** Explicit evaluation API. Never called by loading, prediction or persistence. */
export function settleRun(run: Run): Event[] {
  return run.records.map((r) => ({ raceId: r.raceId, date: r.date,
    archivedStartTime: r.actual.archivedStartTime, settlements: r.tickets.map((t) => settleTicket(t, r.actual)) }));
}

/** Race-level, chronological accounting, not horse-level accuracy. */
export function metrics(events: Event[]) {
  if (new Set(events.map((e) => e.raceId)).size !== events.length) throw new Error("Duplicate settlement race");
  const ordered = [...events].sort((a, b) => a.date.localeCompare(b.date) ||
    (a.archivedStartTime?.padStart(5, "0") ?? "99:99").localeCompare(b.archivedStartTime?.padStart(5, "0") ?? "99:99") ||
    a.raceId.localeCompare(b.raceId));
  let grossStakeYen = 0, refundYen = 0, returnYen = 0, equity = 0, peak = 0, maxDrawdownYen = 0;
  let betRaces = 0, hitRaces = 0, tickets = 0, hitTickets = 0, streak = 0, maxNoHitStreak = 0;
  let previousHit: { index: number; betIndex: number; date: string; raceId: string } | null = null;
  const hitIntervals: Array<{ fromRaceId: string; toRaceId: string; raceGap: number; betRaceGap: number; calendarDays: number }> = [];
  const curve: Array<{ raceId: string; profitYen: number; equityYen: number; drawdownYen: number }> = [];
  for (const [index, event] of ordered.entries()) {
    developmentDate(event.date);
    if (event.archivedStartTime && !/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(event.archivedStartTime)) throw new Error("Invalid event clock");
    if (event.settlements.some((s) => s.status === "unresolved" || s.returnYen === null || s.profitYen === null)) {
      throw new Error("Resolve missing/refund/parse issues before computing metrics");
    }
    for (const s of event.settlements) {
      if (!["win", "loss", "refunded"].includes(s.status) || !Number.isSafeInteger(s.stakeYen) || s.stakeYen <= 0 || s.stakeYen % 100 ||
          !Number.isSafeInteger(s.returnYen) || s.returnYen! < 0 || s.profitYen !== s.returnYen! - s.stakeYen ||
          (s.status === "loss" && s.returnYen !== 0) || (s.status === "win" && s.returnYen! <= 0) ||
          (s.status === "refunded" && s.returnYen !== s.stakeYen)) throw new Error("Invalid settlement accounting");
    }
    const risked = event.settlements.filter((s) => s.status !== "refunded");
    grossStakeYen += event.settlements.reduce((n, s) => n + s.stakeYen, 0);
    refundYen += event.settlements.filter((s) => s.status === "refunded").reduce((n, s) => n + s.stakeYen, 0);
    returnYen += event.settlements.reduce((n, s) => n + s.returnYen!, 0);
    const profitYen = event.settlements.reduce((n, s) => n + s.profitYen!, 0);
    equity += profitYen; peak = Math.max(peak, equity);
    maxDrawdownYen = Math.max(maxDrawdownYen, peak - equity);
    curve.push({ raceId: event.raceId, profitYen, equityYen: equity, drawdownYen: peak - equity });
    if (!risked.length) continue; // No bet/refund-only does not break or extend a miss streak.
    betRaces++; tickets += risked.length;
    const hits = risked.filter((s) => s.status === "win").length; hitTickets += hits;
    if (hits) {
      hitRaces++; streak = 0;
      if (previousHit) hitIntervals.push({ fromRaceId: previousHit.raceId, toRaceId: event.raceId,
        raceGap: index - previousHit.index, betRaceGap: betRaces - previousHit.betIndex,
        calendarDays: (Date.parse(`${event.date}T00:00:00Z`) - Date.parse(`${previousHit.date}T00:00:00Z`)) / 86400000 });
      previousHit = { index, betIndex: betRaces, date: event.date, raceId: event.raceId };
    } else { streak++; maxNoHitStreak = Math.max(maxNoHitStreak, streak); }
  }
  const riskedYen = grossStakeYen - refundYen, profitYen = returnYen - grossStakeYen;
  if (![grossStakeYen, returnYen, profitYen, maxDrawdownYen].every(Number.isSafeInteger)) throw new Error("Unsafe aggregate yen arithmetic");
  return { grossStakeYen, refundYen, riskedYen, returnYen, profitYen,
    roiNet: riskedYen ? profitYen / riskedYen : null, betRaces, hitRaces,
    raceHitRate: betRaces ? hitRaces / betRaces : null, tickets, hitTickets,
    ticketHitRate: tickets ? hitTickets / tickets : null, maxDrawdownYen, maxNoHitStreak, hitIntervals, curve,
    chronology: "archived start time, then race ID; actual off-time not verified",
    missingStartTimes: ordered.filter((e) => !e.archivedStartTime).length };
}
