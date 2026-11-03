# Latest MP turn parity (#510)

Multiplayer must reference the newest authoritative turn, not the snapshot
loaded when the screen mounted, and it must present that turn on the same
calendar as singleplayer. This record covers the bounded latest-turn slice.

## Reference pin

- Latest audited AHDGame: `e35f75e3fe230e7ab4439a4f63b7269829a64f9d`
  (`origin/main`, 2026-10-21; local checkout HEAD matched it).
- Previous MP audit pin: `e364c04954ed628beef73a993a8e9e156650a31e`.
  AHDGame had moved 2,951 commits past it.
- `src/mp/endpoints.ts` now cites the new revision in both the header and
  `MP_AUDIT_REVISION`; `src/mp/endpoints.test.ts` locks the pair together.

turn-status is still the public `GET /api/game/turn/status`. Between the two
pins the payload added `iterationId` and `lastMarketTickAt`; the calendar,
founding, pause and processing fields already existed but Native was not
projecting all of them. No audited read used by Native changed shape in a
breaking way: elections/notifications/unions added fields or server-side
filtering, and the projections Native parses still resolve.

## Latest-turn projection

`src/mp/validators.ts` (`MpTurnView`) now projects:

- `startingYear` (or derives it from `currentYear` and the calendar turn when
  an older server omits it), so preset eras (1953/1991/2019) render correctly.
- `preIterationTurns` and `preIterationActive`, the founding offset/freeze
  inputs.
- `pauseKind` (`manual` / `auto-drift` / null), `preset`, `iterationId`,
  `lastTurnProcessed`, `lastMarketTickAt`, `fastMode`.
- The existing processing slice (`processingPhaseLabel`, progress, target).

Malformed new fields degrade per field (no fabricated date or pause class);
the required `currentTurn`/`currentYear` still fail the whole projection.

## One calendar for SP and MP

`src/calendar/larpCalendar.ts` holds the dependency-free LARP arithmetic
(48 turns = 1 year = 12 months of 4 weeks, reference turns counted from 1).
Singleplayer renders it from the local engine clock
(`src/game/gameDate.ts`), and `src/mp/turnCalendar.ts` projects it from the
server's raw turn:

- `serverCalendarTurn` pins the calendar to turn 1 while the founding phase
  runs, then subtracts `preIterationTurns` once it ends.
- `serverStartingYear` prefers the reported `startingYear` and reconstructs
  it from the pinned `currentYear` otherwise.
- `formatServerTurnDate` renders `Month, Week N, Year` through the shared
  calendar, matching AHDGame `calendarTurn` + `rawTurnToLarpDate`
  (and the native SP footer) byte-for-byte.

The arithmetic lives outside `src/game/` on purpose: the multiplayer layer
must not import the offline engine, so the two modes share a neutral module
instead. `src/calendar/larpCalendarParity.test.ts` pins that both modes
render the same string for the same world, including the founding freeze and
the post-founding offset.

The MP footer and World turn card both render
`Turn N · [Founding] Month, Week N, Year`. The footer also regained the SP
leading identity (name opens Profile, then party · country) and the campaign
funds chip from `client-nav`, which MP previously dropped even though the
data was loaded.

## Freshness

`MpModeSession.loadTurnStatus` reads turn-status without re-reading the
authenticated projection. It is public, failure-tolerant, and never expires
the session or clears drafts; a failed poll keeps the last good turn.

`src/mp/turnPoll.ts` pins the reference cadence from AHDGame
`src/hooks/useGameEvents.ts` `nextPollDelay`:

| State | Delay |
|---|---|
| Processing | 1.5s |
| Next turn or quarter-hour market tick < 2 min | 15s |
| Next update < 10 min | 60s |
| Relaxed | 120s |
| Hidden tab | 300s |

