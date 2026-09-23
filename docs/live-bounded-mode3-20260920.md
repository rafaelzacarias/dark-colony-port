# Live Bounded Mode3 Prepass

This is an explicit, render-only MissionView path, not automatic illumination
ownership for normal missions. Normal `MissionView.render()`, input projection,
simulation, animation scheduling and indexed WebGL rendering are unchanged.
The default 512x452 viewport exceeds the proved 128K-pixel bound and is not
silently tiled, cropped or camera-rounded into an exact claim.

## Live Call Path

1. `MissionView.renderBoundedMode3(input)` reads one simulation snapshot and
   invokes `input.capture(snapshot)` once. The caller supplies the complete
   bounded captured scene, unchanged FIN child references, native positions,
   explicit queue order, initial illumination plane and native enable gate.
2. `createMissionSceneFrame` derives queued positions from those captures before
   any terrain color is emitted. `stageMissionMode3Prepass` validates the whole
   captured queue and stages all mode3 children in supplied queue order, not FIN
   paint order or the ordered sprite dispatch. Missing/duplicate children,
   missing source indices and unsupported mode3 abort the candidate.
3. `MissionMode3Terrain.renderIllumination` obtains original source indices from
   the indexed BTS atlas and source MAP records. It composites source foreground
   coverage/reflections, applies native selector-specific even/odd/per-pixel
   filter sampling, then performs exactly `RMP[0][filter][terrainSourceIndex]`
   and GIF palette conversion. There is no palette inversion, RGB approximation,
   second daylight remap or remapping of already illuminated terrain.
4. `frame.drawMode3Terrain` publishes that bounded RGBA plane at Canvas (0,0).
   Only successful publication grants mode3 ordered-pass no-op entitlement.
   Failed publication leaves the original diagnostic/fallback draw available.
5. MissionView draws the captured bodies/effects through `frame.drawEntity`.
   Mode2/mode5 run after terrain and receive the shared remaining pixel budget.
   The global scene-order diagnostic remains: this does not certify full native
   world admission or sorted-body ordering.

The loaded indexed terrain exposes `.mode3`, using the already verified atlas,
palette and original RMP objects. It does not duplicate the loaded atlas.
`createMissionMode3Terrain(mission, indexed, atlas, palette, remap)` also permits
an explicitly supplied source owner for a controlled bounded fixture. Its
mission and indexed metadata identities must match the scene; supplied fixture
bytes are the caller's responsibility, not independently authenticated by this
factory.

The explicit view input is `MissionViewMode3Frame`: `surface`, `enabled`,
`queue`, `capture`, `sprite`, `image`, and optional `terrain` (otherwise the
loaded terrain owner). `sprite(body)` returns the unchanged indexed SPR frame
and its coverage; `image` resolves the subsequent ordinary/effect Canvas art.
Successful results identify their scope as `bounded-terrain-prepass` and return
the staged illumination, original terrain indices, indexed/RGBA output and
scene diagnostics. They are not a global-exact status for the complete scene.
Each invocation starts from the supplied initial plane without mutating it.
This entry point does not change the normal camera or resize the main canvas.
It is not called automatically by the normal render loop.

The opt-in [standalone browser QA fixture](mode3-browser-20260920.md) calls this
entry point with loaded original HUMAN01 indexed terrain, unchanged VENT19
children and a fixed 320x256 controlled native-probe viewport. It reports
disabled/enabled final Canvas differences, native-positive surviving pixels,
readback accounting and unchanged checkpoints. Browser screenshots remain an
integrator gate; the focused Node contract is not actual-browser proof.

## Bounds And Fallbacks

- Tile-aligned, nonnegative integer world origin; width multiple of32; at most
  128*1024 viewport pixels. Fractional origins, side/top clipping and unsupported
  source flags/layers/elevation reject explicitly. Bottom clipping retains the
  native exclusive final row. No rounded-camera entitlement is inferred from
  the normal renderer's camera helper.
- Explicit initialization is mandatory. Tests include filter bytes128/131/135
  and a disabled gate, but do not infer full mission DayNight, fog, startup-light
  or reset ownership. An externally initialized filter is consumed once.
- The bounded CPU publication performs zero Canvas readbacks. Its viewport
  pixel count is conservatively reserved from the same 128K frame allowance
  used by later mode2/mode5 readbacks, including charged failed reads.
  `frame.effectBudget` separates `mode3AllocatedPixels`, `readbackPixels` and
  `remainingPixels`. The pixel ceiling is not a total byte-allocation ceiling:
  detached byte planes, sampling offsets and RGBA output are separate buffers.
