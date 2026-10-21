import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * MP identity labels (#510). The character record carries the party key (a
 * numeric id on the live server) and only the region key, so the reference
 * resolves both names from client-nav. Multiplayer used to show the raw
 * keys, which put "12" where the reference shows a party's name.
 */
const USER = "507f1f77bcf86cd799439011";

const probe = JSON.stringify({ active: true, sub: USER, username: "Ada" });
const me = JSON.stringify({
  character: { _id: "c1", name: "Ada", party: "12", homeState: "CA", cashOnHand: 1000, actions: 3, countryId: "US" },
  corporation: null,
});
const turn = JSON.stringify({ currentTurn: 12, currentYear: 1953, startingYear: 1953, isActive: true, isProcessing: false, nextScheduledTurn: null });
const inbox = JSON.stringify({ notifications: [], unreadCount: 0, total: 0, hasMore: false });
const emptyMailInbox = JSON.stringify({ mails: [], unreadCount: 0, total: 0, hasMore: false });
const emptyMailSent = JSON.stringify({ mails: [], total: 0, hasMore: false });
const status = JSON.stringify({ name: "Ada", actions: 3, funds: 900, cashOnHand: 1000, homeCurrency: "USD" });
const nav = JSON.stringify({
  user: null,
  hasCharacter: true,
  characterName: "Ada",
  characterCountryId: "US",
  unreadMailCount: 0,
  homeState: { id: "CA", name: "California", countryId: "US" },
  currentParty: { id: "12", name: "Labour Party", countryId: "US" },
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fakeHost(script: { fetch?: Record<string, Array<string | { reject: string }>> }): MpBridgeHost {
  const queues = new Map<string, Array<string | { reject: string }>>();
  for (const [op, items] of Object.entries(script.fetch ?? {})) queues.set(`fetch:${op}`, [...items]);
  return {
    fetch: async (op: string) => {
      const item = queues.get(`fetch:${op}`)?.shift();
      if (typeof item === "string") return item;
      if (item) throw new Error(item.reject);
      throw new Error(`unexpected call fetch:${op}`);
    },
    mutate: async () => {
      throw new Error("unexpected mutate");
    },
    beginSignIn: async () => {},
  };
}

async function settleMount() {
  await act(async () => {
    for (let i = 0; i < 200; i += 1) {
      await Promise.resolve();
    }
  });
}

describe("MpModeScreen identity labels", () => {
  it("shows the resolved party name and home region name, never the raw keys", async () => {
    const host = fakeHost({
      fetch: {
        "auth-session": [probe],
        "character-me": [me],
        "turn-status": [turn],
        "client-nav": [nav],
        notifications: [inbox],
        "mail-inbox": [emptyMailInbox],
        "mail-sent": [emptyMailSent],
        "client-status": [status],
      },
    });
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const footer = within(screen.getByLabelText("World status"));
    expect(footer.getByText(/Labour Party/)).toBeInTheDocument();
    expect(footer.queryByText(/^12$/)).toBeNull();

    const profile = within(screen.getByRole("article", { name: "Player" }));
    expect(profile.getByText("Labour Party")).toBeInTheDocument();
    expect(profile.getByText("California")).toBeInTheDocument();
    expect(profile.queryByText("12")).toBeNull();
  });

  it("omits the party chip for an unaffiliated character", async () => {
    const host = fakeHost({
      fetch: {
        "auth-session": [probe],
        "character-me": [JSON.stringify({
          character: { _id: "c1", name: "Ada", party: "independent", homeState: "CA", cashOnHand: 1000, actions: 3, countryId: "US" },
          corporation: null,
        })],
        "turn-status": [turn],
        "client-nav": [JSON.stringify({ user: null, hasCharacter: true, characterCountryId: "US", unreadMailCount: 0, homeState: { id: "CA", name: "California", countryId: "US" } })],
        notifications: [inbox],
        "mail-inbox": [emptyMailInbox],
        "mail-sent": [emptyMailSent],
        "client-status": [status],
      },
    });
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const footer = within(screen.getByLabelText("World status"));
    expect(footer.getByText(/Independent/)).toBeInTheDocument();
    const profile = within(screen.getByRole("article", { name: "Player" }));
    expect(profile.queryByText("Labour Party")).toBeNull();
  });
});
