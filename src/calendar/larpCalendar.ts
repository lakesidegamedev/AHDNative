/**
 * The reference "LARP" calendar, shared by every mode (#226, #510).
 *
 * 48 turns = 1 year = 12 months of exactly 4 weeks. The reference numbers
 * turns from 1 (AHDGame `src/lib/utils/formatters.ts` `turnToLarpParts`:
 * `turnsInYear = ((turn - 1) % 48) + 1`, `year = startingYear + floor((turn -
 * 1) / 48)`), so turn 1 is January, Week 1 of the era's starting year, and
 * the reference renders it as `Month, Week N, Year`.
 *
 * This module is deliberately dependency-free. Singleplayer derives the
 * calendar from the local engine clock (`src/game/gameDate.ts`) and the
 * multiplayer layer projects it from the server's raw turn
 * (`src/mp/turnCalendar.ts`); neither may depend on the other, so the shared
 * arithmetic lives here instead of in either layer.
 */

export const TURNS_PER_YEAR = 48;

/** Month names in reference order; only ever indexed 0..11. */
export const LARP_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export interface LarpDateParts {
  month: string;
  weekOfMonth: number;
  year: number;
}

/**
 * Reference calendar position of a 1-based reference turn: month,
 * week-within-month and year. Mirrors AHDGame `turnToLarpParts` exactly.
 */
export function larpDateParts(referenceTurn: number, startingYear: number): LarpDateParts {
  const turn = Number.isFinite(referenceTurn) && referenceTurn >= 1 ? Math.floor(referenceTurn) : 1;
  const year = Number.isFinite(startingYear) ? Math.floor(startingYear) : 0;
  const turnsInYear = ((turn - 1) % TURNS_PER_YEAR) + 1;
  return {
    month: LARP_MONTHS[Math.floor((turnsInYear - 1) / 4)] ?? LARP_MONTHS[0],
    weekOfMonth: ((turnsInYear - 1) % 4) + 1,
    year: year + Math.floor((turn - 1) / TURNS_PER_YEAR),
  };
}

/** Player-facing date for a 1-based reference turn: "April, Week 3, 1953". */
export function formatLarpDate(referenceTurn: number, startingYear: number): string {
  const { month, weekOfMonth, year } = larpDateParts(referenceTurn, startingYear);
  return `${month}, Week ${weekOfMonth}, ${year}`;
}
