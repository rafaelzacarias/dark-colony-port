# Bounded MissionView Player Input

[MissionView](../src/mission-view.ts) opts in with
`sourceNativeCombat.playerCommands = { scope: "bounded-semantic-queue", localTeam: 0 }`.
The existing default explicit-receipt view is unchanged. This is a bounded semantic
input bridge, not original UI/input-device parity or original mission admission.

## Normal Input

- Normal selection and camera/client-coordinate conversion remain in use; exactly
  one living, registered, local-team type-0 native binding can issue an order.
- M then a free cell, or context-click on a free cell, queues MoveOnly/order 2.
  Routes must be horizontal, clear, same nonzero PTH family, one to three cells.
- A then a free endpoint queues Attack/order 7 only when native acquisition has a
  current target accepted by the adapter and that target is visible in view fog.
  This is **bounded attack-move**, not target locking. The endpoint is the clicked
  free cell; the target is the native acquisition result, not a nearest-unit guess.
- Clicking an occupied enemy cell does not invent another waypoint: it rejects
  with `UnsupportedPath`. Clicking a friendly in context mode still selects it.
- Stop queues order 13. Patrol, waypoint lists, multi-selection dispatch, arbitrary
  pursuit, non-type-0 orders and longer/nonhorizontal routes remain unsupported.

`queueNativePlayerOrder(command)` is the typed API for the same semantic queue.
Attack requires an explicit full target binding and a separate free destination.
It returns an `ok` preview or `UnsupportedPath` with a diagnostic, never a receipt.
Normal void input methods publish errors through `nativeCommandStatus.diagnostic`;
they do not poison mission state. `nativeCommandMenu` exposes Move, Bounded
attack-move and Stop, disabling them while queued or without a eligible single
native actor. Destination/acquisition admission still occurs on input and advance.
Move cursors check the compact native ground/PTH route; the A cursor is an aiming
cursor, not a promise of acquisition. Without a visibility opt-in, UI fog remains
the existing view calculation and the adapter additionally requires the native
ground mask. With [authenticated native visibility](mission-native-visibility-20260920.md),
view fog consumes the configured native local mask and exploration bit 31 exactly.
Visibility phases leave pending raw bindings unchanged; normal revalidation rejects
stale bytes or newly hidden targets. No visibility owner/session implementation was
changed by this view integration.

## Transaction And Save

One pending command is allowed; later commands reject without replacing it.
Selection changes do not retarget that command. The pending value records source
configuration ID, deterministic receipt ID, selected slot/key/generation/raw bytes,
local team and semantic command. It contains no guessed clock, frame or receipt.

The next `advanceNativeCombat` revalidates against a full committed world snapshot,
then creates/preflights the adapter receipt using that call's actual explicit clock,
counter, task budget and registered visits. Additional `nativeAiReceipt` input is
rejected, including an explicitly present undefined receipt. The existing candidate
view/session transaction performs the real step; the semantic queue clears only at
successful outer commit. This means receipt publication, not immediate native task
acceptance: original pending orders can remain until an accepting native visit.
Failure, including a late caller allocation failure, leaves the queue and session
unchanged. Wallclock update only renders and never consumes input.

The existing strict checkpoint schema gains optional `state.nativeCommand`; no
version bump or required field breaks old saves. Restore validates exact shape,
source, canonical ID, raw identity/generation, route, acquisition and view fog
against the externally authenticated restored session. Stale/tampered commands and
unopted saves reject. Queued Move and Attack survive JSON round trips exactly and
publish once after restore. Command rejection diagnostics are transient UI state,
not additional serialized simulation input.

Full snapshots occur at command validation/consumption, not ordinary rendering.
The compact projection, cached native presentation and explicit advance scheduler
remain intact. No realtime/20 TPS or 90 ms performance claim is made.

## Browser Bridge

[QA harness](../tools/qa/fixtures/native-combat-browser.ts) accepts fourth argument
`"queued-player-input"`. Its `view` uses normal selection/M/A/Stop methods;
`queueNativePlayerOrder`, `commandStatus` and `advancePlayerFrame(input)` are typed.
The main QA caller must supply the actual explicit frames. `advanceTo` rejects in
this mode so its scripted Attack17/Move58 receipts cannot silently collide with or
replace player intent. The default `"scripted-receipts"` mode is unchanged.
The production shell has no new automatic native driver.

## Verification

[View tests](../tools/qa/mission-native-player-orders.test.ts) use fake canvases and
public normal-input methods: Move/Stop, A/free endpoint, occupied enemy rejection,
real native hit, exact queued restore, strict tamper guards, receipt collision,
once-only publication and early/late rollback. Three passed in
`/tmp/dc-view-player-attack-20260920-q08.log`.
The existing adapter guard regression passed after preview extraction in
`/tmp/dc-view-player-adapter-20260920-q03.log`.
[Browser fixture tests](../tools/qa/native-combat-browser.test.ts) exercise the
typed bridge under Node and bundle without Node externals. These are API tests,
not real Playwright keyboard/pointer events. No browser, full suite, package,
asset, host, session or native visibility changes are part of this work.