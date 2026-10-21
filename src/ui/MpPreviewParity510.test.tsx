import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openMpMenu } from "./mpNavigation.test-helpers";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * MP notification preview and nation search (#510). The reference status
 * bar opens a bell preview with the latest notifications, and the
 * singleplayer world directory filters its nation rows. Multiplayer now
 * does both.
 */
const USER = "507f1f77bcf86cd799439011";
const NOTE = "607f1f77bcf86cd799439011";

const probe = JSON.stringify({ active: true, sub: USER, username: "Ada" });
const me = JSON.stringify({
  character: { _id: "c1", name: "Ada", party: "Labor", homeState: "CA", cashOnHand: 1000, actions: 3, countryId: "US" },
  corporation: null,
});
const turn = JSON.stringify({ currentTurn: 12, currentYear: 1953, startingYear: 1953, isActive: true, isProcessing: false, nextScheduledTurn: null });
const inbox = JSON.stringify({
  notifications: [
    { _id: NOTE, title: "Turn processed", message: "Your action resolved.", read: false },
    { _id: "607f1f77bcf86cd799439012", title: "Election", message: "A race opened.", read: true },
  ],
  unreadCount: 1,
  total: 2,
  hasMore: false,
});
const emptyMailInbox = JSON.stringify({ mails: [], unreadCount: 0, total: 0, hasMore: false });
const emptyMailSent = JSON.stringify({ mails: [], total: 0, hasMore: false });
const caps = JSON.stringify({ user: null, hasCharacter: false });
const status = JSON.stringify({ name: "Ada", actions: 3, funds: 900, cashOnHand: 1000, homeCurrency: "USD" });
const countries = JSON.stringify({
  countries: [
    { id: "US", name: "United States", status: "active", flagEmoji: "🇺🇸", regionLabel: "State" },
    { id: "UK", name: "United Kingdom", status: "active", flagEmoji: "🇬🇧", regionLabel: "Region" },
  ],
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

describe("MpModeScreen notification preview", () => {
  it("previews the latest notifications and links into the inbox", async () => {
    const { host } = fakeHost(mountScript());
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const footer = within(screen.getByRole("contentinfo", { name: "Multiplayer navigation" }));
    await userEvent.click(footer.getByRole("button", { name: "Notifications: 1 unread" }));

    const preview = screen.getByRole("dialog", { name: "Notification preview" });
    expect(within(preview).getByText("Turn processed")).toBeInTheDocument();
    expect(within(preview).getByText("1 unread")).toBeInTheDocument();

    await userEvent.click(within(preview).getByRole("button", { name: "Open Notifications" }));
    expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Notification preview" })).toBeNull();
  });
});

describe("MpModeScreen nation search", () => {
  it("filters the nation directory like the singleplayer world directory", async () => {
    const { host } = fakeHost(mountScript({ countries: [countries] }));
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const drawer = await openMpMenu();
    await userEvent.click(within(drawer).getByRole("button", { name: "Nations" }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const list = screen.getByRole("list", { name: "Registered nations" });
    expect(within(list).getByRole("button", { name: /United States/ })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /United Kingdom/ })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Search nations in the world directory"), "kingdom");
    expect(within(list).queryByRole("button", { name: /United States/ })).toBeNull();
    expect(within(list).getByRole("button", { name: /United Kingdom/ })).toBeInTheDocument();
  });
});
