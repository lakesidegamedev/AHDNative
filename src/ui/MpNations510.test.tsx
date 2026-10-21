import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openMpMenu } from "./mpNavigation.test-helpers";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * MP world destinations (#510). Singleplayer can browse the world's
 * nations; multiplayer had no world destination at all. The Nations
 * directory comes from the public /api/countries read (the same runtime
 * list the reference mobile menu's nation switcher renders) and the
 * selected nation's headline figures come from
 * /api/country/[code]/overview-counts. Every figure is the server's own:
 * a failed read keeps the last good directory and reports honestly.
 */
const USER = "507f1f77bcf86cd799439011";

const probe = JSON.stringify({ active: true, sub: USER, username: "Ada" });
const me = JSON.stringify({
  character: { _id: "c1", name: "Ada", party: "Labor", homeState: "CA", cashOnHand: 1000, actions: 3, countryId: "US" },
  corporation: null,
});
const turn = JSON.stringify({ currentTurn: 12, currentYear: 1953, startingYear: 1953, isActive: true, isProcessing: false, nextScheduledTurn: null });
const inbox = JSON.stringify({ notifications: [], unreadCount: 0, total: 0, hasMore: false });
const emptyMailInbox = JSON.stringify({ mails: [], unreadCount: 0, total: 0, hasMore: false });
const emptyMailSent = JSON.stringify({ mails: [], total: 0, hasMore: false });
const caps = JSON.stringify({ user: null, hasCharacter: false, characterCountryId: "US" });
const status = JSON.stringify({ name: "Ada", actions: 3, funds: 900, cashOnHand: 1000, homeCurrency: "USD", politicalInfluence: 10, favorability: 50 });
const countries = JSON.stringify({
  countries: [
    {
      id: "US",
      name: "United States",
      status: "active",
      enabledForPlayers: true,
      flagEmoji: "🇺🇸",
      regionLabel: "State",
      regionLabelPlural: "States",
      executiveTitle: "President",
      governmentType: "presidential_republic",
      governmentTypeLabel: "Federal presidential republic",
      exchangeName: "New York Stock Exchange",
      legislature: { name: "Congress", path: "/country/us/legislature", lowerName: "House", upperName: "Senate" },
      centralBank: { name: "Federal Reserve", abbreviation: "FED" },
    },
    {
      id: "UK",
      name: "United Kingdom",
      status: "active",
      enabledForPlayers: true,
      flagEmoji: "🇬🇧",
      regionLabel: "Region",
      regionLabelPlural: "Regions",
      executiveTitle: "Prime Minister",
      governmentType: "parliamentary_republic",
      governmentTypeLabel: "Parliamentary republic",
      exchangeName: "London Stock Exchange",
      legislature: { name: "Parliament", path: "/country/uk/legislature", lowerName: "House of Commons", upperName: "House of Lords" },
      centralBank: { name: "Bank of England", abbreviation: "BOE" },
    },
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
  activeReferendums: 0,
  totalReferendums: 3,
  commandEconomy: false,
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fakeHost(script: { fetch?: Record<string, Array<string | { reject: string }>> }): {
  host: MpBridgeHost;
  calls: string[];
} {
  const calls: string[] = [];
  const queues = new Map<string, Array<string | { reject: string }>>();
  for (const [op, items] of Object.entries(script.fetch ?? {})) queues.set(`fetch:${op}`, [...items]);
  return {
    calls,
    host: {
      fetch: async (op: string) => {
        calls.push(`fetch:${op}`);
        const item = queues.get(`fetch:${op}`)?.shift();
        if (typeof item === "string") return item;
        if (item) throw new Error(item.reject);
        if (op === "client-nav") return caps;
        throw new Error(`unexpected call fetch:${op}`);
      },
      mutate: async () => {
        throw new Error("unexpected mutate");
      },
      beginSignIn: async () => {},
    },
  };
}

function mountScript(extra?: Record<string, Array<string | { reject: string }>>) {
  return {
    fetch: {
      "auth-session": [probe],
      "character-me": [me],
      "turn-status": [turn],
      notifications: [inbox],
      "mail-inbox": [emptyMailInbox],
      "mail-sent": [emptyMailSent],
      "client-status": [status],
      ...extra,
    },
  };
}

async function settleMount() {
  await act(async () => {
    for (let i = 0; i < 200; i += 1) {
      await Promise.resolve();
    }
  });
}

describe("MpModeScreen Nations destination", () => {
  it("lists the runtime nations and opens one with the server's own figures", async () => {
    const { host, calls } = fakeHost(
      mountScript({
        countries: [countries],
        "country-overview": [overview],
        "country-states": [JSON.stringify({ states: [{ id: "CA", name: "California" }, { id: "NY", name: "New York" }] })],
      }),
    );
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const drawer = await openMpMenu();
    await userEvent.click(within(drawer).getByRole("button", { name: "Nations" }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const list = screen.getByRole("region", { name: "Nations" });
    expect(within(list).getByRole("button", { name: /United States/ })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /United Kingdom/ })).toBeInTheDocument();
    // The player's own nation is marked, the way the reference marks home.
    expect(within(list).getByRole("button", { name: /United States · Home/ })).toBeInTheDocument();
    expect(calls).toContain("fetch:countries");

    await userEvent.click(within(list).getByRole("button", { name: /United States/ }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const card = screen.getByRole("article", { name: "Nation: United States" });
    expect(within(card).getByText("Federal presidential republic")).toBeInTheDocument();
    expect(within(card).getByText("Congress")).toBeInTheDocument();
    expect(within(card).getByText("Federal Reserve")).toBeInTheDocument();
    expect(within(card).getByText("$25,000,000M")).toBeInTheDocument();
    expect(within(card).getByText("42")).toBeInTheDocument();
    expect(calls).toContain("fetch:country-overview");
    // The nation's regions ride the same drill-in.
    const regions = screen.getByRole("list", { name: "Regions of United States" });
    expect(within(regions).getByText("California")).toBeInTheDocument();
    expect(within(regions).getByText("New York")).toBeInTheDocument();
    expect(calls).toContain("fetch:country-states");
  });

  it("reports an honest empty state when the server answers no directory", async () => {
    const { host } = fakeHost(mountScript({ countries: [{ reject: "remote-error:500:Server error" }] }));
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const drawer = await openMpMenu();
    await userEvent.click(within(drawer).getByRole("button", { name: "Nations" }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const list = screen.getByRole("region", { name: "Nations" });
    expect(within(list).getByText(/did not answer with a nation directory/)).toBeInTheDocument();
    // The session stays ready; a failed world read never expires it.
    expect(screen.getByText("Playing as Ada")).toBeInTheDocument();
  });
});
