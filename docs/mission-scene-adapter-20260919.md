# Mission Scene Adapter: Render-Owned Handoff

## Phase 4 Mirrored Body Increment

The renderer now accepts consistent `valueB=1` horizontal mirrors for normal
flags-16/mode-0 bodies. Original TRSC timeline 276 / frame 135 is verified in
eight native framebuffers and eight integer-camera crops; the unchanged live
consumer reaches the clipped branch and retains its palette/team image lookup.
Mode 1 remains whole-part diagnostic fallback; global order remains blocked.
See [evidence and limits](phase4-mirrored-body-20260919.md), including the native
physical backing-buffer edge discrepancy and controlled live test scope.

## Final Browser Follow-Up

MissionView now invokes the adapter for matching native slot/generation, zero
host height and integer current-frame ground positions. Interpolated movement,
portraits, resource-host animation and carriers retain their separate paths.
Global sorting is not enabled; unsupported FIN modes keep diagnostic fallback.
The source-identity cache updates on committed frames and checkpoint restore.

Real embedded Canvas2D/WebGL checks passed normal ALIEN01 startup through 220
deterministic updates, then an isolated original TRSC timeline-254 fixture:
one clip, 37 rectangles, 41,222 nonblack pixels and indexed terrain ready.
The fixture substituted the selected animation state and visibility ownership
only to exercise this branch; it is not a campaign visual baseline or proof of
pixel removal at that placement. Native framebuffer tests separately validate
mask semantics. Fetch overrides and renderers were cleaned up. Final gate:
966 tests passed, four skipped, typecheck/build passed.

2026-09-19. Initial adapter handoff: the bounded mask adapter was ready; **the
live view hook was not enabled by that change**. See the live-consumer follow-up
below for the subsequently integrated hook. No edits to `src/mission-view.ts`, engine, assets,
or game data. No agents, browser, or full suite. Global source queue provenance
is still incomplete, and the adapter never enables global sorting.

## Independent Operations

- [createMissionSceneFrame](../src/render/mission-scene-frame.ts) accepts actual
  raw slots, captured Q10 positions, the original FIN sample, and its composition
  parts. It needs no synthetic IDs or submission words to compute masks.
- `frame.drawEntity(context, rawSlot, imageLookup)` draws in the supplied part
  order. Call it in the existing entity order. Normal bodies use the native
  origin and clipped spans; unsupported parts use the unchanged fallback origin.
  The palette/team image lookup is passed through unchanged. Alpha/composite
  state, selection, health, fog, portraits and carriers are not replaced.
- [composeSceneBodyMasks](../src/render/scene-composition.ts) does not sort,
  inspect queue keys, or require a complete frame. Mixed effects, shadows, ties,
  or unknown queue contributors therefore do not disable a supported body's
  cutoff. This improves terrain occlusion, **not entity-order parity**.
- Optional `ordinaryPrimary` derives primary submission words only from explicit
  admission, effect-gate and accepted-count inputs. Omit it in the live handoff
  until those fields are available. Returned `submissions` are in raw-slot then
  source-child order, not painter order. `globalOrder` is always null and
  `orderingVerified` is always false.

For admitted ordinary primary lists, the word is `(unsignedYQ8 & ~7) - accepted`
with dword wrap. `accepted` counts accepted children since this entity's reset,
not the source index after FIN sorting/filtering. The signed source mode filter
at `0x43995e` skips modes >=3 when the primary effect gate is off. Queue capacity
800 returns before counter decrement. Missing/empty published source headers
invalidate the entire entity's primary-word result rather than inventing ranks.
Actual transparent/invalid-header native admission is not inferred from atlas
filtering. The supplied sample must be the complete selected primary list.

## Raw Terrain And Camera

The loaded [MissionTerrain](../src/render/mission-terrain.ts) exposes
`indexed.sourceForegroundCoverage[recordIndex]`: exactly 32 uint32 source rows,
bit 31 leftmost. `withMissionTerrainCoverage(metadata, indices)` builds them from
raw palette indices, before RGB, remap, light, fog or compositing. It does not
reuse the published JSON's `foregroundCoverage` texture descriptor. Index-zero
holes and resolved foreground record zero remain distinct. The mask planner
applies attribute `0x40` reflection; background `0x20` does not reflect coverage.

`missionSceneCamera(cameraX, cameraY, mapHeight)` uses the same rounded integer
origin as the terrain renderer, with MAP-source-row Y down. Q10 converts using
`Math.round(subcells / 4)` before signed-word FIN offsets and the native
`(mapHeightQ8 - childYQ8 - 1) >> 3` projection. The adapter accepts integer Q10
captures, not fractional interpolation samples. Its sparse terrain lookup covers
the entire sprite and baseline, including cells outside the viewport; it does
not rebuild the whole MAP for a one-entity call.

