# Original Mode3 Illumination Owner

Follow-up: [Live bounded integration](live-bounded-mode3-20260920.md) now provides
an explicit MissionView pre-terrain path and original-index terrain consumer.
Normal missions still retain their existing mode3 diagnostics; this isolated
handoff below describes the original primitive proof, not full-world ownership.

Isolated implementation and handoff. No shared renderer, MissionView, loader,
package, generated asset, or browser changes. This is not full-scene integration,
queue ordering certification, or a realtime/60 FPS claim.

## Native Behavior

Original `raw_cd/DC/DC.EXE` SHA256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

- `0x454664[3]` points to `0x454c22`, the ordered-pass continuation. Testing
  that dispatch alone incorrectly suggests mode3 does nothing.
- The preceding loop at `0x4546d7` detects queue mode3 at `0x4546ea` and calls
  `0x4621a0` at `0x454701`. Mode3 is excluded from the later sorted list.
- `0x4621a0` checks byte `0x4e686c`. It writes the illumination/filter plane
  at `view+0x1c`, not the framebuffer at `view+8`. It does not read RMP.
- Placement uses the normal SPR anchor, irrespective of queue orientation.
  There is no mode3 mirror branch. `valueB=1` is a labeled controlled case,
  not a claim that VENT's source child is mirrored.
- The source RLE writer is `0x460709`. Its literal run calls the original
  additive table at `0x45d7c0`; one-pixel entry `0x45c5dd` adds source to
  illumination, ORs `0xf8` on carry, then ANDs `0xfc`. In byte arithmetic:
  `((source + filter > 255 ? (source + filter) | 0xf8 : source + filter) & 0xfc)`.
  This is not ordinary clamping: carry can produce either 248 or 252.
- Source coverage controls literal versus skipped runs, including covered
  index zero. Terrain cutoff/mask setup executes, but both branches select
  the same additive writer, which does not consume mask bits. A masked
  foreground pixel therefore does not suppress mode3 illumination.
- The terrain consumer `0x45038c` obtains the filter pointer through
  `0x453b44` and dispatches the original terrain blitters. Output is
  `RMP[bank0][sampledFilter][unlitTerrainIndex]`, then the terrain GIF palette.
  It is neither mode2's fixed row72 shadow nor mode5's bank1 blend.
- Foreground selector0 samples the even illumination byte for each horizontal
  pair; selector3 samples the odd byte. Selectors1/2 sample each pixel.
  Background-only blitters sample even bytes, including reflected background.
  Illumination is not a direct source-palette RGB sprite overlay.

## Source And Evidence

The unmodified positive is VENT FIN timeline19, child3:
`SMSP`, frame1, x=-60, y=14, layer1, flags16, mode3, orientation0.
Its other children remain mode5 PUFF, mode0 VENT2, and mode5 GLIT. No asset
was relabeled to manufacture a mode3 positive. VENT FIN SHA256:
`9f43206aba24f71a4a0cb7df841e09ebde2a243dc20310cd34644fed2c3ea84a`.

[Native probe](../tools/research/mode3-effect-20260920.py) executes original
x86 in Unicorn with zero runtime/rendering replacements and no OS window.
Python installs inputs and reads outputs; it does not calculate the rendered
oracle. The prepass and original terrain blitters produce the filter plane
and framebuffer. The sorted mode3 no-op is checked separately.

The bounded fixture installs the unchanged compressed SPR and relocated queue
record. It does not claim full FIN admission, world visibility, startup light
initialization, all original scheduler phases, or the whole `0x45038c` caller.
Its terrain consumer calls the real per-tile blitters with the source MAP/BTS
selectors, source pixels, and source masks. Initial illumination128 is an
explicit fixture input, not inferred original mission startup state.

Evidence axes:

- DESERT, JUNGLE, ATLANTIS, HTRAIN GIF/RMP pairs, with original DESERT BTS and
  HUMAN01 MAP geometry. All source file digests are checked independently.
- Source orientation0 and controlled orientation1; reflected/unreflected
  foreground, two baseline phases, and two native terrain-height placements.
- Full height, actual bottom clipping, and disabled native mode3 gate.
- 64 placements, each with three complete 320x256 framebuffer/filter outputs.
  Every indexed pixel is compared, including unchanged regions outside the
  clipped viewport. Canvas RGB and filter state are compared for every variant.
- All 65,536 source/filter byte pairs execute the original additive run writer,
  including carry and quantization boundaries. This is arithmetic coverage,
  not an arbitrary framebuffer count target.

Native snapshot: `/tmp/dc-mode3-prepass-20260920-b3.json`.
Focused comparison: `/tmp/dc-mode3-native-canvas-20260920-e1.log`, 15 passed,
zero failures/skips. Strict ES2022/ES2023-DOM/no-unused check:
`/tmp/dc-mode3-types-20260920-f2.log`, clean.

