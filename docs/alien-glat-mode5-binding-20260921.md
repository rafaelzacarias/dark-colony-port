# AL01 GLAT indexed-source investigation

## Result

The reported `CENT:glat:mode5-effect-indexed-source-required` warning does not
reproduce with freshly initialized, real published assets in the current Node
MissionView composition path. No runtime fix is justified by this evidence.
Only tests and this document were changed. MissionView, main, loaders, assets,
package configuration and admission rules were not changed. No browser, agent,
development server or full suite was launched.

## Controlling path

- `MissionView.initialize()` loads every timeline child's atlas, then passes the
  union of atlas keys to `createMissionSpritePalettes()`.
- The loader uppercases names and registers indexed sources against the exact
  mission object. GLAT is present in the published indexed assets and is fetched
  during initialization, before the first opening tick. Animation event names
  are not used to choose these atlas keys.
- `MissionView.#drawVisual()` uses a PNG for mode5, not the team-remapped Canvas.
  That PNG does not need its own indexed metadata: `drawNativeMode5Canvas()`
  first resolves the uppercased child name from the mission registry.
- `createMissionSceneFrame()` preserves the mission identity. Mixed-case
  `glat`/`GLAT` lookup succeeds without recoloring or attaching metadata to PNGs.
- `indexed-source-required` means neither the mission registry lookup nor the
  image metadata lookup returned an atlas. It precedes frame, Canvas-state,
  flags, layer, mirror and destination-palette validation. Those later rejection
  reasons cannot explain this specific warning.

## Evidence

`tools/qa/mission-mode5-opening.test.ts` runs default `loadCampaignMission()` and
actual `MissionView.initialize()`/updates for Alien and Human through tick 220.
Both fetch GLAT indexed metadata before updates; neither performs additional
fetches during those ticks. The real scene composition reaches mode5 for
`CENT:glat` and `BEAC:beac`, with no missing-indexed-source warning.

This test stubs image loading and GPU calls. Its intentionally incomplete
Canvas state produces `mode5-effect-canvas-state-unverified`, proving the
indexed source was resolved, not pixel correctness or browser/GPU parity.

`tools/qa/mode5-effect-native.test.ts` separately verifies:

- Mixed-case source names and an unregistered PNG-like image still render exact
  native Canvas goldens when the original mission identity is supplied.
- Substituting an unregistered copy of the mission reproduces exactly
  `mode5-effect-indexed-source-required`, before any readback.
- Fresh `--source-effects` oracle execution against unchanged CENT FIN/GLAT SPR
  and palette sources gives 40 exact Canvas framebuffer comparisons. Eight
  unsupported source variants remain rejected before readback. Source hashes
  and zero runtime interceptions are asserted.
- Existing four-bank mode5 goldens and atomic failures remain intact.

Validation: 94 mode1/mode5 tests passed together, the added CENT source test
passed separately, and both opening tests passed. Scoped strict TypeScript
checking and editor diagnostics were clean. The mode1 suite includes GRAY
native goldens and ambiguous-destination atomic rejection; its policy was not
weakened.

Logs: `/tmp/dc-glat-native-20260921-02.log`,
`/tmp/dc-glat-cent-source-20260921-01.log`,
`/tmp/dc-glat-opening-20260921-03.log`,
`/tmp/dc-glat-types-20260921-01.log`.

## Main Browser Handoff

The live browser state was not inspected or reset. Its warning remains
unexplained, not disproved. The next discriminating observation belongs to the
main/browser owner: at the failing call, compare the mission object and module
instance with those used by `registerNativeEffectMission()`, inspect whether
`sources.has("GLAT")`, and check whether disposal removed that registration.
A stale module registry after reload/HMR or a different mission identity would
explain the symptom, but neither is established by these tests. Do not change
admission rules or globally attach a mission palette to shared PNGs on that
assumption. Preserve the live state for inspection before reinitialization.