import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * MP campaign income breakdown (#510). The reference status bar shows the
 * per-turn campaign income lines in the funds details. The minimal status
 * layout does not carry them, so Native reads the wide layout on demand
 * when the funds details are opened - and never polls it.
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
const status = JSON.stringify({ name: "Ada", actions: 3, funds: 1200, cashOnHand: 1000, homeCurrency: "USD" });
const fullStatus = JSON.stringify({
  name: "Ada",
  actions: 3,
  actionCap: 5,
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

describe("MpModeScreen campaign income breakdown", () => {
  it("reads the wide status on demand when the funds details open", async () => {
    const { host, calls } = fakeHost({
      fetch: {
        "auth-session": [probe],
        "character-me": [me],
        "turn-status": [turn],
        notifications: [inbox],
        "mail-inbox": [emptyMailInbox],
        "mail-sent": [emptyMailSent],
        "client-status": [status],
        "client-status-full": [fullStatus],
      },
    });
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const footer = within(screen.getByRole("contentinfo", { name: "Multiplayer navigation" }));
    await userEvent.click(footer.getByRole("button", { name: "Campaign funds: 1,200 USD" }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const details = screen.getByRole("dialog", { name: "Campaign funds details" });
    const lines = within(details).getByRole("list", { name: "Campaign income per turn" });
    expect(within(lines).getByText(/Base generation: 500 USD/)).toBeInTheDocument();
    expect(within(lines).getByText(/Donor bonus: 120 USD/)).toBeInTheDocument();
    expect(within(lines).getByText(/Net per turn: 590 USD/)).toBeInTheDocument();
    expect(calls).toContain("fetch:client-status-full");
  });

  it("keeps the details honest when the wide read fails", async () => {
    const { host } = fakeHost({
      fetch: {
        "auth-session": [probe],
        "character-me": [me],
        "turn-status": [turn],
        notifications: [inbox],
        "mail-inbox": [emptyMailInbox],
        "mail-sent": [emptyMailSent],
        "client-status": [status],
        "client-status-full": [{ reject: "remote-error:500:Server error" }],
      },
    });
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const footer = within(screen.getByRole("contentinfo", { name: "Multiplayer navigation" }));
    await userEvent.click(footer.getByRole("button", { name: "Campaign funds: 1,200 USD" }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const details = screen.getByRole("dialog", { name: "Campaign funds details" });
    expect(within(details).getByText(/Campaign funds: 1,200 USD/)).toBeInTheDocument();
    expect(within(details).queryByRole("list", { name: "Campaign income per turn" })).toBeNull();
    expect(screen.getByText("Playing as Ada")).toBeInTheDocument();
  });
});
