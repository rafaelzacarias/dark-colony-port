# Pure FIN animation integration

## Native Mission Composition

MissionView now uses all source FIN children. See
[composition evidence](../../docs/render-composition.md) for native addresses,
executed x86 probes, the supported subset and explicit fidelity gaps.
`finSourcePlacement` uses `child.x + anchorX`, `child.y - height` for normal
children; mirrored children use `child.x + 1` and reversed pixels. Native body
blitters ignore anchorY. No per-unit origin calibration is required.
`composeFinSample`, `createFinSourceSampler`, `drawFinComposition` and
`createAtlasCache` are exported alongside the generic selector API below.

The mission frame adapter also attempts bounded native mode-1 shadow/body and
mode-5 effects automatically. See [mode-5 evidence and gates](../../docs/phase4-mode5-effect-20260919.md)
for the exact bank-1 blend, mission-keyed source registration, atomic Canvas
fallback and unresolved mirrored/global-order paths.

Import the public API from `src/render/index.ts`. This module has no DOM, clock,
asset loading, engine mutation, or per-unit state. JSON arrays can be passed
directly; the types are structural subsets of the generated metadata. Treat
source objects as immutable and rebuild selectors/lookups when assets change.

## API

- `createFinSelector(animation, { prefix, directions, layerOrder, families? })`
  precomputes state selection and stable child ordering. `prefix` is the FIN
  state prefix, not necessarily an atlas name (for example BEEK versus BEAC).
- `selector.select(action, direction): FinSelection | undefined`, with actions
  `Stand | Move | Attack | Die` and compass directions `N | NE | E | SE | S | SW | W | NW`.
  The result exposes `state`, selected `action`, selected `direction` (null for
  an undirected state), and `fallback`.
- `selector.sample(selection, elapsedTicks, framesPerSecond, ticksPerSecond)`
  returns `{ timelineIndex, finished, children }`. Pass a selection from that
  same selector. Time is relative to state entry, not the global simulation tick.
  Fractional ticks support interpolation. Negative elapsed time clamps to zero;
  nonfinite time or nonpositive rates throw. Die clamps to its final timeline
  entry, including an empty final entry. `finished` becomes true after that
  final entry has lasted one frame. Other actions loop.
- `directionFromMotion(dx, dy, stationaryDirection)` quantizes a vector in
  screen/map axes (+X right, +Y down). Magnitude/units do not matter. Zero motion
  retains the supplied facing. Sector-boundary ties go clockwise. For attacks,
  supply target-minus-unit position instead of zero movement.
- `createFinFrameLookup(atlases)` indexes case-insensitive sprite names and
  explicit frame `index` IDs, never atlas-array position.
- `finChildPlacements(sample, lookup, place)` returns ordered
  `{ child, frame, x, y }` entries. Missing, empty, and zero-sized frames are
  skipped without shortening the timeline or carrying previous children forward.
- `finCanvasPlacement(origin, anchorMode)` creates an optional placement adapter:
  `child offset + sign * frame anchor - origin`, in source pixels. Modes are
  `add`, `subtract`, or `ignore`; a custom `(child, frame) => ({ x, y })` is also valid.
- `worldYSubcells(y, "cells" | "subcells")` normalizes depth using 1024 subcells
  per cell. Apply the same world reference point to static and moving objects.

## Selection rules

Default families are STAND; MOVE; FIREA/FIREB/FIRE/ATTACK; and
DIEA/DIEB/DIEC/DIE2/DIE. Matching is exact and case-insensitive, including the
prefix and direction suffix. No `startsWith` ambiguity or invented frame ranges.
An exact direction wins across families; family order breaks ties. Otherwise
the nearest available compass direction wins (clockwise on equal distance),
then an undirected state. Move and Attack may fall back to Stand. Die never
falls back to a living pose. Missing/invalid states return undefined.
Override the full `families` record for another unit or a chosen attack/death
variant; no automatic blending, mirroring, variant randomization, or SHUF/ANT
transition playback is performed.

## Source evidence and limits

The QA test decodes both raw FIN files and compares all states/timeline entries
against generated JSON. These are verified source labels and frame references:

| Standing timeline/frame ID | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TRSC and GRAY STAND suffix | 0 | 14 | 12 | 10 | 8 | 6 | 4 | 2 |
| Visual interpretation | S | SE | E | NE | N | NW | W | SW |