`MpModeScreen` schedules the next poll from the latest snapshot, re-arms when
the session phase settles, and re-polls on foreground return. A newer
`currentTurn` triggers one full refresh (character, capabilities, inbox) so
AP and capabilities match the new turn, mirroring the reference turn-change
refetch. A turn landing mid-action does not race that action's refresh
(`busyRef`).

## Footer resource parity

The SP footer leads with the character identity and shows action points,
campaign funds, cash, influence and favorability. MP had the identity, AP,
cash and inbox only, and the campaign funds chip was dropped even though
`client-nav` already carried the figure.

Delivered:

- The MP footer leads with the same identity block (name opens Profile,
  then party · country).
- A new audited read, `GET /api/client-status?layout=minimal`, supplies the
  resource figures. The Rust bridge pins the layout so the read stays cheap
  (the minimal layout skips the corporation, election and income
  enrichment the wider layouts run), and the transport allowlist accepts
  exactly `layout=minimal` for that path. Native projects the action count,
  action cap, hoard threshold, campaign funds, stored campaign funds, cash,
  home-currency liquid cash, home currency, donor base, political influence
  and favorability; the income breakdown, corporation nav, election stats
  and turn briefing stay server-side.
- `MpModeSession.loadStatus` reads it outside enter/refresh: every failure
  keeps the last good figures, never expires the session and never invents a
  value. The screen refreshes it on the reference cadence (60s while
  visible), on a new turn, and on foreground return.
- The footer now shows AP, Funds, Cash, Influence and Favorability. Funds
  and cash carry the reported home currency; the AP chip carries the server
  action cap as its title.

## Test evidence

Commands (run from the worktree):

```
npx tsc --noEmit
npx vitest run --config vitest.config.ts src/calendar/larpCalendarParity.test.ts \
  src/mp/turnCalendar.test.ts \
  src/mp/turnPoll.test.ts src/mp/turnFreshness.test.ts src/mp/status.test.ts \
  src/mp/validators.test.ts src/mp/endpoints.test.ts
npx vitest run --config vitest.ui.config.ts \
  src/ui/MpModeScreen.test.tsx src/ui/MpModeScreenPresence.test.tsx \
  src/ui/MpModeScreenTurnFreshness.test.tsx src/ui/MpStatusFooter510.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Covered behavior:

- LARP vectors (turn 1/4/5/48/49, presets 1953/1991/2019), founding freeze
  and post-founding offset, era-year derivation.
- Reference polling delays including processing, near/soon/relaxed, hidden
  and quarter-hour market ticks.
- `loadTurnStatus` updates only the turn, keeps phase/character/capabilities/
  inbox, and keeps the last good turn on 429, transport loss, and malformed
  bodies; it performs no call without a signed-in ready session.
- Rendered SP-identical footer/card date, Founding badge, footer identity and
  funds chip; 120s poll adopts turn 13 and refreshes AP/presence; 1.5s
  processing poll; no poll while hidden; foreground re-poll.
- Status read: `src/mp/status.test.ts` (projection, failure handling, no
  call without a session), `src/ui/MpStatusFooter510.test.tsx` (rendered
  AP/Funds/Cash/Influence/Favorability chips, 60s refresh, failure keeps the
  last good figures, background skip) and the Rust allowlist test
  `mp_session::tests::client_status_read_pins_the_minimal_layout`.

This is local Linux/browser/jsdom evidence. Physical iPhone acceptance
remains #363/#436 and is not claimed here.

## Remaining parity gaps

- The campaign income breakdown now arrives, but only from the wide status
  layout, which the funds details read on demand. The corporation nav,
  election stats and turn briefing the wider layout also carries are still
  unprojected.
- Turn freshness is poll-based like the reference StatusBar; there is no
  separate Native stream for the reference's typed turn/market events.
- Whole-app MP/SP destination parity remains tracked by #510 and #28. The
  turn contract, the calendar, the footer resources and their details, and
  the world destinations are delivered; the world map, the hall of fame, the
  remaining per-nation drill-ins, the markets and holdings surfaces, and the
  physical-device acceptance are not.
