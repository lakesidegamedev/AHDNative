import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * MP footer resource parity (#510). The persistent footer must show the
 * same resource set singleplayer shows: action points, campaign funds,
 * cash, political influence and favorability. The figures come from the
 * authoritative status read (GET /api/client-status, pinned to the
 * minimal layout by the Rust bridge), refreshed on the reference 60s
 * cadence, on a new turn, and on foreground return. A failed read keeps
 * the last good figures and never expires the session.
 */
const USER = "507f1f77bcf86cd799439011";

const probe = JSON.stringify({ active: true, sub: USER, username: "Ada" });
const me = (actions: number) =>
  JSON.stringify({
    character: { _id: "c1", name: "Ada", party: "Labor", homeState: "CA", cashOnHand: 1000, actions, countryId: "US" },
    corporation: null,
  });
const turn = (currentTurn: number) =>
  JSON.stringify({
    currentTurn,
    currentYear: 1953,
    startingYear: 1953,
    isActive: true,
    isProcessing: false,
    nextScheduledTurn: null,
  });
const inbox = JSON.stringify({
  notifications: [{ _id: "607f1f77bcf86cd799439011", title: "Turn processed", message: "Done", read: false }],
  unreadCount: 1,
  total: 1,
  hasMore: false,
});
const emptyMailInbox = JSON.stringify({ mails: [], unreadCount: 0, total: 0, hasMore: false });
const emptyMailSent = JSON.stringify({ mails: [], total: 0, hasMore: false });
const caps = JSON.stringify({ user: null, hasCharacter: false, funds: 900 });
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
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

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
      "character-me": [me(3)],
      "turn-status": [turn(12)],
      notifications: [inbox],
      "mail-inbox": [emptyMailInbox],
      "mail-sent": [emptyMailSent],
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

describe("MpModeScreen footer resource parity", () => {
  it("shows the singleplayer resource set from the authoritative status read", async () => {
    const { host } = fakeHost(mountScript({ "client-status": [status()] }));
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    expect(screen.getByLabelText("Action points: 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Campaign funds: 1,200 USD")).toBeInTheDocument();
    expect(screen.getByLabelText("Cash on hand: 5,400 USD")).toBeInTheDocument();
    expect(screen.getByLabelText("Influence: 61")).toBeInTheDocument();
    expect(screen.getByLabelText("Favorability: 55")).toBeInTheDocument();
    expect(screen.getByLabelText("Notifications: 1 unread")).toBeInTheDocument();
  });

  it("refreshes the figures on the reference 60s cadence", async () => {
    vi.useFakeTimers();
    const { host, calls } = fakeHost(
      mountScript({
        "client-status": [status(), status({ politicalInfluence: 70, favorability: 48, funds: 1500 })],
      }),
    );
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();
    expect(screen.getByLabelText("Influence: 61")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getByLabelText("Influence: 70")).toBeInTheDocument();
    expect(screen.getByLabelText("Favorability: 48")).toBeInTheDocument();
    expect(screen.getByLabelText("Campaign funds: 1,500 USD")).toBeInTheDocument();
    expect(calls.filter((call) => call === "fetch:client-status")).toHaveLength(2);
  });

  it("keeps the last good figures when the status read fails", async () => {
    vi.useFakeTimers();
    const { host } = fakeHost(
      mountScript({
        "client-status": [status(), { reject: "remote-error:429:60:Rate limited" }],
      }),
    );
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByLabelText("Influence: 61")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ada" })).toBeInTheDocument();
  });

  it("does not poll the status read while the app is backgrounded", async () => {
    vi.useFakeTimers();
    setVisibility("hidden");
    const { host, calls } = fakeHost(mountScript({ "client-status": [status()] }));
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(calls.filter((call) => call === "fetch:client-status")).toHaveLength(1);
  });
});