Evidence: [TRSC states](../../public/assets/generated/animations/TRSC.json#L15),
[TRSC timeline](../../public/assets/generated/animations/TRSC.json#L479),
[GRAY states](../../public/assets/generated/animations/GRAY.json#L16),
[GRAY timeline](../../public/assets/generated/animations/GRAY.json#L516), and
the first eight frames in the [TRSC atlas](../../public/assets/generated/sprites/SPRITES/TRSC.png)
and [GRAY atlas](../../public/assets/generated/sprites/SPRITES/GRAY.png).
Embedded-browser inspection of the face/back and weapon orientation confirms
the visual compass row: suffix 12 faces right and suffix 4 faces left. This
corrects the previous horizontally reversed east/west and diagonal mapping.
`TRSC_GRAY_VISUAL_DIRECTIONS` exports that interpretation, but it is not an
executable-derived facing convention. `directions` is therefore required, with
no silent default. Tests prove the label/frame mapping and adapter behavior,
not the compass interpretation. Do not apply this table to other FINs unverified.

Both units have eight FIREA directions. Death directions are sparse diagonals,
so cardinal deaths require fallback. GRAY really spells one state `GRAYDIE210`;
the DIE2 family preserves it rather than silently correcting its name. TRSC
MOVE0 contains eight entries; GRAY MOVE0 contains seven. Inclusive source ranges
must be preserved rather than assuming a constant eight-frame animation.

The [FIN decoder](../../tools/extractors/animations/fin.ts#L81) reads child frame
IDs as unsigned 16-bit and x/y/layer as signed 16-bit values. Sprite metadata
exposes anchors, but neither decoder proves their world-space interpretation:

| First standing child | FIN x/y | SPR anchor x/y | Width/height |
| --- | --- | --- | --- |
| TRSC frame 0 | -159, 4 | 147, 99 | 28, 45 |
| GRAY frame 0 | -32, 5 | 21, 11 | 22, 38 |

Subsequent native tracing resolves the origin: normal X adds anchorX and Y
subtracts frame height, ignoring anchorY. Standing placements are TRSC (-12, -41)
and GRAY (-11, -33). Use `finSourcePlacement`, not per-animation calibration.
`finCanvasPlacement` remains a generic explicit adapter. Native layer priority
is encoded, not simple ascending/descending; `composeFinSample` applies it
within an entity. The evidence document records global-sort limitations.

Engine time is 20 TPS, not proof of a FIN frame rate. Generic `selector.sample`
still requires FPS. `createFinSourceSampler` consumes animation-update counts
using the executable-derived field2 duration conversion. MissionView maps ticks
to updates provisionally and emits a timing diagnostic. Events are not executed;
unsupported modes remain visible with diagnostics. The shared loader now loads
all referenced child atlases, not just the unit atlas.

## Generic Adapter Example (Not the Native Mission Path)

`animation`, `atlases`, and `images` are loaded by the owner. `adapter` must
provide an explicit layer order, anchor mode, calibrated origin, and chosen FPS;
none of those are inferred from simulation TPS. `action` is the owner's
`FinAction` mapping (idle -> Stand, move -> Move, attack -> Attack, dead -> Die).

```ts
import {
  createFinSelector, createFinFrameLookup, directionFromMotion,
  finChildPlacements, finCanvasPlacement, TRSC_GRAY_VISUAL_DIRECTIONS,
  worldYSubcells,
} from "./render";

const selector = createFinSelector(animation, {
  prefix: sprite,
  directions: TRSC_GRAY_VISUAL_DIRECTIONS,
  layerOrder: adapter.layerOrder,
});
const lookup = createFinFrameLookup(atlases);
const place = finCanvasPlacement(adapter.origin, adapter.anchorMode);

const facing = directionFromMotion(dxSubcells, dySubcells, lastFacing);
const selection = selector.select(action, facing);
if (selection) {
  const sample = selector.sample(selection, elapsedStateTicks, adapter.fps, 20);
  for (const { child, frame, x, y } of finChildPlacements(sample, lookup, place)) {
    context.drawImage(images[child.sprite.toUpperCase()],
      frame.x, frame.y, frame.width, frame.height,
      screenX + x * scale, screenY + y * scale,
      frame.width * scale, frame.height * scale);
  }
}

const staticDepth = worldYSubcells(entity.y + 0.5, "cells");
const unitDepth = worldYSubcells(interpolatedYSubcells, "subcells");
```

Cache selector/lookup/placement adapter per asset, outside drawing. Retain facing
per unit and reset elapsed time on action/state entry; restart Attack on a new
attack event if needed. Preserve death visuals after the engine removes a unit,
and retire them according to owner policy. Use the two depth values as the
same sortable key; atlas top-left, FIN layer, and local child y are not world
depth. MissionView now uses `composeFinSample` and `drawFinComposition`; this
example is only for callers deliberately choosing a custom placement adapter.

## Verification

Run `node --import tsx --test tools/qa/render-animation.test.ts` and
`npm run typecheck`. The source evidence tests require the local raw FIN files
and generated JSON assets. Synthetic tests cover missing assets/states without
requiring a DOM or browser.