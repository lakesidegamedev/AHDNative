import { describe, expect, it, vi } from "vitest";
import { MpModeSession } from "./adapter";
import type { MpBridgeHost } from "./bridge";

/**
 * MP turn freshness (#359 latest-turn slice). `/api/game/turn/status` is
 * public and independently pollable, so the screen can keep showing the
 * latest MP turn without re-reading the whole authenticated projection on a
 * timer. A failed turn poll keeps the last good turn, never expires the
 * session, and never claims a turn the server did not report.
 */
const USER = "507f1f77bcf86cd799439011";
const NOTE = "607f1f77bcf86cd799439011";
const probe = JSON.stringify({ active: true, sub: USER, username: "Ada" });
const me = JSON.stringify({
  character: { _id: "c1", name: "Ada", party: "Labor", homeState: "CA", cashOnHand: 1000, actions: 3, countryId: "US" },
  corporation: null,
});
const inbox = JSON.stringify({
  notifications: [{ _id: NOTE, title: "Turn processed", message: "Done", read: false }],
  unreadCount: 1,
  total: 1,
  hasMore: false,
});
const caps = JSON.stringify({ user: null, hasCharacter: false });
const turn = (currentTurn: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    currentTurn,
    currentYear: 1953,
    startingYear: 1953,
    isActive: true,
    isProcessing: false,
    nextScheduledTurn: null,
    ...extra,
  });

function scriptedHost(scripts: {
  fetch?: Record<string, Array<string | { reject: string }>>;
}): { host: MpBridgeHost; calls: string[] } {
  const calls: string[] = [];
  const queues = new Map<string, Array<string | { reject: string }>>();
  for (const [op, items] of Object.entries(scripts.fetch ?? {})) queues.set(`fetch:${op}`, [...items]);
  return {
    calls,
    host: {
      fetch: vi.fn(async (op: string) => {
        calls.push(`fetch:${op}`);
        const item = queues.get(`fetch:${op}`)?.shift();
        if (typeof item === "string") return item;
        if (item) throw new Error(item.reject);
        throw new Error(`unexpected call fetch:${op}`);
      }),
      mutate: vi.fn(async () => {
        throw new Error("unexpected mutate");
      }),
      beginSignIn: vi.fn(async () => {}),
    },
  };
}

function enterScripts(extra?: Record<string, Array<string | { reject: string }>>) {
  return {
    fetch: {
      "auth-session": [probe],
      "character-me": [me],
      "turn-status": [turn(12)],
      "client-nav": [caps],
      notifications: [inbox],
      ...extra,
    },
  };
}

describe("MpModeSession loadTurnStatus", () => {
  it("refreshes only the turn projection and keeps the loaded session intact", async () => {
    const { host, calls } = scriptedHost(
      enterScripts({
        "turn-status": [turn(12), turn(13, { lastMarketTickAt: "2026-09-17T12:15:00.000Z" })],
      }),
    );
    const session = new MpModeSession(host);
    const entered = await session.enter();
    expect(entered.turn?.currentTurn).toBe(12);
    const snapshot = await session.loadTurnStatus();
    expect(snapshot.turn?.currentTurn).toBe(13);
    expect(snapshot.turn?.lastMarketTickAt).toBe("2026-09-17T12:15:00.000Z");
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.character?.name).toBe("Ada");
    expect(snapshot.capabilities).not.toBeNull();
    expect(snapshot.inbox?.unreadCount).toBe(1);
    expect(snapshot.error).toBeNull();
    expect(calls.filter((call) => call === "fetch:turn-status")).toHaveLength(2);
    expect(calls).toEqual([
      "fetch:auth-session",
      "fetch:character-me",
      "fetch:turn-status",
      "fetch:client-nav",
      "fetch:notifications",
      "fetch:turn-status",
    ]);
  });

  it("keeps the last good turn on a refusal, rate limit, or malformed body", async () => {
    const { host } = scriptedHost(
      enterScripts({
        "turn-status": [
          turn(12),
          { reject: "remote-error:429:60:Rate limited" },
          JSON.stringify({ error: "Game state not initialized" }),
          { reject: "transport:session-unavailable:window closed" },
        ],
      }),
    );
    const session = new MpModeSession(host);
    await session.enter();
    for (let i = 0; i < 3; i += 1) {
      const snapshot = await session.loadTurnStatus();
      expect(snapshot.turn?.currentTurn).toBe(12);
      expect(snapshot.phase).toBe("ready");
      expect(snapshot.error).toBeNull();
    }
  });

  it("does nothing without a signed-in session", async () => {
    const { host, calls } = scriptedHost({ fetch: {} });
    const session = new MpModeSession(host);
    const snapshot = await session.loadTurnStatus();
    expect(snapshot.turn).toBeNull();
    expect(snapshot.phase).toBe("idle");
    expect(calls).toEqual([]);
  });
});
