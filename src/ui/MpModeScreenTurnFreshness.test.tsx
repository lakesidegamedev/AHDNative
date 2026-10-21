import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * Latest-MP-turn parity (#510 / #86). Multiplayer must reference the
 * newest authoritative turn, not the one loaded when the screen mounted,
 * and it must render that turn on the same calendar as singleplayer:
 * "Turn N · [Founding] Month, Week N, Year".
 *
 * Cadence is pinned to the reference poller in AHDGame
 * src/hooks/useGameEvents.ts: 120s relaxed, 1.5s while processing, and a
 * foreground re-poll. A newer turn also refreshes AP/inbox/nav, mirroring
 * the reference StatusBar's turn-change refetch.
 */
const USER = "507f1f77bcf86cd799439011";
const NOTE = "607f1f77bcf86cd799439011";

const probe = JSON.stringify({ active: true, sub: USER, username: "Ada" });
const me = (actions: number) =>
  JSON.stringify({
    character: { _id: "c1", name: "Ada", party: "Labor", homeState: "CA", cashOnHand: 1000, actions, countryId: "US" },
    corporation: null,
  });
const turn = (currentTurn: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    currentTurn,
    currentYear: 1862,
    startingYear: 1862,
    isActive: true,
    isProcessing: false,
    nextScheduledTurn: null,
    ...extra,
  });
const inbox = JSON.stringify({
  notifications: [{ _id: NOTE, title: "Turn processed", message: "Done", read: false }],
  unreadCount: 1,
  total: 1,
  hasMore: false,
});
const emptyMailInbox = JSON.stringify({ mails: [], unreadCount: 0, total: 0, hasMore: false });
const emptyMailSent = JSON.stringify({ mails: [], total: 0, hasMore: false });
const caps = JSON.stringify({ user: null, hasCharacter: false, funds: 2500 });
const presence = (online: number) => JSON.stringify({ online, asOf: "2026-09-17T12:00:00.000Z" });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

interface Script {
  fetch?: Record<string, Array<string | { reject: string }>>;
}

function fakeHost(script: Script): { host: MpBridgeHost; calls: string[] } {
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

function mountScript(turnBody: string): Script {
  return {
    fetch: {
      "auth-session": [probe],
      "character-me": [me(3)],
      "turn-status": [turnBody],
      notifications: [inbox],
      "mail-inbox": [emptyMailInbox],
      "mail-sent": [emptyMailSent],
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

function worldTurnCard(): HTMLElement {
  return screen.getByRole("article", { name: "World turn" });
}

function worldStatus(): HTMLElement {
  return screen.getByLabelText("World status");
}

describe("MpModeScreen latest MP turn rendering", () => {
  it("renders the same LARP calendar as singleplayer", async () => {
    await act(async () => {
      render(<MpModeScreen host={fakeHost(mountScript(turn(12))).host} onExit={() => {}} />);
    });
    await settleMount();
    expect(screen.getByRole("heading", { name: "Ada" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Turn 12 · March, Week 4, 1862" })).toBeInTheDocument();
    expect(worldStatus().textContent).toContain("Turn 12 · March, Week 4, 1862");
    expect(within(worldStatus()).getByRole("button", { name: "Profile: Ada" })).toBeInTheDocument();
    expect(worldStatus().textContent).toContain("Labor · US");
    expect(screen.getByLabelText("Campaign funds: 2,500")).toBeInTheDocument();
    expect(within(worldTurnCard()).queryByText(/1862$/)).not.toBeNull();
  });

  it("marks the founding freeze exactly like the singleplayer footer", async () => {
    await act(async () => {
      render(
        <MpModeScreen
          host={fakeHost(mountScript(turn(7, { currentYear: 1862, startingYear: 1862, preIterationActive: true }))).host}
          onExit={() => {}}
        />,
      );
    });
    await settleMount();
    expect(
      screen.getByRole("heading", { name: /Turn 7 · Founding\s+January, Week 1, 1862/ }),
    ).toBeInTheDocument();
    expect(worldStatus().textContent).toContain("Founding");
    expect(within(worldStatus()).getByTitle(/frozen at the era start/)).toBeInTheDocument();
  });
});

describe("MpModeScreen latest MP turn freshness", () => {
  it("re-polls on the reference cadence and adopts the latest turn", async () => {
    vi.useFakeTimers();
    const { host, calls } = fakeHost({
      fetch: {
        "auth-session": [probe, probe],
        "character-me": [me(3), me(4)],
        "turn-status": [turn(12), turn(13), turn(13), turn(13), turn(13)],
        "client-nav": [caps, caps],
        notifications: [inbox, inbox],
        "mail-inbox": [emptyMailInbox],
        "mail-sent": [emptyMailSent],
        "players-online": [presence(5), presence(6)],
      },
    });
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();
    expect(screen.getByRole("heading", { name: "Turn 12 · March, Week 4, 1862" })).toBeInTheDocument();
    expect(screen.getByLabelText("Action points: 3")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(screen.getByRole("heading", { name: "Turn 13 · April, Week 1, 1862" })).toBeInTheDocument();
    expect(worldStatus().textContent).toContain("Turn 13 · April, Week 1, 1862");
    // The reference StatusBar refetches character stats and nav on a new turn.
    expect(screen.getByLabelText("Action points: 4")).toBeInTheDocument();
    expect(within(worldTurnCard()).getByText("6 players online")).toBeInTheDocument();
    expect(calls.filter((call) => call === "fetch:turn-status")).toHaveLength(3);
    expect(calls.filter((call) => call === "fetch:character-me")).toHaveLength(2);
  });

  it("polls hard while the server is processing a turn", async () => {
    vi.useFakeTimers();
    const processing = turn(12, {
      isProcessing: true,
      processingPhaseLabel: "Elections",
      processingProgress: 47,
      processingTargetTurn: 13,
    });
    const processingLater = turn(12, {
      isProcessing: true,
      processingPhaseLabel: "Corporation Production",
      processingProgress: 52,
      processingTargetTurn: 13,
    });
    const { host, calls } = fakeHost({
      fetch: {
        "auth-session": [probe],
        "character-me": [me(3)],
        "turn-status": [processing, processingLater, processingLater, processingLater, processingLater],
        notifications: [inbox],
        "mail-inbox": [emptyMailInbox],
        "mail-sent": [emptyMailSent],
      },
    });
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();
    expect(within(worldTurnCard()).getByText("Processing: Elections (47%)")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(within(worldTurnCard()).getByText("Processing: Corporation Production (52%)")).toBeInTheDocument();
    expect(calls.filter((call) => call === "fetch:turn-status")).toHaveLength(2);
  });

  it("does not poll the latest turn while the app is backgrounded", async () => {
    vi.useFakeTimers();
    setVisibility("hidden");
    const { host, calls } = fakeHost(mountScript(turn(12)));
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(calls.filter((call) => call === "fetch:turn-status")).toHaveLength(1);
  });

  it("re-polls the latest turn on foreground return", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const { host, calls } = fakeHost({
      fetch: {
        "auth-session": [probe],
        "character-me": [me(3)],
        "turn-status": [turn(12), turn(12), turn(12), turn(12)],
        notifications: [inbox],
        "mail-inbox": [emptyMailInbox],
        "mail-sent": [emptyMailSent],
      },
    });
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(calls.filter((call) => call === "fetch:turn-status")).toHaveLength(2);
  });
});
