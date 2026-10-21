import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openMpMenu } from "./mpNavigation.test-helpers";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * MP Elections destination (#510). Singleplayer has an Elections surface;
 * multiplayer only offered the Standing drill-in for one active race. The
 * nation's races now come from the public election list read, and a row
 * opens the same race detail the Standing drill-in uses.
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
const status = JSON.stringify({ name: "Ada", actions: 3, funds: 900, cashOnHand: 1000, homeCurrency: "USD" });

function race(overrides: Record<string, unknown> = {}) {
  return {
    id: "68a000000000000000000001",
    seatId: "US-senate-CA-1",
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
    polling: { leaderName: "Ada", leaderParty: "Labor" },
    incumbent: { name: "Grace", party: "Labor" },
    ...overrides,
  };
}

const electionList = JSON.stringify({ elections: [race()], total: 1, page: 1 });
const electionDetail = JSON.stringify({ election: race() });

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

describe("MpModeScreen Elections destination", () => {
  it("lists the nation's races and opens the race detail", async () => {
    const { host, calls } = fakeHost(
      mountScript({ "election-list": [electionList], "election-detail": [electionDetail] }),
    );
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const drawer = await openMpMenu();
    await userEvent.click(within(drawer).getByRole("button", { name: "Elections" }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const list = screen.getByRole("list", { name: "National elections" });
    expect(within(list).getByRole("button", { name: /senate/ })).toBeInTheDocument();
    expect(calls).toContain("fetch:election-list");

    await userEvent.click(within(list).getByRole("button", { name: /senate/ }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const detail = screen.getByRole("article", { name: "Election detail" });
    expect(within(detail).getByText(/Ada/)).toBeInTheDocument();
    expect(within(detail).getByText(/Grace/)).toBeInTheDocument();
    expect(calls).toContain("fetch:election-detail");
  });

  it("says so honestly when the nation has no open races", async () => {
    const { host } = fakeHost(mountScript({ "election-list": [JSON.stringify({ elections: [], total: 0, page: 1 })] }));
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const drawer = await openMpMenu();
    await userEvent.click(within(drawer).getByRole("button", { name: "Elections" }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const section = screen.getByRole("region", { name: "Elections" });
    expect(within(section).getByText(/No open races in this nation right now/)).toBeInTheDocument();
  });

  it("keeps the session ready when the election list read fails", async () => {
    const { host } = fakeHost(mountScript({ "election-list": [{ reject: "remote-error:500:Server error" }] }));
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const drawer = await openMpMenu();
    await userEvent.click(within(drawer).getByRole("button", { name: "Elections" }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const section = screen.getByRole("region", { name: "Elections" });
    expect(within(section).getByText(/No open races in this nation right now/)).toBeInTheDocument();
    expect(screen.getByText("Playing as Ada")).toBeInTheDocument();
  });
});
