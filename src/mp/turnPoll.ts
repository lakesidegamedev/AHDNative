import type { MpTurnView } from "./validators";

/**
 * MP turn freshness cadence (#510 latest-MP-turn slice).
 *
 * Pinned to AHDGame src/hooks/useGameEvents.ts `nextPollDelay`: the
 * reference status bar polls every 1.5s while the turn worker runs, tightens
 * to 15s inside two minutes of the next turn (or the quarter-hour market
 * tick), 60s within ten minutes, relaxes to 120s otherwise, and backs off to
 * 300s while the tab is hidden. Native mirrors those numbers so an open MP
 * screen references the latest server turn instead of the mount snapshot.
 */
export const MARKET_TICK_INTERVAL_MS = 15 * 60_000;
export const TURN_POLL_PROCESSING_MS = 1_500;
export const TURN_POLL_NEAR_MS = 15_000;
export const TURN_POLL_SOON_MS = 60_000;
export const TURN_POLL_RELAXED_MS = 120_000;
export const TURN_POLL_HIDDEN_MS = 300_000;

export type TurnPollState = Pick<MpTurnView, "isProcessing" | "isActive" | "nextScheduledTurn">;

export function turnPollDelay(
  turn: TurnPollState | null,
  now: Date = new Date(),
  visibility: "visible" | "hidden" = "visible",
): number {
  if (visibility === "hidden") return TURN_POLL_HIDDEN_MS;
  if (!turn) return TURN_POLL_RELAXED_MS;
  if (turn.isProcessing) return TURN_POLL_PROCESSING_MS;
  if (turn.isActive === false || !turn.nextScheduledTurn) return TURN_POLL_RELAXED_MS;
  const nextTurn = Date.parse(turn.nextScheduledTurn);
  if (!Number.isFinite(nextTurn)) return TURN_POLL_RELAXED_MS;
  const nextMarket =
    (Math.floor(now.getTime() / MARKET_TICK_INTERVAL_MS) + 1) * MARKET_TICK_INTERVAL_MS;
  const diff = Math.min(nextTurn, nextMarket) - now.getTime();
  if (diff < 120_000) return TURN_POLL_NEAR_MS;
  if (diff < 600_000) return TURN_POLL_SOON_MS;
  return TURN_POLL_RELAXED_MS;
}