- Mode1 has no remaining-budget parameter in the current adapter. After a
  bounded mode3 publication it retains fallback with
  `mode1-shadow-shared-budget-unverified`, without an unaccounted readback.
  Its ordinary, non-mode3 path is unchanged. Unknown/ambiguous later effects
  retain their existing diagnostic fallbacks, not an invented gray glow.
- Captures are externally bounded/frozen, not an inferred complete live world.
  Queue membership/order, native admission and initial-light ownership remain
  explicit caller obligations. Unknown actors cannot be silently omitted and
  then presented as full-viewport mission parity.
- The illumination/terrain stage rejects before publication; this is not a
  rollback transaction over all subsequent Canvas body/effect draws. Canvas
  identity state and a caller-owned unclipped destination are required.

## Verification

### P2 Captured-Entity Completeness

The prepass now receives the complete captured `entities` list from the scene
owner instead of inferring completeness from flattened bodies. Every captured
FIN child, including mode0, must retain exactly one corresponding part with a
nonempty source frame and one body at its original child index. Missing parts,
frames or source-index/reference correspondence reject with
`mode3-prepass-unverified:Complete captured queue required` before sprite lookup,
filter staging or terrain publication. A finished sample does not exempt its
remaining children. Zero children with zero parts remains a valid empty capture.
These checks apply only to the bounded prepass; normal partial scene creation
and diagnostic sprite fallback remain unchanged.

The regression first reproduced the incorrect `exact: true` for one captured
mode3 child with `parts: []` and `queue: []`. It now verifies rejection without
sprite callbacks, Canvas publication, filter mutation or budget allocation;
also covered are all four VENT19 children without parts, missing mode0 parts or
frames, retained normal mode3 fallback, and empty unfinished/finished samples.
The prior eight integration tests plus this regression pass: **9 passed,
0 failed, 0 skipped**. Strict compilation with no-unused checks is clean.

- `/tmp/dc-mode3-missing-parts-integration-20260920-p3.log`
- `/tmp/dc-mode3-missing-parts-strict-20260920-p4.log`

No view/runtime, browser, package or asset changes; no agents or full suite.

### Original Handoff

Original integration tests:

- `mission-mode3-prepass.test.ts`: 2 tests for queue-order byte arithmetic and
  atomic late-source/queue/camera/budget rejection.
- `mission-mode3-terrain.test.ts`: 1 test comparing every source terrain index,
  output index and RGB pixel in all192 native variants across DESERT, JUNGLE,
  ATLANTIS and HTRAIN. This is a new terrain-source-index consumer proof, not
  just the existing post-terrain Canvas adapter comparison.
- `mission-mode3-live.test.ts`: 5 tests through actual MissionView using frozen
  original VENT timeline19, all four children, their original flags/offsets,
  and controlled native-probe positions. Child3 remains SMSP frame1 mode3.
  A deterministic software Canvas draws bodies/effects and leaves334 visibly
  changed native-positive terrain pixels. Tests assert one snapshot/capture,
  terrain-before-body publication, no mode3 sprite after success, unchanged
  simulation/checkpoint/input planes, multi-capture accumulation, per-frame
  reset, gate/filter semantics, failed-publication fallback and budget guards.
  A source TRSC mode1 capture verifies the bounded budget fallback as well.

Focused results: **38 passed, 0 failed, 0 skipped**: 8 new tests, 15 existing
mode3 native/Canvas tests (including all65,536 arithmetic pairs), 5 neighboring
scene tests and 10 existing terrain tests. Strict ES2022/ES2023-DOM compilation
with no-unused checks passed for the three touched production files and three
new tests.

Recorded logs:

- `/tmp/dc-mode3-live-regression-r1-20260920.log`: 28 passed.
- `/tmp/dc-mode3-live-terrain-regression-20260920.log`: 10 passed.
- `/tmp/dc-mode3-live-types-final-20260920.log`: clean.

Reproduce from the repository root using the existing native oracle, or omit
`DC_MODE3_TRACE` to regenerate it with the existing external Python libraries:

```sh
DC_MODE3_TRACE=/tmp/dc-mode3-prepass-20260920-b3.json node --import tsx --test \
  tools/qa/mission-mode3-prepass.test.ts tools/qa/mission-mode3-terrain.test.ts \
  tools/qa/mission-mode3-live.test.ts tools/qa/mission-scene-frame.test.ts \
  tools/qa/mode3-effect-native.test.ts tools/qa/mode3-canvas.test.ts \
  tools/qa/mission-terrain.test.ts
```

No browser/native OS window, agents, dependency/package changes, asset changes,
full suite or realtime performance certification. Main/browser QA remains with
the integrator. See [the native handoff](mode3-native-20260920.md) for original
`0x4621a0`, terrain blitter and 65,536-pair arithmetic evidence.