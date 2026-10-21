import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openMpMenu } from "./mpNavigation.test-helpers";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * MP support links (#510). The reference mobile menu keeps the guide,
 * about and community cluster in its drawer. Multiplayer had no help
 * destination at all, even though Native already allowlists exactly those
 * destinations for the offline Help panel.
 */
const openSupportDestination = vi.fn(async (_destination: string) => {});

vi.mock("../online/support", () => ({
  openSupportDestination: (destination: string) => openSupportDestination(destination),
  SUPPORT_DESTINATIONS: [
    { id: "wiki", label: "Wiki", url: "https://wiki.ahousedividedgame.com" },
    { id: "guides", label: "Game guides", url: "https://ahousedividedgame.com/guides" },
    { id: "about", label: "About A House Divided", url: "https://ahousedividedgame.com/about" },
    { id: "discord", label: "Discord community", url: "https://discord.gg/DmF8zJJuqN" },
  ],
}));

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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  openSupportDestination.mockReset();
  openSupportDestination.mockResolvedValue(undefined);
});

function fakeHost(): MpBridgeHost {
  const queues = new Map<string, string[]>([
    ["auth-session", [probe]],
    ["character-me", [me]],
    ["turn-status", [turn]],
    ["client-nav", [caps]],
    ["notifications", [inbox]],
    ["mail-inbox", [emptyMailInbox]],
    ["mail-sent", [emptyMailSent]],
    ["client-status", [status]],
  ]);
  return {
    fetch: async (op: string) => {
      const item = queues.get(op)?.shift();
      if (typeof item === "string") return item;
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

describe("MpModeScreen support links", () => {
  it("offers the reference guide, about and community links in the drawer", async () => {
    render(<MpModeScreen host={fakeHost()} onExit={() => {}} />);
    await settleMount();

    const drawer = await openMpMenu();
    const support = within(drawer).getByRole("navigation", { name: "Multiplayer support" });
    expect(within(support).getByRole("button", { name: "Game guides" })).toBeInTheDocument();
    expect(within(support).getByRole("button", { name: "Wiki" })).toBeInTheDocument();
    expect(within(support).getByRole("button", { name: "About" })).toBeInTheDocument();
    expect(within(support).getByRole("button", { name: "Discord" })).toBeInTheDocument();

    await userEvent.click(within(support).getByRole("button", { name: "Game guides" }));
    expect(openSupportDestination).toHaveBeenCalledWith("guides");
  });

  it("reports honestly when a destination refuses to open", async () => {
    openSupportDestination.mockRejectedValue(new Error("offline"));
    render(<MpModeScreen host={fakeHost()} onExit={() => {}} />);
    await settleMount();

    const drawer = await openMpMenu();
    const support = within(drawer).getByRole("navigation", { name: "Multiplayer support" });
    await userEvent.click(within(support).getByRole("button", { name: "Discord" }));
    expect(within(support).getByRole("alert")).toHaveTextContent(/could not open/);
  });
});
