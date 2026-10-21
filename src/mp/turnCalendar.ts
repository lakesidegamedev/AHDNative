import { formatLarpDate, TURNS_PER_YEAR } from "../calendar/larpCalendar";

/**
 * Shared server-turn calendar (#510 latest-MP-turn slice).
 *
 * AHDGame's turn clock is 1-based and RAW: a world with a founding phase
 * burns `preIterationTurns` before its calendar starts. The player-facing
 * calendar is the CALENDAR turn (founding turns subtracted, pinned at turn
 * 1 while `preIterationActive`). The reference does the same conversion in
 * src/lib/utils/gameDate.ts `calendarTurn` before every date render, and
 * `rawTurnToLarpDate` in src/lib/utils/formatters.ts is the formatter.
 *
 * Native's SP clock is 0-based (`formatGameTurn`), so the shared output is
 * the reference 1-based calendar rendered through the shared
 * `src/calendar/larpCalendar.ts` helpers. This is the one place an MP
 * payload becomes a player-facing date; the footer and the World turn card
 * must not format it independently, and this module must not depend on the
 * offline engine.
 */
export interface ServerTurnClock {
  /** Raw server turn, 1-based. */
  currentTurn: number;
  /** Calendar year of turn 1 for the active reset preset. */
  startingYear: number;
  /** Founding phase running: the calendar is pinned to the era start. */
  preIterationActive?: boolean;
  /** Founding turns burned once the founding phase ends. */
  preIterationTurns?: number | null;
}

export interface ServerTurnYearSource {
  /** Raw server turn, 1-based. */
  currentTurn: number;
  /** Pinned display year reported by turn-status. */
  currentYear: number;
  /** Reported era start; derived from `currentYear` when absent. */
  startingYear?: number | null;
  preIterationActive?: boolean;
  preIterationTurns?: number | null;
}

function foundingOffset(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function rawTurn(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

/** Display calendar turn for a raw server turn; reference `calendarTurn`. */
export function serverCalendarTurn(clock: ServerTurnClock): number {
  if (clock.preIterationActive === true) return 1;
  return Math.max(1, rawTurn(clock.currentTurn) - foundingOffset(clock.preIterationTurns));
}

/**
 * Era start year. Prefers the server's `startingYear` (a preset-era value
 * like 1953/1991/2019) and otherwise reconstructs it from the pinned
 * `currentYear` and the calendar turn, so a missing field cannot shift the
 * rendered year by one.
 */
export function serverStartingYear(source: ServerTurnYearSource): number {
  if (typeof source.startingYear === "number" && Number.isFinite(source.startingYear)) {
    return Math.floor(source.startingYear);
  }
  const year = Number.isFinite(source.currentYear) ? Math.floor(source.currentYear) : 0;
  const calendar = serverCalendarTurn({
    currentTurn: source.currentTurn,
    startingYear: year,
    preIterationActive: source.preIterationActive,
    preIterationTurns: source.preIterationTurns,
  });
  return year - Math.floor((calendar - 1) / TURNS_PER_YEAR);
}

/**
 * Player-facing LARP date for a server turn: "April, Week 3, 1953", exactly
 * the reference `rawTurnToLarpDate` output. Never renders the raw turn count
 * as a year, and never advances the date while the founding freeze is on.
 */
export function formatServerTurnDate(clock: ServerTurnClock): string {
  const startingYear =
    typeof clock.startingYear === "number" && Number.isFinite(clock.startingYear)
      ? Math.floor(clock.startingYear)
      : 0;
  const calendar = serverCalendarTurn(clock);
  // The shared calendar counts reference turns from 1.
  return formatLarpDate(calendar, startingYear);
}
