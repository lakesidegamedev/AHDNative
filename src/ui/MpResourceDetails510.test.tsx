import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * MP resource details (#510). The reference status bar opens a popover from
 * each resource chip with that resource's figures and links into the
 * matching destination. Multiplayer only navigated. The popover now shows
 * the figures the server actually reported - including the change in cash
 * since the last status read - and links to the destination that owns them.
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
      "client-status": [status()],
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

describe("MpModeScreen resource details", () => {
  it("opens the reported figures for a resource and links to its destination", async () => {
    const { host } = fakeHost(mountScript());
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const footer = within(screen.getByRole("contentinfo", { name: "Multiplayer navigation" }));
    await userEvent.click(footer.getByRole("button", { name: "Action points: 3" }));
    const actionDetails = screen.getByRole("dialog", { name: "Action points details" });
    expect(within(actionDetails).getByText(/Action points: 3/)).toBeInTheDocument();
    expect(within(actionDetails).getByText(/Per-turn cap: 5/)).toBeInTheDocument();
    expect(within(actionDetails).getByText(/Hoarding threshold: 4/)).toBeInTheDocument();

    await userEvent.click(footer.getByRole("button", { name: "Cash on hand: 5,400 USD" }));
    const cashDetails = screen.getByRole("dialog", { name: "Cash details" });
    expect(within(cashDetails).getByText(/Cash on hand: 5,400 USD/)).toBeInTheDocument();
    expect(within(cashDetails).getByText(/Liquid home cash: 5,200 USD/)).toBeInTheDocument();
    // The first status read has no baseline, so no delta is claimed.
    expect(within(cashDetails).queryByText(/Since the last read/)).toBeNull();

    await userEvent.click(within(cashDetails).getByRole("button", { name: "Go to Wallet" }));
    expect(screen.getByRole("region", { name: "Wallet" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Cash details" })).toBeNull();
  });

  it("reports the change in cash since the last status read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { host } = fakeHost(
      mountScript({ "client-status": [status(), status({ cashOnHand: 5600 })] }),
    );
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const footer = within(screen.getByRole("contentinfo", { name: "Multiplayer navigation" }));
    await user.click(footer.getByRole("button", { name: "Cash on hand: 5,600 USD" }));
    const cashDetails = screen.getByRole("dialog", { name: "Cash details" });
    expect(within(cashDetails).getByText(/Since the last read: \+200/)).toBeInTheDocument();
  });
});
