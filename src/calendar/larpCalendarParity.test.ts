import { describe, expect, it } from "vitest";
import { formatGameDate, type GameClock } from "../game/gameDate";
import { formatServerTurnDate } from "../mp/turnCalendar";

/**
 * Singleplayer and multiplayer must render the same calendar for the same
 * world (#510). SP dates its world from the local engine clock (an ISO day
 * plus a 0-based Native turn); MP projects the server's raw 1-based turn
 * with the founding offset. Both must land on the same "Month, Week N,
 * Year" string, or the two modes would show different dates for one world.
 *
 * The engine clock and the server clock are deliberately different
 * representations of the same turn, so this test pins the conversion:
 * Native turn T is reference turn T+1, and the server's raw turn already
 * counts from 1.
 */
const EPOCH = "1953-01-05";
const EPOCH_1991 = "1991-01-07";

function isoDaysAfterEpoch(days: number, epoch: string = EPOCH): string {
  const base = Date.parse(`${epoch}T00:00:00Z`);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

function spClock(turn: number, extra: Partial<GameClock> = {}, epoch: string = EPOCH): GameClock {
  return { turn, date: isoDaysAfterEpoch(turn * 7, epoch), ...extra };
}

describe("SP and MP render the same calendar", () => {
  it("matches on an ordinary world across the year", () => {
    for (const turn of [0, 1, 3, 11, 12, 47, 48, 95, 96]) {
      const sp = formatGameDate(spClock(turn).date, spClock(turn));
      const mp = formatServerTurnDate({ currentTurn: turn + 1, startingYear: 1953 });
      expect(mp).toBe(sp);
    }
  });

  it("matches while the founding phase is running", () => {
    const clock = spClock(6, { foundingActive: true, foundingOffset: 0 });
    const sp = formatGameDate(clock.date, clock);
    const mp = formatServerTurnDate({
      currentTurn: 7,
      startingYear: 1953,
      preIterationActive: true,
      preIterationTurns: 0,
    });
    expect(mp).toBe(sp);
    expect(sp).toBe("January, Week 1, 1953");
  });

  it("matches after the founding phase burned turns", () => {
    const clock = spClock(6, { foundingOffset: 3 });
    const sp = formatGameDate(clock.date, clock);
    const mp = formatServerTurnDate({
      currentTurn: 7,
      startingYear: 1953,
      preIterationTurns: 3,
    });
    expect(mp).toBe(sp);
  });

  it("matches on another preset era", () => {
    const clock = spClock(20, {}, EPOCH_1991);
    const sp = formatGameDate(clock.date, clock);
    const mp = formatServerTurnDate({ currentTurn: 21, startingYear: 1991 });
    expect(mp).toBe(sp);
    expect(sp).toContain("1991");
  });
});
