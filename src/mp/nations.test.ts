import { describe, expect, it, vi } from "vitest";
import { MpModeSession } from "./adapter";
import type { MpBridgeHost } from "./bridge";

/**
 * MP world reads (#510): the public nation directory and one nation's
 * headline figures. Both are loaded on demand, outside enter/refresh, and
 * every failure keeps the last good view without touching the session.
 */
const USER = "507f1f77bcf86cd799439011";
const probe = JSON.stringify({ active: true, sub: USER, username: "Ada" });
const me = JSON.stringify({
  character: { _id: "c1", name: "Ada", party: "Labor", homeState: "CA", cashOnHand: 1000, actions: 3, countryId: "US" },
  corporation: null,
});
const turn = JSON.stringify({ currentTurn: 12, currentYear: 1953, startingYear: 1953, isActive: true, isProcessing: false, nextScheduledTurn: null });
const caps = JSON.stringify({ user: null, hasCharacter: false });
const inbox = JSON.stringify({ notifications: [], unreadCount: 0, total: 0, hasMore: false });
const countries = JSON.stringify({
  countries: [
    { id: "US", name: "United States", flagEmoji: "🇺🇸", status: "active", governmentTypeLabel: "Federal presidential republic", regionLabel: "State" },
    { id: "UK", name: "United Kingdom", flagEmoji: "🇬🇧", status: "active", governmentTypeLabel: "Parliamentary republic", regionLabel: "Region" },
  ],
});
const overview = JSON.stringify({
  parties: 42,
  politicians: 120,
  activeElections: 1,
  upcomingElections: 2,
  bills: 87,
  regions: 50,
  primeRate: 4.5,
  gdpMillions: 25000000,
  budgetBalancePctGdp: -1.25,
  unions: 12,
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

describe("MpModeSession loadNations", () => {
  it("projects the runtime nation directory without touching the session", async () => {
    const { host, calls } = scriptedHost(enterScripts({ countries: [countries] }));
    const session = new MpModeSession(host);
    await session.enter();
    const snapshot = await session.loadNations();
    expect(snapshot.nations?.map((nation) => nation.id)).toEqual(["US", "UK"]);
    expect(snapshot.nations?.[0]).toMatchObject({
      name: "United States",
      flagEmoji: "🇺🇸",
      governmentTypeLabel: "Federal presidential republic",
      regionLabel: "State",
    });
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.error).toBeNull();
    expect(calls.filter((call) => call === "fetch:countries")).toHaveLength(1);
  });

  it("keeps the last good directory when the read fails", async () => {
    const { host } = scriptedHost(
      enterScripts({ countries: [countries, { reject: "remote-error:500:Server error" }] }),
    );
    const session = new MpModeSession(host);
    await session.enter();
    await session.loadNations();
    const snapshot = await session.loadNations();
    expect(snapshot.nations?.length).toBe(2);
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.error).toBeNull();
  });
});

describe("MpModeSession loadNationOverview", () => {
  it("projects the nation figures and keeps the session intact", async () => {
    const { host, calls } = scriptedHost(enterScripts({ "country-overview": [overview] }));
    const session = new MpModeSession(host);
    await session.enter();
    const snapshot = await session.loadNationOverview("US");
    expect(snapshot.nationOverview).toMatchObject({
      parties: 42,
      politicians: 120,
      bills: 87,
      regions: 50,
      primeRate: 4.5,
      gdpMillions: 25000000,
      budgetBalancePctGdp: -1.25,
      unions: 12,
    });
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.error).toBeNull();
    expect(calls.filter((call) => call === "fetch:country-overview")).toHaveLength(1);
  });

  it("never sends an invalid country code", async () => {
    const { host, calls } = scriptedHost(enterScripts({ "country-overview": [overview] }));
    const session = new MpModeSession(host);
    await session.enter();
    for (const bad of ["", "usa", "U1", "U S", "../../etc/passwd"]) {
      const snapshot = await session.loadNationOverview(bad);
      expect(snapshot.nationOverview).toBeNull();
    }
    expect(calls.filter((call) => call === "fetch:country-overview")).toHaveLength(0);
  });

  it("keeps the last good figures when the country read fails", async () => {
    const { host } = scriptedHost(
      enterScripts({
        "country-overview": [overview, { reject: "remote-error:400:Invalid country code" }],
      }),
    );
    const session = new MpModeSession(host);
    await session.enter();
    await session.loadNationOverview("US");
    const snapshot = await session.loadNationOverview("US");
    expect(snapshot.nationOverview?.parties).toBe(42);
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.error).toBeNull();
  });
});