## API

[Primitive owner](../src/render/mode3-effect.ts):

- `nativeMode3Filter(sourceIndex, filter)` implements the proved byte operation.
- `composeNativeMode3({part, position, sprite, terrain})` returns covered source
  pixels and normal-anchor bounds. `position` is the native queued position,
  already including child offsets. SPR `coverage`, not a zero-index heuristic,
  controls holes. The existing unmasked span helper is reused internally;
  its normalized `body` is placement metadata, not an ordinary sprite to draw.
- `stageNativeMode3Filters(surface, plan, enabled)` returns a detached candidate
  illumination plane without changing input. `enabled` corresponds to the
  externally owned native gate; no gate/startup state is guessed.
- `nativeMode3FilterOffsets(surface, terrain)` supplies selector-specific
  illumination sampling indices for the native terrain consumer.
- `drawNativeMode3Indexed({surface, filters, terrainIndices, plan, remap, enabled})`
  stages all validation and writes, then commits output and filters together.
  `terrainIndices` must be unlit terrain indices, not the previously remapped
  framebuffer. Keep an immutable original plane for subsequent draws.

[Canvas adapter](../src/render/mode3-canvas.ts):

```ts
const dispose = registerNativeMode3Mission(mission, { sources, palette, remap });
const result = drawNativeMode3Canvas({
  context, mission, image, part, position, terrain,
  filters, terrainIndices, enabled, pixelBudget: remainingReadbackPixels,
});
```

`filters` is an explicit `NativeIndexedSurface`: x/y are the world viewport
origin, width/height its dimensions, and indices the current illumination.
The Canvas region starts at (0,0) and represents that same viewport.

The mission registration reuses the caller's indexed sprite map and palette
objects. Alternatively, pass an image already registered through existing
`registerNativePaletteImage`; the adapter reads `nativePaletteImage` metadata.
No image decoding/readback is used to recover SPR indices. Disposal is
identity-safe and does not remove a newer registration.

Prefer explicit `terrainIndices`. The adapter checks current destination RGB
against the old filter/terrain/palette combination before replacing it. Without
that plane it considers every unlit index mapping to the observed RGB under
the old filter; it rejects aliases unless every candidate produces identical
output RGB. It never picks an arbitrary reverse-palette match.

Only affected output pixels are changed, including pair-sampled neighbors
outside the source coverage. The read rectangle preserves its other pixels.
Filter writes invisible to the current terrain sampling still commit correctly.
There is at most one readback and one writeback per call. The caller supplies
the remaining budget; results report `readbackPixels` even after failed reads.
An unsuccessful result has `exact:false` and a `mode3-effect-*` diagnostic,
leaving both Canvas RGB and filter bytes untouched for whole-part fallback.
The adapter does not itself draw fallback art or clear shared diagnostics.

## Bounds And Handoff

Supported input is flags16, layers0/1, mode3, orientation0/1 (orientation is
ignored by this native pass), zero elevation, validated source frames up to
352x240. Only the source layer1 normal child is an unmodified VENT positive.

The current bounded surface is tile-aligned in x/y, a multiple of32 in width,
at most8192 per dimension and at most128*1024 pixels. Readback has a separate
caller-adjustable ceiling of128*1024 pixels. Bottom clipping preserves the
native exclusive last row. Top/side clipping, elevated children, other flags,
other layers/orientations, transformed Canvas, fractional/global alpha,
non-source-over blending, Canvas filters/shadows, unknown/translucent or
ambiguous destination pixels, missing indexed metadata, and insufficient
budgets remain explicit rejection paths.

Main integration must own the illumination plane and its native initialization,
apply mode3 in the pre-terrain phase, then render terrain from unlit indices,
then run the ordered sprite/effect passes. Do not append this adapter after
arbitrary sprites or mode5 effects on an already composited scene. A matching
RGB alone cannot establish scene-phase ownership. Multiple mode3 calls must
share committed illumination and the original unlit terrain plane; the byte
operation is not generally commutative. Full queue order, reset schedule,
fog/light ownership, larger viewport tiling, cumulative scene readback budget,
and whole-frame rollback remain the integrator's responsibility.

The present MissionView mode3 diagnostic is deliberately unchanged until that
handoff. No browser, full suite, package install, asset rewrite, subagent, or
shared renderer/view edit was performed.

## Reproduce

From the repository root, using the existing external native libraries:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/research/mode3-effect-20260920.py > /tmp/dc-mode3-fresh.json
DC_MODE3_TRACE=/tmp/dc-mode3-fresh.json node --import tsx --test \
  tools/qa/mode3-effect-native.test.ts tools/qa/mode3-canvas.test.ts
```

Omit `DC_MODE3_TRACE` to regenerate the native oracle from the test process.
No generated trace is checked into assets or required as a runtime dependency.