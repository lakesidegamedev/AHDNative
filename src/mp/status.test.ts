import { describe, expect, it, vi } from "vitest";
import { MpModeSession } from "./adapter";
import type { MpBridgeHost } from "./bridge";

/**
 * MP status-bar read (#510 footer parity). GET /api/client-status
 * (pinned to `layout=minimal` by the Rust bridge) answers the action
 * count, action cap, campaign funds, cash, political influence and
 * favorability the persistent footer shows. The read is independent of
 * enter/refresh: every failure keeps the last good figures, never expires
 * the session, and never invents a value.
 */
const USER = "507f1f77bcf86cd799439011";
const probe = JSON.stringify({ active: true, sub: USER, username: "Ada" });
const me = JSON.stringify({
  character: { _id: "c1", name: "Ada", party: "Labor", homeState: "CA", cashOnHand: 1000, actions: 3, countryId: "US" },
  corporation: null,
});
const inbox = JSON.stringify({
  notifications: [{ _id: "607f1f77bcf86cd799439011", title: "Turn processed", message: "Done", read: false }],
  unreadCount: 1,
  total: 1,
  hasMore: false,
});
const caps = JSON.stringify({ user: null, hasCharacter: false, funds: 900 });
const turn = JSON.stringify({ currentTurn: 12, currentYear: 1953, startingYear: 1953, isActive: true, isProcessing: false, nextScheduledTurn: null });
const status = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "Ada",
    actions: 3,
    actionCap: 5,
    hoardThreshold: 4,
    funds: 1200,
    campaignFundsStored: 1200,
    cashOnHand: 5400,
    personalHomeLiquid: 5200,
    homeCurrency: "USD",
    donorBaseLevel: 2,
    politicalInfluence: 61,
    favorability: 55,
    ...over,
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
      "turn-status": [turn],
      "client-nav": [caps],
      notifications: [inbox],
      ...extra,
    },
  };
}

describe("MpModeSession loadFullStatus", () => {
  const full = JSON.stringify({
    name: "Ada",
    actions: 3,
    funds: 1200,
    cashOnHand: 1000,
    homeCurrency: "USD",
    campaignIncomeBreakdown: {
      populationTier: "large",
      baseGen: 500,
      donorBonus: 120,
      officeBonus: 80,
      unionContribution: 40,
      stateTax: 60,
      nationalTax: 90,
      totalTax: 150,
      netPerTurn: 590,
    },
  });

  it("projects the per-turn campaign income lines", async () => {
    const { host, calls } = scriptedHost(
      enterScripts({ "client-status-full": [full] }),
    );
    const session = new MpModeSession(host);
    await session.enter();
    const snapshot = await session.loadFullStatus();
    expect(snapshot.status?.campaignIncomeBreakdown?.netPerTurn).toBe(590);
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.error).toBeNull();
    expect(calls.filter((call) => call === "fetch:client-status-full")).toHaveLength(1);
  });

  it("keeps the last good view when the wide read fails", async () => {
    const { host } = scriptedHost(
      enterScripts({
        "client-status-full": [full, { reject: "remote-error:500:Server error" }],
      }),
    );
    const session = new MpModeSession(host);
    await session.enter();
    await session.loadFullStatus();
    const snapshot = await session.loadFullStatus();
    expect(snapshot.status?.campaignIncomeBreakdown?.netPerTurn).toBe(590);
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.error).toBeNull();
  });

  it("does nothing without a signed-in session", async () => {
    const { host, calls } = scriptedHost({ fetch: {} });
    const session = new MpModeSession(host);
    const snapshot = await session.loadFullStatus();
    expect(snapshot.status).toBeNull();
    expect(snapshot.phase).toBe("idle");
    expect(calls).toEqual([]);
  });
});

describe("MpModeSession loadStatus", () => {
  it("projects the status scalars and keeps the loaded session intact", async () => {
    const { host, calls } = scriptedHost(
      enterScripts({ "client-status": [status()] }),
    );
    const session = new MpModeSession(host);
    await session.enter();
    const snapshot = await session.loadStatus();
    expect(snapshot.status).toMatchObject({
      actions: 3,
      actionCap: 5,
      funds: 1200,
      cashOnHand: 5400,
      politicalInfluence: 61,
      favorability: 55,
      homeCurrency: "USD",
    });
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.character?.name).toBe("Ada");
    expect(snapshot.turn?.currentTurn).toBe(12);
    expect(snapshot.error).toBeNull();
    expect(calls.filter((call) => call === "fetch:client-status")).toHaveLength(1);
  });

  it("keeps the last good status on a refusal, a malformed body, and an account without a character", async () => {
    const { host } = scriptedHost(
      enterScripts({
        "client-status": [
          status(),
          { reject: "remote-error:429:60:Rate limited" },
          JSON.stringify({ status: "no-character" }),
          JSON.stringify({ name: "Ada" }),
        ],
      }),
    );
    const session = new MpModeSession(host);
    await session.enter();
    await session.loadStatus();
    for (let i = 0; i < 3; i += 1) {
      const snapshot = await session.loadStatus();
      expect(snapshot.status?.politicalInfluence).toBe(61);
      expect(snapshot.phase).toBe("ready");
      expect(snapshot.error).toBeNull();
    }
  });

  it("does nothing without a signed-in session", async () => {
    const { host, calls } = scriptedHost({ fetch: {} });
    const session = new MpModeSession(host);
    const snapshot = await session.loadStatus();
    expect(snapshot.status).toBeNull();
    expect(snapshot.phase).toBe("idle");
    expect(calls).toEqual([]);
  });
});
