# Authenticated MissionView Visibility

[MissionView](../src/mission-view.ts) consumes the existing
[explicit host/session visibility phase](source-native-visibility-host-20260920.md).
Presence of `sourceNativeCombat.options.nativeCombat.visibility` is the explicit
opt-in. The configuration must come from the source-byte factory, retain its
authenticated immutable identity, and use local team 0 with the matching source
player faction. Incompatible teams are rejected, never coerced. `localMask`,
daylight and CRT seed remain explicit source-caller inputs, not view-clock values.
The nonvisibility mode keeps its existing geometric fog behavior.

## API

```ts
const frame = view.advanceNativeVisibility({
  visibilityFrame: {
    sequence: 1,
    counter: 0,
    producerSlots,
    excludedProducerSlots,
  },
});
frame.visibilityEvent;
frame.visibility.groundWords;
view.visibility;
view.explored;
```

The return type is `NativeViewFrame & { visibilityEvent: SourceNativeVisibilityEvent }`:
the compact view projection, not a full session snapshot or source tables.
Its buffers are detached from the view. Only `visibilityFrame` is accepted;
the caller supplies the full explicit producer/exclusion partition. The phase
does not call generic advance, visit actors/projectiles, scan TRO, change the
actor clock/cycle/host tick, consume RNG, or emit audio. Sequence advances even
when the native counter predicate is false; that case retains the same planes
and raw actors and records the accepted phase.

The view stages a session/simulation candidate, invokes
`stepVisibilityForNativeView`, refreshes compact actor state and the FIN sample
cache, applies the normal projection/identity/resource guards, then commits before
selection publication and `onUnitsChanged`. Projection errors discard the whole
candidate, including its accepted visibility journal. External simulation changes
and replaced visibility configuration are rejected before a phase.

## Fog And Commands

`visibility.groundWords` already uses runtime row-major orientation with both
width and height. There is no additional Y flip in the view. Current sight is
`Boolean(word & configuration.localMask)` using native team bits 23 through 30
(`0x40000000 >>> team`). The mask may include multiple teams or describe a directed
observer policy; the view does not infer reciprocal alliances, substitute an
actor profile's acquisition mask, or force team 0's bit into it.

Exploration is exactly `word >>> 31`. It is local persistent source state, not
the OR of current sight and not a geometric radius. Both getters return detached
arrays. Before the first phase, the view displays the actual existing native
plane, including any movement-written sight bits, without inventing exploration.
Actor advances continue to project the current native plane when opted in.

Pending player commands retain their selected and target identity/raw bytes
unchanged across visibility calls. The existing revalidation rejects stale raw
bytes (including target detection byte `+0xca`), hidden targets and changed
acquisition. No expected byte array is silently rebased. The focused
[command adapter change](../src/engine/source-native-player-orders.ts) uses the
existing authenticated world clone before alignment validation; public detached
host copies otherwise lose visibility's immutable identity. All raw binding,
generation, route, acquisition and receipt checks remain.

Restore still requires fresh external task/combat/visibility providers and full
interleaved source history. It recomputes host phases, rebuilds actor projection,
and requires saved view exploration to equal replayed bit 31 exactly. Checkpoint
JSON cannot establish configuration identity. Stale pending commands also reject
on restore. No save version or expected source configuration was changed.

## Browser Fixture

[Browser fixture](../tools/qa/fixtures/native-combat-browser.ts) optionally accepts
`createNativeCombatBrowserFixture(fetchBytes, visibilityOptions)` or the fifth
argument of `createNativeCombatBrowserHarness`. Supply all four values:
`{ localTeam: 0, localMask: 0x40000000, daylight: 0, crtSeed: 1 }`.

It loads actual DESERT.BTS bytes in addition to the existing EXE/GAMESTAT/SCN/MAP/
MTG/PTH sources, authenticates the combat-task world, and calls
`createSourceNativeVisibilityHostConfiguration`. Fresh providers recompute that
identity from the retained bytes and the same pre-install world. The harness
exposes `advanceNativeVisibility(input)` independently of `advancePlayerFrame`.
No trace JSON, fake planes, automatic phase ordering or native timer is installed.
The normal default fixture and its source fetch set are unchanged.

## Evidence And Limits

[View tests](../tools/qa/mission-native-visibility.test.ts) verify bit mapping,
non-square dimensions, source planes, false predicates, independent journal,
pre-phase movement sight, exact exploration, local-team/faction and immutable
identity rejection, late projection rollback, natural target visibility, pending
attack revalidation and fresh-provider restore. Producer 171 naturally explores
129 cells at actor frame 16, including target cell 1289. Excluding all producers
then clears sight while retaining exactly those explored cells. All 21 original
actors plus the two genuine bounded-caller allocations remain registered; no
unsupported actor is hidden or removed from the source world.

[Sound integration](../tools/qa/mission-native-visibility-sound.test.ts) uses real
source-byte sound configuration and 31 actual hits before actor frame 613. A
separate visibility phase naturally explores victim cell 1291; a subsequent clear
retains bit 31 with no current sight. Separate actor frame 614 delivers the lethal
hit and sound 28 exactly once through `onNativeDeathSound`, after outer commit.
Missing consumer and late projection failure roll back without delivery. A
throwing consumer observes committed state and does not cause retry delivery;
fresh full-history restore and the next native death visit emit no repeat.
This is a sound-request/callback test, not audible browser playback or proof of
arbitrary prior mission CRT history.

[Browser fixture test](../tools/qa/native-combat-browser-visibility.test.ts) runs
under Node with real bytes and fresh identity restore. Browser bundle and existing
nonvisibility Move/Stop/guard regressions also pass. Final focused selection:
8 passed, no skips, `/tmp/dc-view-visibility-focused-20260920-v10.log`.
Separate sound integration: 1 passed, `/tmp/dc-view-visibility-sound-20260920-v9.log`.
Strict/no-unused types: `/tmp/dc-view-visibility-types-20260920-v11.log`; editor
diagnostics clean.

Excluded producers are an explicit bounded source-caller partition, not a claim
that the original game excludes CITY/resource/air/commander producers. Complete
original mission/TRO, all producers, mutable alliance/daylight and world-service
ordering remain outside admission. No realtime clock/cadence claim is made.
No agents, full suite, browser launch, package changes or generated assets were
used. Embedded-browser visual/input checks remain for the main QA owner to rerun
after HMR settles.