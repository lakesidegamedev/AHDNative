import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openMpMenu } from "./mpNavigation.test-helpers";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * MP IMF destination (#510). The reference has an IMF page; multiplayer had
 * none. The overview comes from the signed-in imf overview read and is
 * read-only: the audited read carries no board vote or override action, so
 * none is offered.
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
const caps = JSON.stringify({ user: null, hasCharacter: false });
const status = JSON.stringify({ name: "Ada", actions: 3, funds: 900, cashOnHand: 1000, homeCurrency: "USD" });
const overview = JSON.stringify({
  currentTurn: 12,
  imfCorp: { id: "68a0000000000000000000a1", sequentialId: 1, liquidCapital: 2500000000, liquidCurrencyCode: "USD" },
  boardMembers: [{ characterId: "68a0000000000000000000b1", name: "Grace Hopper", sequentialId: 7 }],
  totalReceivedAnchor: 1200000000,
  activeSovereignBailouts: [
    { countryCode: "GB", principalOutstanding: 800000000, annualRate: 4.5, amortizationTurnsRemaining: 40, incomeCaptureFraction: 0.1, cumulativePaidAnchor: 0, crisisChoice: null, recoveryStartedAt: null },
  ],
  pendingBoardOverrides: [{ countryCode: "GB", windowEndAtRealtimeMs: 0, windowEndAtTurn: 20, crisisChoice: null, facilityTerms: { principal: 1, annualRate: 1, incomeCaptureFraction: 0 } }],
});
const noImf = JSON.stringify({ imfCorp: null, boardMembers: [], totalReceivedAnchor: 0, activeSovereignBailouts: [], pendingBoardOverrides: [] });

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

describe("MpModeScreen IMF destination", () => {
  async function openImf(host: MpBridgeHost) {
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();
    const drawer = await openMpMenu();
    await userEvent.click(within(drawer).getByRole("button", { name: "IMF" }));
    await settleMount();
  }

  it("shows the facility, board and active bailouts", async () => {
    const { host, calls } = fakeHost(mountScript({ "imf-overview": [overview] }));
    await openImf(host);

    expect(screen.getByText("USD 2.5B")).toBeInTheDocument();
    expect(screen.getByText("USD 1.2B")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "IMF board" })).getByText("Grace Hopper")).toBeInTheDocument();
    const bailouts = screen.getByRole("list", { name: "Active IMF bailouts" });
    expect(within(bailouts).getByText("GB")).toBeInTheDocument();
    expect(within(bailouts).getByText(/4\.5% a year, 40 turns left/)).toBeInTheDocument();
    expect(calls).toContain("fetch:imf-overview");
  });

  it("says so when the world has no IMF", async () => {
    const { host } = fakeHost(mountScript({ "imf-overview": [noImf] }));
    await openImf(host);
    expect(screen.getByText("This world has no IMF.")).toBeInTheDocument();
  });

  it("reports an honest empty state when the read fails", async () => {
    const { host } = fakeHost(mountScript({ "imf-overview": [{ reject: "remote-error:500:Server error" }] }));
    await openImf(host);
    expect(screen.getByText("The server did not answer with an IMF overview.")).toBeInTheDocument();
  });
});