Masks support flags 16, mode 0, mirror value 0/1, zero elevation, layer low byte 0/1/2,
and the existing 352x240 bounded frame contract. Layer 2 bypasses the mask.
`clips === null` is explicit fallback; `[]` is fully clipped. Negative **screen**
left/top and half-open viewport clipping are supported. Negative **map** origins,
out-of-map baseline cells, fractional scaling/camera rasterization, and raw
unaligned native backing-view fields remain outside this proof.

## Native Evidence

[Probe](../tools/research/mission-scene-frame-20260919.py),
[source comparison](../tools/qa/mission-scene-native.test.ts),
[adapter tests](../tools/qa/mission-scene-frame.test.ts).
DC.EXE SHA-256: `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

The original ordinary path executes from `0x439b6d` through admission, primary
bank validation, reset and submission to `0x439b54`, with **zero runtime hooks**.
Fourteen controlled cases exercise status, type-37 gate, unseen/reveal,
concealment/ownership/detection, exclusive bounds, completed/one-shot/looping
banks, and capacity 799/800. Primary FIN/SPR data is original TRSC; auxiliary
banks are explicitly inactive. These are complete executions of this bounded
ordinary path, not complete mission/city/auxiliary admission. Inputs other than
source animation data are controlled native-memory fixtures.

`missionOrdinarySceneAdmission` matches those native decisions and bank-state
results without mutating caller state. The test also feeds each decision into
the adapter and compares its actual queued coordinates and submission words.
Existing [queue provenance tests](../tools/qa/scene-queue-provenance.test.ts)
retain the independent all-800 raw-slot traversal, subsequent column-major
map-object visitation and original multi-child FIN/counter evidence. Visitation
does not prove that those other callers have complete live admission data.

Raster evidence uses original TRSC FIN timeline **254**, SPR frame **156**,
flags 16 / mode 0 / layer 1 / unmirrored, with its original offsets and anchors.
The common TRSC mode-1 timelines are **not relabeled as mode 0** and still fall
back. Source HUMAN01 MAP attributes and DESERT BTS indices are decoded
independently; every published source-coverage row is checked against BTS.

Four complete **192x192** terrain-plus-body framebuffers match original native
terrain blitters and masked body writer `0x461170`, including every untouched
pixel. Both reflected and unreflected source terrain are exercised, at nonzero
tile-aligned backing-camera offsets, and with direct native body top-left
**(-5, -6)**. Each fixture differs from a native mask-bypass render, so the test
requires actual occlusion. Four **32x32** non-tile-aligned integer-camera crops
also match exactly, testing negative sprite origins and all viewport sides.
These crop tests compare an integer viewport into a native backing framebuffer;
they do not assert arbitrary unaligned native view fields or native physical
right/bottom buffer-edge writer semantics.

## Smallest View-Owner Change

Keep the current passes and drawable order. At the existing `#drawVisual`
boundary, retain the sampled `sample`, `parts` and exact image-lookup closure.
Thread one optional `sceneEntity` capture from the current frame through
`#drawUnit`/static draws. It contains only
`{ rawSlot, xSubcells, ySubcells, heightSubcells }`.

Readiness requirements:

1. Obtain `rawSlot` from the existing `#simulationBindings.get(unitId).slot`;
   verify the binding's generation against the captured host entity. Do not use
   `unitId`, an array index, sorting rank, or a generated string as a slot.
2. Use the same frame's captured native/host-aligned Q10 coordinates and actual
   height. Do not read another simulation snapshot or invert rounded screen
   coordinates. Pass zero height only when the source record establishes zero.
3. Preserve original `sample.children` references in `parts`; do not resample,
   rebuild, or infer source ordinals from the sorted parts array.
4. Require ready indexed terrain with `sourceForegroundCoverage`, scale 1,
   integer coordinates and the integer camera helper. Missing readiness keeps
   the existing draw and diagnostic, not fabricated queue/position data.

The body draw replacement, once that capture is threaded, is:

```ts
const frame = createMissionSceneFrame({
  mission: this.mission,
  indexed: this.#indexedTerrain.indexed,
  camera: missionSceneCamera(this.#cameraX, this.#cameraY, this.grid.height),
  entities: [{
    ...sceneEntity,
    sample,
    parts,
    fallbackOrigin: { x: screenX, y: screenY },
  }],
});
for (const diagnostic of frame.diagnostics) reportRenderDiagnostic(diagnostic);
frame.drawEntity(context, sceneEntity.rawSlot, imageLookup);
```

Import both helpers from `./render/mission-scene-frame`. The only draw call is
`frame.drawEntity`; the existing `drawFinComposition` remains the not-ready
fallback. No global drawable collection rewrite is necessary for this mask-only
integration. Multiple captured entities may also share one frame adapter.
Do not gate this draw on `orderingVerified`, since that deliberately remains
false; do not suppress the existing cross-entity ordering warning.

## Exact Missing Queue Fields

