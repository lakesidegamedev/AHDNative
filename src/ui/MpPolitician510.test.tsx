import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openMpMenu } from "./mpNavigation.test-helpers";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * MP politician drill-in (#510). The reference has a politician page; the
 * multiplayer nation drill-in listed politicians without letting a player
 * open one. The profile comes from the public politician read.
 */
const USER = "507f1f77bcf86cd799439011";
const POLITICIAN = "68a000000000000000000001";

const probe = JSON.stringify({ active: true, sub: USER, username: "Ada" });
const me = JSON.stringify({
  character: { _id: "c1", name: "Ada", party: "Labor", homeState: "CA", cashOnHand: 1000, actions: 3, countryId: "US" },
  corporation: null,
});
const turn = JSON.stringify({ currentTurn: 12, currentYear: 1953, startingYear: 1953, isActive: true, isProcessing: false, nextScheduledTurn: null });
const inbox = JSON.stringify({ notifications: [], unreadCount: 0, total: 0, hasMore: false });
const emptyMailInbox = JSON.stringify({ mails: [], unreadCount: 0, total: 0, hasMore: false });
const emptyMailSent = JSON.stringify({ mails: [], total: 0, hasMore: false });
const caps = JSON.stringify({ user: null, hasCharacter: false });
const status = JSON.stringify({ name: "Ada", actions: 3, funds: 900, cashOnHand: 1000, homeCurrency: "USD" });
const countries = JSON.stringify({
  countries: [{ id: "US", name: "United States", status: "active", flagEmoji: "🇺🇸", regionLabel: "State" }],
});
const overview = JSON.stringify({ parties: 1, politicians: 1, regions: 1 });
const countryStates = JSON.stringify({ states: [{ id: "CA", name: "California" }] });
const countryParties = JSON.stringify({ parties: [] });
const countryPoliticians = JSON.stringify({
  politicians: [
    {
      id: POLITICIAN,
      name: "Bo",
      partyName: "Labour Party",
      homeStateName: "California",
      currentOffice: "Senator",
      politicalInfluence: 61,
    },
  ],
});
const countryLeaders = JSON.stringify({ primeMinister: null, oppositionLeader: null, speaker: null });
const profile = JSON.stringify({
  type: "character",
  id: POLITICIAN,
  name: "Bo",
  partyName: "Labour Party",
  homeStateName: "California",
  currentOffice: "Senator",
  politicalInfluence: 61,
  nationalInfluence: 40,
  favorability: 55,
  policies: { economic: 40, social: 60 },
  bio: "A senator.",
  isNPP: false,
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

async function settleMount() {
  await act(async () => {
    for (let i = 0; i < 200; i += 1) {
      await Promise.resolve();
    }
  });
}

describe("MpModeScreen politician drill-in", () => {
  it("opens a politician's public profile from the nation drill-in", async () => {
    const { host, calls } = fakeHost({
      fetch: {
        "auth-session": [probe],
        "character-me": [me],
        "turn-status": [turn],
        notifications: [inbox],
        "mail-inbox": [emptyMailInbox],
        "mail-sent": [emptyMailSent],
        "client-status": [status],
        countries: [countries],
        "country-overview": [overview],
        "country-states": [countryStates],
        "country-parties": [countryParties],
        "country-politicians": [countryPoliticians],
        "country-leaders": [countryLeaders],
        "politician-detail": [profile],
      },
    });
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const drawer = await openMpMenu();
    await userEvent.click(within(drawer).getByRole("button", { name: "Nations" }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const directory = screen.getByRole("list", { name: "Registered nations" });
    await userEvent.click(within(directory).getByRole("button", { name: /United States/ }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const list = screen.getByRole("list", { name: "Politicians of United States" });
    await userEvent.click(within(list).getByRole("button", { name: /Bo/ }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const card = screen.getByRole("article", { name: "Politician: Bo" });
    expect(within(card).getByText("Senator")).toBeInTheDocument();
    expect(within(card).getByText("Labour Party")).toBeInTheDocument();
    expect(within(card).getByText("61")).toBeInTheDocument();
    expect(within(card).getByText("A senator.")).toBeInTheDocument();
    expect(calls).toContain("fetch:politician-detail");

    await userEvent.click(screen.getByRole("button", { name: "Back to the nation" }));
    expect(screen.getByRole("region", { name: "Nations" })).toBeInTheDocument();
  });
});
