# MP capability boundary (#86)

Deferred MP integration scope: presence, live timing, and server-session
controls. Account authentication is active P0 work in #149 and is not deferred
by this issue. This file is the capability-boundary contract from the #86
checklist: what lives offline, what lives behind the authenticated server
adapter, and which reference behavior each side mirrors.

Apple sign-in navigation was refreshed against AHDClient
`7f3a5e620bac129b1dfb2ae973f723240ed61b3a` on 2026-10-01. Native's
desktop game sign-in window and shared Ask policy now allow the exact
`appleid.apple.com` host over HTTPS on port 443, alongside the existing
provider hosts. HTTP, alternate ports and lookalike hosts remain external.
Both actual Rust navigation tests failed before this allowlist update and
passed after it in a focused source-fragment probe using the locked URL
parser. Full Tauri checks are part of the hosted gate; authenticated device
acceptance remains #363/#510.

## Offline SP boundary

The offline app is a local singleplayer game with no network dependency:

- `src/game/session.ts` (`GameSession`) owns mutable engine state; only
  detached display data and save strings cross the boundary. There is no
  server adapter, no session phase, and no network call on this path.
- Turn flow is player-paced: End turn advances the local world one turn, and
  the idle footer renders `Player paced` (`src/ui/GameScreen.tsx`, footer
  statusline). The offline footer has no presence, countdown, or server
  control by construction.
- The drawer exposes no presence, countdown, or server routes or labels
  (`src/ui/MobileNavigation.tsx`, `MENU_GROUPS` / `drawerRouteIds`). Rows
  without a reachable Native destination are omitted, never placeholders.
- `src/ui/HelpPanel.tsx` documents MP accounts and live server play as out
  of offline scope (`Still unavailable here`), and keeps account settings,
  feedback, and suggestions inside Multiplayer after AHDGame authenticates
  that surface. The offline app cannot inspect or reuse that account session.

Regression lock: `src/ui/MpBoundaryOffline.test.tsx` asserts the idle footer
shows `Player paced` with no online/countdown/server text, and that the
drawer route ids and labels contain no presence/countdown/server entries.

## Authenticated MP boundary (behind the server adapter)

MP controls render only from the authoritative server adapter. There are no
dead MP controls offline and no synthesized server state anywhere:

- `src/mp/adapter.ts` (`MpModeSession`) is the single adapter. Session
  phases: `idle`, `loading`, `session-required`, `signed-out`, `ready`,
  `auth-expired`, `offline`, `rate-limited`, `server-error`. Failures land in
  a recoverable phase with retry; last loaded state is kept below the notice.
- Presence comes from the public `GET /api/players/online` endpoint
  (`src/mp/endpoints.ts`, players-online block). The reference
  (`AHDGame src/components/StatusBar.tsx:105-143`) polls it every 5 minutes
  plus on visibility return, visible-only, and renders nothing until a fetch
  succeeds. Native mirrors that posture exactly: `PRESENCE_POLL_MS` of
  300_000 plus visibility re-poll (`src/ui/MpModeScreen.tsx:44-49, 219-238`),
  with `loadPresence` outside enter/refresh so every failure mode (refusal,
  rate limit, malformed, offline, surprising 401) leaves the row absent,
  never zero, and never touches phase or error state
  (`src/mp/adapter.ts`, `loadPresence` contract).
