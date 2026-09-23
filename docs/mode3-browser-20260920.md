# Standalone Bounded Mode3 Browser QA

`tools/qa/fixtures/mode3-browser.ts` exports `createMode3BrowserFixture(mission?,
{ parent? })`. It is opt-in QA, not imported by the application. No runtime,
package, asset, simulation, or normal renderer changes are needed.

## Embedded Browser Handoff

On the existing Vite application origin, the integrator can run:

```js
const { loadCampaignMission } = await import("/src/game-data.ts");
const { createMode3BrowserFixture } = await import("/tools/qa/fixtures/mode3-browser.ts");
const mission = await loadCampaignMission("human");
const fixture = await createMode3BrowserFixture(mission);
fixture.initial;
fixture.render(false);
fixture.render(true);
// After screenshot and result inspection:
fixture.dispose();
```

Omitting `mission` invokes the same `loadCampaignMission("human")` loader.
Only original HUMAN01/DESERT is accepted. Mission data, triggers, production,
and resource properties are not stripped or replaced. The fixture constructs
an ordinary `MissionView` and loads `createMissionTerrain(mission)` separately,
passing its authenticated `.mode3` owner to `renderBoundedMode3`. It deliberately
does not call `initialize()`: that entry point renders/resizes the normal
512x452 canvas and depends on unrelated campaign presentation initialization.
Any constructor mission diagnostic remains visible in the report.

The overlay is `[data-qa="mode3-browser"]`, with `data-result="pass"` or
`"fail"` and `data-enabled`. Its sole canvas has a fixed backing size of
320x256, 81,920 pixels, with responsive CSS scaling only. DOM labels declare
the controlled scope, original terrain, initial illumination 128 and initial
enable=true. Nothing starts a simulation or animation loop.

## Source And Placement

The fixture verifies the published indexed manifest checksum and every loaded
VENT FIN, SPR metadata, index plane and coverage plane against its SHA256/size.
It loads VENT2, PUFF, GLIT and SMSP, validates every VENT timeline19 child field,
and retains all four original child references, offsets, flags, layers, modes
and frame numbers. No child is filtered out, rewritten or replaced with gray
art. The complete explicit queue uses source child indices 0,1,2,3.

Fixed camera `(480,192,320,256)` and SMSP queued baseline `(541,304)` match the
first unmirrored DESERT placement of the documented native probe. These are
declared controlled positions, **not original world admission or queue order**.
All source child bounds must fit. No oracle JSON, emulator or raw CD files are
loaded by the browser fixture.

`createMissionSpritePalettes` supplies the native palette/effect registration.
Its loaded atlas indices and coverage are checked against the independently
verified fixture descriptors. VENT2 uses its actual palette-remapped body
canvas. Effect fallbacks use the existing original PNG atlases, with checked
dimensions and registered indexed metadata; these PNG files are not claimed
to be authenticated by the indexed manifest. Native mode5 remains free to
report unsupported/ambiguous fallbacks, including the original GLIT child.
Warnings and diagnostic outlines are not suppressed in the browser.

## Results

Each `render(mode3enabled = true)` makes a disabled baseline call and a selected
gate call to actual `MissionView.renderBoundedMode3`. Each call reads exactly
one simulation snapshot and invokes capture once. Both begin with the same
explicit 128 illumination plane and composite all original bodies/effects.
Two QA-only full-canvas reads happen outside the instrumented calls and are
reported separately from the shared adapter budget.

Returned fields include:

- `native` and `baselineNative`: complete native prepass results, illumination,
  original terrain indices, final indexed/RGBA terrain plane and scene frame.
- `changedPixels`: disabled versus selected final Canvas RGBA pixels.
- `nativePlaneChangedPixels`: changed pre-body terrain RGB pixels.
- `visibleNativePositivePixels`: changed terrain pixels that still match their
  respective native terrain RGBA in **both** final body-composited canvases.
- `disabled` / `enabled`: per-pass snapshots, captures, actual source body
  `drawImage` calls, SMSP suppression, publication sequence, zero pre-terrain
  readbacks, mode5 results and charged readback pixels/remaining frame budget.
  `enabled` describes the selected pass even when `mode3enabled` is false.
- `checkpointUnchanged`, `simulationUnchanged`, `initialPlaneUnchanged` and
  manifest/source proofs. `baselineRgba` / `finalRgba` retain the captured bytes.

Enabled success requires positive surviving native pixels, the VENT2 body draw,
mode3 sprite suppression, one snapshot/capture per pass, terrain publication
first, zero mode3 readbacks, charged adapter reads and unchanged state.
Disabled success requires identical disabled results. Remaining mode5 fallbacks
and `orderingVerified: false` are retained, not reclassified as full-scene
success. The only exact scope is `bounded-terrain-prepass`.

`dispose()` releases view, palette registration/cache and terrain renderer,
zeros owned canvases and removes the overlay; repeated disposal is harmless.
Rendering after disposal throws.

## Focused Verification

```sh
node --import tsx --test tools/qa/mode3-browser.test.ts
```

Four focused contracts pass: unchanged complete source/native-fit bounds,
tampered-asset rejection, final-composition positive-pixel guards, and actual
`loadCampaignMission("human")` / MissionView with original indexed terrain.
The Node composition contract uses software Canvas, not browser proof: 334
native-positive pixels survive, state/initial plane remain unchanged, and the
disabled result resets exactly. The fixture itself uses actual Canvas2D.
At this controlled placement PUFF reports exact with zero readback pixels;
GLIT retains `mode5-effect-unverified:Unsupported native mode5 source`, also
before any readback. Accounting checks do not require unnecessary reads.

Browser-target bundling and strict focused TypeScript compilation are separate
gates. The embedded screenshot, actual PNG/Canvas visual result and browser
`initial.passed === true` still require the integrator's run. No browser was
opened, no agents were used, and no full suite was run for this handoff.

See [the bounded API](live-bounded-mode3-20260920.md) for native ownership and
budget limits. This fixture does not certify complete mission rendering,
native world queue admission, source startup light, or global sorted-body order.