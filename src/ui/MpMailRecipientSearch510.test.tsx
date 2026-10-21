import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openMpDestination } from "./mpNavigation.test-helpers";
import { MpModeScreen } from "./MpModeScreen";
import type { MpBridgeHost } from "../mp/bridge";

/**
 * Mail recipient discovery (#510). The reference lets a player find a
 * recipient by name; multiplayer only accepted a pasted 24-character
 * character id, which no player can obtain. The name search comes from the
 * public character search read, and picking a match fills the recipient.
 */
const USER = "507f1f77bcf86cd799439011";
const CHAR_B = "507f1f77bcf86cd799439012";

const probe = JSON.stringify({ active: true, sub: USER, username: "Ada" });
const me = JSON.stringify({ character: { _id: "c1", name: "Ada" }, corporation: null });
const turn = JSON.stringify({ currentTurn: 12, currentYear: 1862 });
const caps = JSON.stringify({
  user: { id: USER, username: "Ada", isAdmin: false, isModerator: false },
  hasCharacter: true,
  characterName: "Ada",
  characterCountryId: "US",
  unreadMailCount: 0,
});
const notes = JSON.stringify({ notifications: [], unreadCount: 0, total: 0, hasMore: false });
const emptyInbox = JSON.stringify({ mails: [], unreadCount: 0, total: 0, hasMore: false });
const emptySent = JSON.stringify({ mails: [], total: 0, hasMore: false });
const searchResults = JSON.stringify({
  results: [
    {
      id: CHAR_B,
      userId: "507f1f77bcf86cd799439099",
      name: "Bo",
      username: "bo",
      discordUsername: null,
      party: "12",
      homeState: "CA",
      avatarUrl: null,
      currentOffice: "Senator",
    },
  ],
});

afterEach(() => {
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
        throw new Error(`unexpected call fetch:${op}`);
      },
      mutate: async () => {
        throw new Error("unexpected mutate");
      },
      beginSignIn: async () => {},
    },
  };
}

function mailScript(extra: Record<string, Array<string | { reject: string }>> = {}) {
  return {
    fetch: {
      "auth-session": [probe],
      "character-me": [me],
      "turn-status": [turn],
      "client-nav": [caps],
      notifications: [notes],
      "mail-inbox": [emptyInbox],
      "mail-sent": [emptySent],
      ...extra,
    },
  };
}

describe("MpModeScreen mail recipient search", () => {
  it("finds a recipient by name and fills the recipient field", async () => {
    const user = userEvent.setup();
    const { host, calls } = fakeHost(mailScript({ "character-search": [searchResults] }));
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await screen.findByRole("heading", { name: "Ada" });
    await openMpDestination("Mail");
    const mail = await screen.findByRole("region", { name: "Player mail" });

    await user.click(within(mail).getByRole("button", { name: "Send mail" }));
    await user.type(within(mail).getByLabelText(/Find a player/), "Bo");
    await user.click(within(mail).getByRole("button", { name: "Search" }));

    const matches = await within(mail).findByRole("list", { name: "Player matches" });
    expect(within(matches).getByRole("button", { name: /Bo/ })).toBeInTheDocument();
    expect(calls).toContain("fetch:character-search");

    await user.click(within(matches).getByRole("button", { name: /Bo/ }));
    expect(within(mail).getByDisplayValue(CHAR_B)).toBeInTheDocument();
    expect(within(mail).getByText("To: Bo")).toBeInTheDocument();
  });

  it("keeps the draft and the session when the search fails", async () => {
    const user = userEvent.setup();
    const { host } = fakeHost(
      mailScript({ "character-search": [{ reject: "remote-error:500:Server error" }] }),
    );
    render(<MpModeScreen host={host} onExit={() => {}} />);
    await screen.findByRole("heading", { name: "Ada" });
    await openMpDestination("Mail");
    const mail = await screen.findByRole("region", { name: "Player mail" });

    await user.click(within(mail).getByRole("button", { name: "Send mail" }));
    await user.type(within(mail).getByLabelText(/Find a player/), "Bo");
    await user.click(within(mail).getByRole("button", { name: "Search" }));

    expect(within(mail).getByDisplayValue("Bo")).toBeInTheDocument();
    expect(within(mail).queryByRole("list", { name: "Player matches" })).toBeNull();
    expect(screen.getByText("Playing as Ada")).toBeInTheDocument();
  });
});