- Live timing is projected from the latest turn-status contract and never
  synthesized. `MpTurnView` now carries the calendar fields the reference
  uses (`startingYear`, `preIterationTurns`, `preIterationActive`), the pause
  classification (`pauseKind`), iteration/market metadata, and the processing
  slice. `formatServerTurnDate` (`src/mp/turnCalendar.ts`) applies the
  same `calendarTurn` founding freeze and preset starting year as AHDGame, so
  the MP footer/card render `Turn N · [Founding] Month, Week N, Year` exactly
  like the SP footer. `formatTurnCountdown` (`src/mp/validators.ts`) stays
  pinned to `formatRealTimeCountdown` (`AHDGame src/lib/utils/formatters.ts`,
  used by `StatusBar.getTimeUntilNextTurn`): null schedule renders no claim,
  a passed deadline renders `Processing...`, paused renders `Paused`. The
  World turn card states mirror the reference (`StatusBar.tsx:382-422`):
  `Processing: <label> [(<pct>%)]` with an independent target-turn row,
  `Paused[: reason]`, `Live` with the countdown or `Player paced` when the
  world has no schedule, and `Paused` for an inactive world. Malformed
  progress hides the percent while the server target still shows.
- Latest-turn freshness: `loadTurnStatus` re-reads the public
  `GET /api/game/turn/status` on its own cadence, outside enter/refresh, so
  a long-open screen keeps referencing the newest server turn. The cadence
  is pinned to `AHDGame src/hooks/useGameEvents.ts` `nextPollDelay`: 1.5s
  while processing, 15s inside two minutes of the next turn or quarter-hour
  market tick, 60s within ten minutes, 120s relaxed, 300s hidden, plus a
  foreground re-poll. A newer turn triggers one full projection refresh
  (character, capabilities, inbox), mirroring the reference turn-change
  refetch, so AP and capabilities match the new turn. Every turn-poll failure
  keeps the last good turn and never touches phase, error, drafts, or other
  views (`src/mp/turnPoll.ts`, `MpModeSession.loadTurnStatus`).
- Resource figures come from the authoritative status read
  (`GET /api/client-status?layout=minimal`, `requireBasicAuth`). The Rust
  bridge pins the layout and the transport allowlist accepts exactly
  `layout=minimal` for that path, so the read stays cheap: the minimal
  layout answers the action count, action cap, campaign funds, cash, home
  currency, political influence and favorability the footer shows and skips
  the corporation, election and income enrichment the wider layouts run.
  `loadStatus` sits outside enter/refresh, so every failure keeps the last
  good figures without touching phase or error state, and the screen
  refreshes it on the reference cadence (60s while visible, plus a new turn
  and foreground return). The wide layout of the same read
  (`?layout=full`) carries the per-turn campaign income breakdown; because
  it runs the reference's enrichment queries, it is read on demand when the
  funds details are opened and never polled.
- World reads are public and separate from the character projection:
  `GET /api/countries` answers the runtime nation directory,
  `GET /api/country/[code]/overview-counts` answers one nation's headline
  figures (parties, politicians, elections, bills, regions, GDP, budget
  balance, unions, prime rate), `GET /api/country/[code]/states` answers
  that nation's regions, `GET /api/country/[code]/parties` and
  `GET /api/country/[code]/politicians` answer its parties and
  politicians, `GET /api/country/[code]/legislature/leaders` answers its
  legislature leadership, `GET /api/elections?country={code}&view=summary`
  answers its races, and `GET /api/news` answers the world news feed. The Rust bridge pins the country code to a two-letter key,
  and the adapter refuses to send anything else. All of these loads sit
  outside enter/refresh: a failure keeps the last good view and never
  expires the session.