The view's host visibility admission alone is not native source admission. To
derive ordinary primary words, supply the native status `entity+0x2c`, type
`+6`, team `+7`, viewer team, type-37 viewer gate `game+team*0xe30+0xbe4`,
native tile visibility dword and viewer mask `+0x19c0`, type detection gate
`0x4f18e8+type*280`, detected-team byte `entity+0xca`, reveal override, native
half-open cull bounds, direction-selected primary bank pointer `+0x14`, bank
frame `+0x18`, mode `+0x1a`, loaded timeline count and normalized selected sample.
The pure admission helper consumes these decoded values; it does not reconstruct
them from host IDs, fog, or approximate animation time.

Also missing for a complete scene: actual accepted count immediately before
each primary list; primary effect gate; source-valid headers for filtered atlas
entries; both auxiliary banks (`entity+0x1c` and `+0x24`) and their state/offsets;
low-slot city visibility/remembered types, offsets and special Y-minus-0x108
reset; column-major map-object admissions and their reset words; effect queues;
and native equal-key sort stability. Raw-slot traversal and map-column-major
visitation are known, but cannot substitute for these contributions. Shadows,
mode-3 pre-terrain effects, modes 2/4/5, unverified mirror values and elevated carriers remain
explicit render fallback. No complete source queue provenance is claimed.

## Focused Verification

```sh
node --import tsx --test tools/qa/mission-terrain.test.ts tools/qa/scene-composition.test.ts tools/qa/scene-queue-provenance.test.ts tools/qa/mission-scene-frame.test.ts tools/qa/mission-scene-native.test.ts
```

Native dependencies use the existing `/tmp/dc-re-capstone-20260918` and
`/tmp/dc-trigger-unicorn-20260918` installations; missing dependencies fail.
The touched adapter/tests also pass a strict scoped TypeScript check.
No browser/live render, full application suite, or campaign acceptance is claimed.

## Live Consumer Follow-Up

[live-terrain-mask.test.ts](../tools/qa/live-terrain-mask.test.ts) now executes
the already-integrated public `MissionView.initialize()`, `setCameraCenter()`
and `render()` paths. This follow-up changes only that new test and this document;
it does not change the view, scene adapter, renderer, engine or assets.

The fixture uses original ALIEN01 SCN/MAP/MTG/PTH and GAMESTAT/WEAPSTAT, published
map record indices, and the real indexed terrain loader, hash validation, palette
initialization, tile cache and WebGL renderer. A strict fake WebGL2 context records
uploads/submissions but does not execute shaders. Canvas2D records actual
`rect`, `clip`, `translate` and `drawImage` calls. Image load events are simulated;
no decoded image pixels or production image lookups are patched. The real sprite
palette code creates the canvas images used by both mode 0 and mode 1.

Setup is deliberately bounded: triggers/messages are empty, and `isOwnedUnit`
admits the selected enemy TRSC for rendering. Original actor slot **153**,
generation **0**, and current Q10 position **[50688, 74240]** are retained. The
camera is centered on that actor. The default case keeps the original FIN state
selection and timeline **0**, mode **1**. The supported case overrides only the
fetched TRSC `TRSCSTAND0` range to **254..254**. This is an explicit FIN selection
fixture, not a claim that an unmodified attack/tick naturally reaches timeline
254. Its children, offsets, flags, mode, layer and mirror fields remain original.
Both selected timeline entries are compared directly with raw TRSC.FIN; SPR frame
dimensions/anchors are compared with raw TRSC.SPR, and every source coverage row
is independently checked against DESERT.BTS indices.

The measured call boundary requires:

- `terrainRendererStatus === "indexed-webgl2"` before and after the render,
  actual indexed upload/draw calls, and no terrain fallback warning.
- Exactly **one simulation snapshot read per measured render**, without changing
  the returned snapshot, source bindings, positions or animation internals.
- Default mode 1: **zero clips**, original SPR crop and unchanged fallback origin.
- Original timeline 254 / SPR frame 156: **one clip and 37 rectangles**, exactly
  matching the source-backed adapter plan at the actor's current position and
  integer camera. The clipped draw uses the original crop and native origin.
- Palette-canvas image selection, balanced save/restore, health overlays after
  the body clip is restored, and the existing global-order warning are retained.

At this original placement the 37 spans cover all **1554** body pixels. Thus the
test proves the live mask call and its exact geometry, **not terrain removal of
pixels in this fixture**. Actual occlusion and native framebuffer parity remain
the separate bounded evidence described above. This is a real MissionView
consumer regression with fake graphics devices, not browser/GPU execution,
full-game native fidelity, complete source admission, or verified global sorting.
The older scene-live-frame test's unavailable-WebGL fallback is not used as proof
of the ready indexed branch.

Focused commands (no browser, agents or full suite):

```sh
node --import tsx --test tools/qa/live-terrain-mask.test.ts
npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable --types node --allowImportingTsExtensions tools/qa/live-terrain-mask.test.ts
```

Observed follow-up result: the focused test passes. Strict compilation of its
import graph is blocked by TS2339 at
[simulation.ts:620](../src/engine/simulation.ts#L620): property `3` does not exist
on `{ 1: number; 10: number; 12: number; 13: number; }`. That engine file is outside
this follow-up's ownership and was not changed; compilation is not claimed green.