describe("MpModeSession loadCountryRegions", () => {
  it("projects the nation regions", async () => {
    const { host, calls } = scriptedHost(
      enterScripts({ "country-states": [JSON.stringify({ states: [{ id: "CA", name: "California" }] })] }),
    );
    const session = new MpModeSession(host);
    await session.enter();
    const snapshot = await session.loadCountryRegions("US");
    expect(snapshot.nationRegions).toEqual([{ id: "CA", name: "California" }]);
    expect(snapshot.phase).toBe("ready");
    expect(calls.filter((call) => call === "fetch:country-states")).toHaveLength(1);
  });

  it("never sends an invalid country code and keeps the session intact", async () => {
    const { host, calls } = scriptedHost(enterScripts({}));
    const session = new MpModeSession(host);
    await session.enter();
    const snapshot = await session.loadCountryRegions("usa");
    expect(snapshot.nationRegions).toBeNull();
    expect(snapshot.phase).toBe("ready");
    expect(calls.filter((call) => call === "fetch:country-states")).toHaveLength(0);
  });
});

describe("MpModeSession loadElectionList", () => {
  const electionList = JSON.stringify({
    elections: [
      {
        id: "68a000000000000000000001",
        electionType: "senate",
        state: "CA",
        countryId: "US",
        cycle: 3,
        status: "active",
        inPrimary: false,
        isEnded: false,
        isUpcoming: false,
        inGeneral: true,
        candidates: [{ id: "c1" }],
      },
    ],
    total: 1,
    page: 1,
  });

  it("projects the nation's races", async () => {
    const { host, calls } = scriptedHost(enterScripts({ "election-list": [electionList] }));
    const session = new MpModeSession(host);
    await session.enter();
    const snapshot = await session.loadElectionList("US");
    expect(snapshot.electionList?.[0]).toMatchObject({
      id: "68a000000000000000000001",
      electionType: "senate",
      status: "active",
      candidateCount: 1,
    });
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.error).toBeNull();
    expect(calls.filter((call) => call === "fetch:election-list")).toHaveLength(1);
  });

  it("never sends an invalid country code and keeps the last good list", async () => {
    const { host, calls } = scriptedHost(
      enterScripts({ "election-list": [electionList, { reject: "remote-error:500:Server error" }] }),
    );
    const session = new MpModeSession(host);
    await session.enter();
    const rejected = await session.loadElectionList("usa");
    expect(rejected.electionList).toBeNull();
    expect(calls.filter((call) => call === "fetch:election-list")).toHaveLength(0);

    await session.loadElectionList("US");
    const failed = await session.loadElectionList("US");
    expect(failed.electionList?.[0]?.electionType).toBe("senate");
    expect(failed.phase).toBe("ready");
    expect(failed.error).toBeNull();
  });
});

describe("MpModeSession loadCountryParties and loadCountryPoliticians", () => {
  const parties = JSON.stringify({
    parties: [
      {
        id: "12",
        objectId: "68a000000000000000000001",
        name: "Labour Party",
        abbreviation: "LP",
        chair: { id: "c1", name: "Ada" },
        memberCount: 42,
        playerCount: 30,
        nppCount: 12,
      },
    ],
  });
  const politicians = JSON.stringify({
    politicians: [
      {
        id: "p1",
        name: "Ada",
        partyName: "Labour Party",
        currentOffice: "Senator",
        politicalInfluence: 61,
        favorability: 55,
      },
    ],
    total: 1,
    playerCount: 1,
    nppCount: 0,
  });

  it("projects the nation parties and politicians", async () => {
    const { host, calls } = scriptedHost(
      enterScripts({ "country-parties": [parties], "country-politicians": [politicians] }),
    );
    const session = new MpModeSession(host);
    await session.enter();
    const withParties = await session.loadCountryParties("US");
    expect(withParties.nationParties?.[0]).toMatchObject({
      name: "Labour Party",
      memberCount: 42,
      chairName: "Ada",
    });
    const withPoliticians = await session.loadCountryPoliticians("US");
    expect(withPoliticians.nationPoliticians?.[0]).toMatchObject({
      name: "Ada",
      currentOffice: "Senator",
      politicalInfluence: 61,
    });
    expect(withPoliticians.phase).toBe("ready");
    expect(withPoliticians.error).toBeNull();
    expect(calls.filter((call) => call === "fetch:country-parties")).toHaveLength(1);
    expect(calls.filter((call) => call === "fetch:country-politicians")).toHaveLength(1);
  });

  it("never sends an invalid country code and keeps the last good list", async () => {
    const { host, calls } = scriptedHost(
      enterScripts({ "country-parties": [parties, { reject: "remote-error:500:Server error" }] }),
    );
    const session = new MpModeSession(host);
    await session.enter();
    const rejected = await session.loadCountryParties("usa");
    expect(rejected.nationParties).toBeNull();
    expect(calls.filter((call) => call === "fetch:country-parties")).toHaveLength(0);

    await session.loadCountryParties("US");
    const failed = await session.loadCountryParties("US");
    expect(failed.nationParties?.[0]?.name).toBe("Labour Party");
    expect(failed.phase).toBe("ready");
    expect(failed.error).toBeNull();
  });
});
