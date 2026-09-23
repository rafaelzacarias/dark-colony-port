# Native Combat Browser QA Fixture

[Browser entry](../tools/qa/fixtures/native-combat-browser.ts) is an explicit local-development fixture, not a production route. Use the existing Vite origin with the original `raw_cd/DC` tree present. Original raw files are fetched from `/raw_cd/DC/...`; they are not copied to public assets or published by a production build.

```ts
const { createNativeCombatBrowserHarness } = await import(
  "/tools/qa/fixtures/native-combat-browser.ts"
);
const qa = await createNativeCombatBrowserHarness(canvas, stage, callbacks);
await qa.initialize();
qa.advanceTo(16);
qa.focusOwnedTroop(true);
qa.advanceTo(87);
qa.view.render();
const saved = qa.checkpoint();
await qa.restore(saved, true);
qa.advanceTo(88);
qa.dispose();
```

The caller supplies a normal canvas, stage element and optional MissionView callbacks. Initialization is explicit and loads normal rendering assets; diagnostic failures propagate. No requestAnimationFrame loop or automatic native clock is installed. Call `qa.view.render()` to present a chosen state. The main QA owner runs the embedded-browser visual check separately.

## API

Optional queued normal input is documented in
[Bounded MissionView Player Input](mission-native-player-orders-20260920.md).
Pass fourth harness argument `"queued-player-input"`, then supply actual frames to
`advancePlayerFrame(input)`. This mode exposes `queueNativePlayerOrder(command)`
and `commandStatus`; it rejects scripted `advanceTo` and never installs a clock.

- `createNativeCombatBrowserFixture(fetchBytes?)`: returns the typed `SourceNativeCombatMission`, original initial world, corridor column/row, label, SHA-256 hashes keyed by fetched URL, `frameInput(snapshot)` and `recreateProviders()`.
- `createNativeCombatBrowserHarness(canvas, stage, callbacks?)`: adds the live `view` getter, `initialize()`, `advanceTo(counter)`, `focusOwnedTroop(dynamic = false)`, `checkpoint()`, `restore(saved, initialize = false)` and `dispose()`.
- `advanceTo` executes explicit 16 ms native frame inputs through counter 95, with Attack7 at 17 and target Move2 at 58. Frame 16 allocates the two real dynamic actors. Frame 87 launches, impacts and reclaims one projectile, reducing target HP from 800 to 775. Frame 88 consumes the damaged reaction.
- Frame 96 deliberately requests unsupported type92 allocation. It is excluded from `advanceTo`; test rejection explicitly with `qa.view.advanceNativeCombat(qa.frameInput(qa.view.campaignSnapshot))`. State must roll back.
- Restore recreates authenticated task/combat providers from retained original asset bytes, not serialized authenticated configurations, then calls normal `MissionView.restore`. Rendering resources are initialized only when the second argument is true. On success `qa.view` points to the replacement and the previous view is disposed.

### Optional Native Visibility

Pass explicit `{ localTeam, localMask, daylight, crtSeed }` as the second fixture
argument or fifth harness argument to authenticate visibility from real source
bytes, including DESERT.BTS. `advanceNativeVisibility({ visibilityFrame })` returns
the compact projection and visibility event without advancing actor time. Its
producer and exclusion lists are explicit; it is never scheduled automatically.
Fresh-provider restore recomputes visibility identity. See
[Authenticated MissionView Visibility](mission-native-visibility-20260920.md) for
native sight/exploration semantics, source scope and Node-only evidence.

## Source And Scope

The label is **Original HUMAN02 world (21 actors) + separate bounded QA combat caller (2 dynamic actors); not original mission/TRO admission**. All original actors, including neutral VENT, remain. The synthetic bounded TRO is identical to the [Node fixture](../tools/qa/fixtures/native-combat-mission.ts); it is not HUMAN02's original mission script.

The bootstrap imports the npm `buffer/index.js` package and installs global Buffer only if absent, before any runtime parser/factory dynamic imports. Importing the entry alone does not install it. Production code and parser APIs are unchanged. Factory private Uint8Array snapshots before asynchronous authentication remain untouched, including SharedArrayBuffer safety.

The initial camera is MissionView's normal team0 focus, including its static fallback when no mobile troop exists. The dynamically allocated team0 troop becomes a normal owned unit after frame16. `focusOwnedTroop(true)` selects its actual location through `setCameraCenter`; it does not modify selection, actors, visibility or explored fog. Team5 is not made player-owned.

No renderer, effects, fog, audio, mission admission or original AI policy is bypassed. The neutral VENT rendering boundary is owned separately by MissionView work; initialization/rendering can still report that boundary. This fixture does not certify VENT rendering, native effects/audio, realtime performance, lethal combat, arbitrary commands or a complete original mission.

## Verification

[Focused tests](../tools/qa/native-combat-browser.test.ts) bundle for the browser without Node externals, execute bootstrap in a Buffer-free VM, compare all 126 fetched source hashes and complete configuration/world against the Node fixture using the browser Buffer implementation, exercise the hit/restore/reaction/rollback sequence, and verify Vite raw-byte delivery and entry transformation. Strict fixture/test typechecking is separate. No browser, full suite or subagents are required by these tests; actual embedded-browser rendering remains a separate check.