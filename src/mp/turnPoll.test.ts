import { describe, expect, it } from "vitest";
import {
  MARKET_TICK_INTERVAL_MS,
  TURN_POLL_HIDDEN_MS,
  TURN_POLL_NEAR_MS,
  TURN_POLL_PROCESSING_MS,
  TURN_POLL_RELAXED_MS,
  TURN_POLL_SOON_MS,
  turnPollDelay,
} from "./turnPoll";

/**
 * Turn freshness cadence. Pinned to the reference status poller
 * (AHDGame src/hooks/useGameEvents.ts `nextPollDelay`): 1.5s while the turn
 * worker is processing, 15s inside two minutes of the next turn or market
 * tick, 60s within ten minutes, 120s otherwise, 300s while the tab is hidden.
 * A screen that does not follow this cadence shows a stale MP turn.
 */
const NOW = new Date("2026-09-17T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe("turnPollDelay", () => {
  it("polls hard while the server is processing a turn", () => {
    expect(turnPollDelay({ isProcessing: true, isActive: true, nextScheduledTurn: at(45 * 60_000) }, NOW)).toBe(
      TURN_POLL_PROCESSING_MS,
    );
  });

  it("backs off while the tab is hidden, even during processing", () => {
    expect(
      turnPollDelay({ isProcessing: true, isActive: true, nextScheduledTurn: null }, NOW, "hidden"),
    ).toBe(TURN_POLL_HIDDEN_MS);
  });

  it("relaxes when there is no turn yet, no schedule, or an inactive world", () => {
    expect(turnPollDelay(null, NOW)).toBe(TURN_POLL_RELAXED_MS);
    expect(turnPollDelay({ isProcessing: false, isActive: true, nextScheduledTurn: null }, NOW)).toBe(
      TURN_POLL_RELAXED_MS,
    );
    expect(turnPollDelay({ isProcessing: false, isActive: false, nextScheduledTurn: at(60_000) }, NOW)).toBe(
      TURN_POLL_RELAXED_MS,
    );
    expect(turnPollDelay({ isProcessing: false, isActive: true, nextScheduledTurn: "not-a-date" }, NOW)).toBe(
      TURN_POLL_RELAXED_MS,
    );
  });

  it("polls soon when the next turn is minutes away", () => {
    expect(turnPollDelay({ isProcessing: false, isActive: true, nextScheduledTurn: at(5 * 60_000) }, NOW)).toBe(
      TURN_POLL_SOON_MS,
    );
  });

  it("polls near when the next turn is under two minutes away or overdue", () => {
    expect(turnPollDelay({ isProcessing: false, isActive: true, nextScheduledTurn: at(60_000) }, NOW)).toBe(
      TURN_POLL_NEAR_MS,
    );
    expect(turnPollDelay({ isProcessing: false, isActive: true, nextScheduledTurn: at(-60_000) }, NOW)).toBe(
      TURN_POLL_NEAR_MS,
    );
  });

  it("watches the quarter-hour market tick as well as the turn boundary", () => {
    // NOW sits exactly on a quarter boundary, so the next market tick is 15m out.
    expect(turnPollDelay({ isProcessing: false, isActive: true, nextScheduledTurn: at(45 * 60_000) }, NOW)).toBe(
      TURN_POLL_RELAXED_MS,
    );
    // 14m10s in: the 12:15 tick is 50s away, so tighten even though the turn is far.
    const nearMarket = new Date(NOW.getTime() + 14 * 60_000 + 10_000);
    expect(
      turnPollDelay({ isProcessing: false, isActive: true, nextScheduledTurn: at(45 * 60_000) }, nearMarket),
    ).toBe(TURN_POLL_NEAR_MS);
    expect(MARKET_TICK_INTERVAL_MS).toBe(15 * 60_000);
  });
});
