import { describe, expect, it, vi } from "vitest";
import { MpModeSession } from "./adapter";
import type { MpBridgeHost } from "./bridge";

/**
 * Bridge argument positions (#510).
 *
 * The multiplayer bridge is a positional call: the op, two pagination
 * slots, then one slot per detail reference. A read that puts its country
 * code in the wrong slot still type-checks and still passes the adapter
 * tests, because those tests use a fake host - and then fails on a device
 * with "unsupported" or "bad argument". These tests pin the position of
 * every slot the new reads use.
 */
const USER = "507f1f77bcf86cd799439011";
const probe = JSON.stringify({ active: true, sub: USER, username: "Ada" });
const me = JSON.stringify({ character: { _id: "c1", name: "Ada" }, corporation: null });
const turn = JSON.stringify({ currentTurn: 12, currentYear: 1953 });
const caps = JSON.stringify({ user: null, hasCharacter: false });
const inbox = JSON.stringify({ notifications: [], unreadCount: 0, total: 0, hasMore: false });

/** The bridge signature, in order. */
const SLOTS = [
  "op",
  "limit",
  "offset",
  "electionId",
  "corporationId",
  "unionId",
  "cabinetCountryCode",
  "cabinetPositionId",
  "governorCountryCode",
  "governorStateId",
  "countryCode",
  "searchQuery",
] as const;

function recordingHost(bodies: Record<string, string>) {
  const calls: { op: string; args: unknown[] }[] = [];
  const base: Record<string, string> = {
    "auth-session": probe,
    "character-me": me,
    "turn-status": turn,
    "client-nav": caps,
    notifications: inbox,
  };
  const host: MpBridgeHost = {
    fetch: async (op: string, ...args: unknown[]) => {
      calls.push({ op, args });
      return bodies[op] ?? base[op] ?? "{}";
    },
    mutate: async () => {
      throw new Error("unexpected mutate");
    },
    beginSignIn: async () => {},
  };
  return { host, calls };
}

function slotOf(call: { op: string; args: unknown[] }, slot: string): unknown {
  const index = SLOTS.indexOf(slot as (typeof SLOTS)[number]);
  if (index < 0) throw new Error("unknown slot " + slot);
  return index === 0 ? call.op : call.args[index - 1];
}

describe("MP bridge argument positions", () => {
  it("puts the country code in the country slot for every country-scoped read", async () => {
    const { host, calls } = recordingHost({
      "country-overview": JSON.stringify({ parties: 1 }),
      "country-states": JSON.stringify({ states: [] }),
      "country-parties": JSON.stringify({ parties: [] }),
      "country-politicians": JSON.stringify({ politicians: [] }),
      "country-leaders": JSON.stringify({ primeMinister: null, oppositionLeader: null, speaker: null }),
      "election-list": JSON.stringify({ elections: [], total: 0, page: 1 }),
    });
    const session = new MpModeSession(host);
    await session.enter();

    await session.loadNationOverview("US");
    await session.loadCountryRegions("US");
    await session.loadCountryParties("US");
    await session.loadCountryPoliticians("US");
    await session.loadCountryLeaders("US");
    await session.loadElectionList("US");

    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const call of calls) {
      if (![
        "country-overview",
        "country-states",
        "country-parties",
        "country-politicians",
        "country-leaders",
        "election-list",
      ].includes(call.op)) continue;
      expect(slotOf(call, "countryCode")).toBe("US");
      // No other slot may carry a value: a stray slot is refused by the
      // bridge before the request is sent.
      for (const slot of SLOTS.slice(1)) {
        if (slot === "countryCode") continue;
        expect(slotOf(call, slot)).toBeUndefined();
      }
    }
  });

  it("puts the search fragment in the search slot", async () => {
    const { host, calls } = recordingHost({
      "character-search": JSON.stringify({ results: [] }),
    });
    const session = new MpModeSession(host);
    await session.enter();
    await session.searchCharacters("Bo");

    const call = calls.find((entry) => entry.op === "character-search");
    expect(call).toBeDefined();
    expect(slotOf(call!, "searchQuery")).toBe("Bo");
    for (const slot of SLOTS.slice(1)) {
      if (slot === "searchQuery") continue;
      expect(slotOf(call!, slot)).toBeUndefined();
    }
  });

  it("keeps the election detail in the election slot", async () => {
    const { host, calls } = recordingHost({
      "election-detail": JSON.stringify({ election: { id: "68a000000000000000000001" } }),
    });
    const session = new MpModeSession(host);
    await session.enter();
    await session.loadElectionDetail("68a000000000000000000001");

    const call = calls.find((entry) => entry.op === "election-detail");
    expect(call).toBeDefined();
    expect(slotOf(call!, "electionId")).toBe("68a000000000000000000001");
    for (const slot of SLOTS.slice(1)) {
      if (slot === "electionId") continue;
      expect(slotOf(call!, slot)).toBeUndefined();
    }
  });
});
