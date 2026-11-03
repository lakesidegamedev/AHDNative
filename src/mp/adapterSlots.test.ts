import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The multiplayer bridge is a positional call: the op, two pagination
 * slots, then one slot per detail reference. A read that puts its argument
 * in the wrong slot still type-checks and still passes the adapter tests,
 * because those tests use a fake host - and then fails on a device with
 * "unsupported" or "bad argument".
 *
 * This test reads the adapter source and pins, for every read it performs,
 * exactly which bridge slots that read may use.
 */
const SLOTS = [
  "limit",
  "offset",
  "electionId",
  "corporationId",
  "unionId",
  "cabinetCountryCode",
  "cabinetPositionId",
  "governorCountryCode",
  "governorStateId",
  "countryCode",
  "searchQuery",
  "politicianId",
] as const;

type Slot = (typeof SLOTS)[number];

/** The slots each read is allowed to use. Anything else is a mistake. */
const EXPECTED: Record<string, Slot[]> = {
  "auth-session": [],
  "character-me": [],
  "client-nav": [],
  "client-status": [],
  "client-status-full": [],
  "turn-status": [],
  "players-online": [],
  "game-time": [],
  notifications: ["limit", "offset"],
  "mail-inbox": ["limit", "offset"],
  "mail-sent": ["limit", "offset"],
  "savings-accounts": [],
  "admin-maintenance": [],
  countries: [],
  "country-overview": ["countryCode"],
  "country-states": ["countryCode"],
  "country-parties": ["countryCode"],
  "country-politicians": ["countryCode"],
  "country-leaders": ["countryCode"],
  "election-list": ["countryCode"],
  "character-search": ["searchQuery"],
  "politician-detail": ["politicianId"],
  "news-feed": ["limit", "offset"],
  "election-detail": ["electionId"],
  "corporation-detail": ["corporationId"],
  "union-detail": ["unionId"],
  "cabinet-detail": ["cabinetCountryCode", "cabinetPositionId"],
  "governor-detail": ["governorCountryCode", "governorStateId"],
};

function adapterCalls(): { op: string; used: string[] }[] {
  const source = readFileSync(new URL("./adapter.ts", import.meta.url), "utf8");
  const calls: { op: string; used: string[] }[] = [];
  let index = 0;
  while (true) {
    const start = source.indexOf("mpFetch(", index);
    if (start === -1) break;
    let cursor = start + "mpFetch(".length;
    let depth = 1;
    const args: string[] = [];
    while (depth > 0) {
      const char = source[cursor];
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      args.push(char);
      cursor += 1;
    }
    const body = args.join("");
    const parts: string[] = [];
    let inner = 0;
    let current = "";
    for (const char of body) {
      if ("([{".includes(char)) inner += 1;
      else if (")]}".includes(char)) inner -= 1;
      if (char === "," && inner === 0) {
        parts.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    parts.push(current.trim());
    // parts[0] is the host, parts[1] the op; the rest are the slots.
    const op = parts[1]?.replace(/["'`]/g, "") ?? "";
    const used: string[] = [];
    parts.slice(2).forEach((value, slot) => {
      // A trailing comma leaves an empty part; it fills no slot.
      if (value === "undefined" || value === "") return;
      used.push(SLOTS[slot] ?? `slot${slot}`);
    });
    calls.push({ op, used });
    index = cursor + 1;
  }
  return calls;
}

describe("MP adapter bridge slot positions", () => {
  it("uses only the slots each read is allowed to use", () => {
    const calls = adapterCalls();
    expect(calls.length).toBeGreaterThan(20);
    for (const call of calls) {
      const expected = EXPECTED[call.op];
      expect(expected, `unknown read ${call.op}`).toBeDefined();
      const allowed = new Set<string>(expected);
      for (const slot of call.used) {
        expect(
          allowed.has(slot),
          `${call.op} must not use the ${slot} slot (allowed: ${expected.join(", ") || "none"})`,
        ).toBe(true);
      }
      expect(
        new Set(call.used).size,
        `${call.op} must not use the same slot twice`,
      ).toBe(call.used.length);
    }
  });

  it("covers every read the adapter performs", () => {
    const performed = new Set(adapterCalls().map((call) => call.op));
    for (const op of performed) {
      expect(EXPECTED[op]).toBeDefined();
    }
  });
});
