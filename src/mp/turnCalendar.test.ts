import { describe, expect, it } from "vitest";
import {
  formatServerTurnDate,
  serverCalendarTurn,
  serverStartingYear,
  type ServerTurnClock,
} from "./turnCalendar";

/**
 * The MP turn clock is 1-based and RAW (the server counts founding turns),
 * while AHDGame's LARP calendar is 1-based and CALENDAR (founding turns are
 * subtracted, and the date is pinned to the era start while founding runs).
 *
 * Reference: AHDGame src/lib/utils/gameDate.ts `calendarTurn` and
 * src/lib/utils/formatters.ts `rawTurnToLarpDate` / `turnToLarpDate`.
 * Vectors mirror `turnToLarpParts` exactly: 48 turns per year, 4 weeks per
 * month, turn 1 = January, Week 1 of `startingYear`.
 */
const base: ServerTurnClock = { currentTurn: 1, startingYear: 1953 };

describe("serverCalendarTurn", () => {
  it("is identity on a normal 1-based world", () => {
    expect(serverCalendarTurn({ ...base, currentTurn: 12 })).toBe(12);
    expect(serverCalendarTurn({ ...base, currentTurn: 48 })).toBe(48);
    expect(serverCalendarTurn({ ...base, currentTurn: 49 })).toBe(49);
  });

  it("pins the calendar to turn 1 while the founding phase is active", () => {
    expect(
      serverCalendarTurn({ currentTurn: 7, startingYear: 1953, preIterationActive: true, preIterationTurns: 0 }),
    ).toBe(1);
  });

  it("subtracts the founding offset once the founding phase ends", () => {
    expect(
      serverCalendarTurn({ currentTurn: 5, startingYear: 1953, preIterationTurns: 3 }),
    ).toBe(2);
  });

  it("never returns a turn below 1 and ignores malformed offsets", () => {
    expect(serverCalendarTurn({ currentTurn: 2, startingYear: 1953, preIterationTurns: 99 })).toBe(1);
    expect(
      serverCalendarTurn({ currentTurn: 2, startingYear: 1953, preIterationTurns: Number.NaN }),
    ).toBe(2);
    expect(serverCalendarTurn({ currentTurn: 2, startingYear: 1953, preIterationTurns: -4 })).toBe(2);
  });
});

describe("formatServerTurnDate", () => {
  it("renders the reference LARP date for ordinary turns", () => {
    expect(formatServerTurnDate({ ...base, currentTurn: 1 })).toBe("January, Week 1, 1953");
    expect(formatServerTurnDate({ ...base, currentTurn: 4 })).toBe("January, Week 4, 1953");
    expect(formatServerTurnDate({ ...base, currentTurn: 5 })).toBe("February, Week 1, 1953");
    expect(formatServerTurnDate({ ...base, currentTurn: 48 })).toBe("December, Week 4, 1953");
    expect(formatServerTurnDate({ ...base, currentTurn: 49 })).toBe("January, Week 1, 1954");
  });

  it("honors the preset starting year", () => {
    expect(formatServerTurnDate({ currentTurn: 27, startingYear: 1991 })).toBe("July, Week 3, 1991");
    expect(formatServerTurnDate({ currentTurn: 27, startingYear: 2019 })).toBe("July, Week 3, 2019");
  });

  it("freezes at the era start while founding, then resumes after the offset", () => {
    expect(
      formatServerTurnDate({
        currentTurn: 7,
        startingYear: 1953,
        preIterationActive: true,
        preIterationTurns: 0,
      }),
    ).toBe("January, Week 1, 1953");
    expect(
      formatServerTurnDate({ currentTurn: 5, startingYear: 1953, preIterationTurns: 3 }),
    ).toBe("January, Week 2, 1953");
  });
});

describe("serverStartingYear", () => {
  it("uses the reported starting year when present", () => {
    expect(serverStartingYear({ currentTurn: 49, currentYear: 1954, startingYear: 1953 })).toBe(1953);
  });

  it("derives the era start from the pinned year when the field is absent", () => {
    // Turn 49 is January of the second calendar year.
    expect(serverStartingYear({ currentTurn: 49, currentYear: 1954 })).toBe(1953);
    expect(serverStartingYear({ currentTurn: 96, currentYear: 1954 })).toBe(1953);
    expect(serverStartingYear({ currentTurn: 97, currentYear: 1955 })).toBe(1953);
  });

  it("honors the founding offset and the founding freeze when deriving", () => {
    expect(
      serverStartingYear({ currentTurn: 52, currentYear: 1953, preIterationTurns: 4 }),
    ).toBe(1953);
    expect(
      serverStartingYear({ currentTurn: 7, currentYear: 1953, preIterationActive: true }),
    ).toBe(1953);
  });
});
