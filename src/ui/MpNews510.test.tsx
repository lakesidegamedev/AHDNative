import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openMpMenu } from "./mpNavigation.test-helpers";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * MP News destination (#510). The reference news page is a destination of
 * its own; multiplayer had no world feed at all. The feed comes from the
 * public news read and is read-only: the audited read carries no posting or
 * reaction action, so none is offered.
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
const feed = JSON.stringify({
  posts: [
    {
      _id: "68a000000000000000000009",
      title: "Markets rally",
      content: "Stocks closed higher across the board.",
      authorName: "Ada",
      imageUrl: null,
      isSystem: false,
      feedType: "article",
      replyCount: 3,
      createdAt: "2026-10-20T12:00:00.000Z",
    },
    {
      _id: "68a00000000000000000000a",
      title: null,
      content: "A system report about the world.",
      authorName: null,
      imageUrl: null,
      isSystem: true,
      feedType: "article",
      replyCount: 0,
      createdAt: "2026-10-20T11:00:00.000Z",
    },
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

describe("MpModeScreen News destination", () => {
  it("lists the world news feed", async () => {
    const { host, calls } = fakeHost(mountScript({ "news-feed": [feed] }));
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const drawer = await openMpMenu();
    await userEvent.click(within(drawer).getByRole("button", { name: "News" }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const list = screen.getByRole("list", { name: "World news" });
    expect(within(list).getByText("Markets rally")).toBeInTheDocument();
    expect(within(list).getByText(/Stocks closed higher/)).toBeInTheDocument();
    // A system post without a title still reads as a world report.
    expect(within(list).getByText("World report")).toBeInTheDocument();
    expect(calls).toContain("fetch:news-feed");
  });

  it("reports an honest empty state when the feed read fails", async () => {
    const { host } = fakeHost(mountScript({ "news-feed": [{ reject: "remote-error:500:Server error" }] }));
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await settleMount();

    const drawer = await openMpMenu();
    await userEvent.click(within(drawer).getByRole("button", { name: "News" }));
    await act(async () => {
      for (let i = 0; i < 200; i += 1) {
        await Promise.resolve();
      }
    });

    const section = screen.getByRole("region", { name: "News" });
    expect(within(section).getByText(/did not answer with a news feed/)).toBeInTheDocument();
    expect(screen.getByText("Playing as Ada")).toBeInTheDocument();
  });
});