- Reconnect and session restore: mount chains enter, then on-demand mail,
  then presence; manual Refresh re-reads authoritative state and refreshes
  presence; foreground return re-probes while waiting for a session (#149).
  The blocked card keeps last loaded state with Reconnect; auth expiry
  renders `Session expired` with a provider reconnect path and evicts every
  authed projection, closing open detail panels. Unlink/switch resets
  per-account form state so a shared phone never leaks the previous
  player's mail or drafts (#149, #363). Session material is never persisted
  to web storage. There is no Native token store: AHDGame owns
  authentication and the session, matching the observed AHDClient boundary
  where the live game owns login state.
- Server account controls (account settings, feedback, suggestions board,
  Quick Suggest capture) live inside Multiplayer after AHDGame authenticates
  that surface, as documented in `src/ui/HelpPanel.tsx`.

Reference presentation parity, not behavior drift: `AHDClient
apps/desktop/src/gameShell/GameShell.tsx:64-70, 567` badges or gates
`multiplayerOnly` destinations instead of showing dead controls. Native
follows the same rule: a capability without a reachable destination is
omitted, and an MP control renders only with loaded authoritative data
behind it (detail panels open only after the summary load succeeds).

## Test evidence

- Presence/countdown/processing/paused/failure modes across phone and
  desktop widths: `src/ui/MpModeScreenPresence.test.tsx`.
- Presence shape validation and countdown formatting:
  `src/mp/validators.test.ts`, `src/mp/presence.test.ts`.
- Latest-MP-turn contract and freshness: `src/calendar/larpCalendarParity.test.ts`
  (SP and MP render the same calendar), `src/mp/turnCalendar.test.ts`
  (LARP calendar, founding freeze/offset, era-year derivation),
  `src/mp/turnPoll.test.ts` (reference cadence), `src/mp/turnFreshness.test.ts`
  (`loadTurnStatus` keeps the session and last good turn on every failure),
  `src/ui/MpModeScreenTurnFreshness.test.tsx` (rendered SP-identical calendar,
  Founding badge, identity and funds in the footer, 120s/1.5s polling,
  background skip, foreground re-poll, turn-change refetch).
- Status read and footer resources: `src/mp/status.test.ts`,
  `src/ui/MpStatusFooter510.test.tsx`, and the Rust allowlist test
  `mp_session::tests::client_status_read_pins_the_minimal_layout`.
- World reads: `src/mp/nations.test.ts` (nation directory and nation
  figures, including the refusal to send an invalid country code),
  `src/ui/MpNations510.test.tsx` (rendered directory, home marker, nation
  card, honest empty state) and the Rust path/allowlist test
  `mp_session::tests::world_reads_resolve_to_pinned_paths`.
- Endpoint contracts: `src/mp/endpoints.test.ts` (pinned to AHDGame
  `e35f75e3fe230e7ab4439a4f63b7269829a64f9d`).
- Reconnect, auth expiry, cold boot, foreground restore, mode transition,
  sign out and unlink residue: `src/mp/sessionLifecycle.test.ts`,
  `src/mp/coldBootRestore.test.ts`, `src/ui/MpModeScreenSessionRestore.test.tsx`,
  `src/ui/MpModeScreenForegroundRestore.test.tsx`,
  `src/ui/MpModeScreenModeTransition.test.tsx`,
  `src/ui/MpModeScreenSignOut.test.tsx`,
  `src/ui/MpModeScreenSessionlessOffline.test.tsx`.
- Offline boundary (no dead controls, MP out of scope):
  `src/ui/MpBoundaryOffline.test.tsx`, `src/ui/HelpPanel.test.tsx`,
  `src/ui/MobileNavigation.test.tsx` (omission test),
  `src/ui/GameScreenStatusline.test.tsx` (idle `Player paced`).

## Residual gaps (stay open under #86)

- Full MP gameplay parity beyond the implemented adapter slices remains
  deferred to the later authoritative MP integration.
- The pinned minimal status layout carries no per-turn income breakdown,
  corporation nav, election stats or turn briefing. The MP footer therefore
  shows the resource figures without the reference's income tooltip; the
  wider layouts would add the reference's heavier enrichment queries, and
  that trade is still open.
- Turn freshness is poll-based, matching the reference status bar. The
  reference's typed turn events (`turn_start`, `turn_complete`,
  `market_tick`) still have no separate Native stream; polling picks the new
  turn up within the audited windows.
- The offline surface must stay free of dead presence, countdown, or server
  actions as destinations evolve; the regression test above is the lock.
- MP controls are added only with a connected authoritative server adapter
  plus reconnect, processing, auth-expiry, and save/session-transition
  tests for each new control.
