# Native Scene Occlusion: Bounded Gate

Follow-up: [render-owned mission adapter](mission-scene-adapter-20260919.md)
now separates masks from ordering, exposes raw terrain coverage, and verifies
original TRSC/source-terrain camera crops and negative screen edges. Its live
view hook remains for the view owner; global queue provenance is still incomplete.

2026-09-19. Implemented in [scene-composition.ts](../src/render/scene-composition.ts).
**Not live parity or Phase 4 acceptance.** The follow-up
[queue provenance report](scene-queue-provenance-20260919.md) proves the ordinary
counter seed and raw-slot traversal but leaves live scene integration blocked.
MissionView now shares one render snapshot with visibility; its scene drawing
is unchanged. Main, generated assets, and the FIN composition public API were
not changed. No browser, agents, asset generation, or full suite was used.

## Executable Evidence

DC.EXE SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The [probe](../tools/research/scene-occlusion-20260919.py) maps the original
PE sections and executes unmodified x86 under Unicorn. Synthetic inputs
isolate the rules; these are not original-game screenshots or campaign captures.
The normal-body routine and its mask/RLE writers run without interception.

| Address | Established behavior |
| --- | --- |
| `0x43604e..0x43608d` | Queue X = signed-word `(xEighth >> 3)`; Y = signed-word `((mapHeightEighth - yEighth - 1) >> 3)`; height offset = signed-word `-(heightEighth >> 3)`. Arithmetic shifts, not rounding or truncation toward zero. |
| `0x4360cc..0x4360de` | Queue dword +8 receives global submission word `0x4e685c`, then the counter decrements. Follow-up execution proves ordinary reset from unsigned entity Y Q8 with low three bits cleared; it is not an entity ordinal. |
| `0x454590..0x454662` | Comparator described below; no SPR anchor, sprite height, or queue Y in its key. |
| `0x454825..0x45483b` | Calls original sort `0x440933` over queue pointers using that comparator. |
| `0x4546ea..0x454728` | Mode 3 prepass precedes terrain call `0x45038c`; mode 3 is excluded from the later main queue. |
| `0x45487d..0x4548a6` | Occlusion bypass is set for layer byte exactly 2, or nonzero queue height word +18. Not all even layers. |
| `0x461090..0x46116b` | Reads source-row MAP cells at the sprite baseline, starting at the anchored left tile column. Camera/view offsets participate; this plan uses map-pixel coordinates, zero view origin. |
| `0x461120..0x461157` | Per-column signed-word cutoff = `height + 31 - (baselineY & 31) - 32*nibble`. |
| `0x46146c..0x4614ce` | Supplies each column's cutoff and screen-space foreground mask to normal masked sprite writer `0x45febb`. |
| `0x460030..0x46006e`, `0x460120` | Negative cutoff selects masked literals; otherwise ordinary literals. Decrements cutoff after each row. Therefore row **equal** to cutoff is still unmasked. |

### Global Child Ordering

For each queue child, with layer low byte `layer`:

```text
priority = layer odd ? ((layer >> 1) + 1) * 3000 : -(layer >> 1) * 3000
key = int32(((priority + submissionWord) << 16) + signedQueueX)
compare(left, right) = int32(key(right) - key(left))
```

The subtraction wraps. This is not a tuple sort by layer/Y/X, not an
entity-center painter sort, and not a cropped-sprite-bottom sort. Queue +8's
low word survives the shift; signed X comes from queue +12. Distinct keys in
a non-wrapping comparison interval sort descending. The plan rejects key
spans of at least `2^31`, where ordinary JS sorting cannot promise native
algorithm equivalence. Native priorities themselves may wrap at high layers.

Equal keys return zero. The plan is stable by input submission order but emits
`native-equal-key-sort-stability-unverified` and clears `verifiedSubset`.
The original CRT sort was executed on the five-child distinct-key crowded
fixture; exact-tie stability of that algorithm is deliberately not claimed.
The fixture's rear/front names are labels, not evidence of native Y sorting.

### Pixel Occlusion, Not A Rectangle

Both terrain layers may already be rendered before a normal body. For each
sprite tile column, use the MAP attribute at its **baseline row**, not at
each sprite pixel's row. Resolved foreground index zero clears the low
nibble, regardless of the raw key/attribute. For sprite-local row `row`:

```text
visible = row <= cutoff || !foregroundCoverageAtDestinationPixel
```

Coverage is read at the pixel's actual destination row/column. Holes remain
visible below the cutoff. Foreground attribute `0x40` reverses coverage bits;
background `0x20` does not. Supply 32 source-order uint32 coverage rows per
resolved BTS foreground record, bit 31 = leftmost source pixel. Do not derive
coverage from remapped RGB, fog, or the composited background. The plan applies
the reflection itself. This extends [terrain-transforms.md](terrain-transforms.md),
which already verifies the terrain mask's source-order convention.

## Pure Plan Contract

`composeSceneFrame({ terrain, sprites })` returns unchanged terrain commands
first, then global child commands. Inputs are not mutated; child/atlas objects
are retained by reference. Terrain rows are MAP file rows, positive Y down.
Positions are **per-child queued native pixels before SPR anchor/height**,
not rounded browser positions or entity-only centers. `nativeScenePosition`
accepts signed eighth-pixel native inputs; add the FIN child's loaded X/Y
offsets before projection (disk X times 8, disk Y times -8). Existing simulation
subcell units are not automatically native eighth-pixels. The orchestrator
must prove its conversion and actual submission words; do not synthesize those
from IDs or the current Y-sorted drawable list.

Supported body clipping: flags 16, mode/valueA 0, valueB 0/1, zero
height offset, layer low byte 0/1/2, nonempty integer source frames up to
352x240, nonnegative top-left, and supplied baseline/required coverage cells.
Layer 2 bypasses the coverage mask. These size/edge restrictions are conservative
implementation bounds, not assertions about all native sprites. The plan caps
the queue at 800 children, matching the native admission bound.

`clips` are half-open destination-local rectangles, currently one row high.
Their union restricts the existing draw, not its source image. `[]` means
fully occluded; `null` means **unverified**, never fully occluded. Missing
cells/masks, inconsistent part placement or mirror metadata, unsupported modes/elevation,
and existing FIN diagnostics remain visible in command diagnostics.
`verifiedSubset` requires no command or ordering diagnostics; it certifies
only this bounded plan contract, not the caller, palette, camera or live game.

## MissionView Handoff

The integration points are the drawable collection in
[MissionView](../src/mission-view.ts#L1172) and its
[FIN sampling/draw boundary](../src/mission-view.ts#L1423). Collect children
there before drawing, with actual native queue provenance. Keep animation
selection/state updates and visibility admission where they are. Do not place
portraits, selection rings, health bars, or carriers into this bounded body
queue; their passes/elevation require separate evidence.

Keep the existing indexed-terrain rendering or terrain-layer adapter, including
opaque background, index-zero foreground transparency, horizontal transforms,
light/remap and fog. The plan's terrain commands are ordering/data references,
not a replacement terrain renderer. Supply raw resolved foreground coverage
for every mask lookup, including pixels above the baseline and baseline cells
outside the visible viewport. Out-of-map/camera-edge clamping is not implemented.

For a verified sprite command, `save`, create a union path from `clips` at
`topLeft + span`, apply `clip`, then invoke existing `drawFinComposition` with
`[command.source.part]`, `command.compositionOrigin`, and the **unchanged**
team/palette `imageLookup` closure; finally `restore`. Apply the same single
integer camera translation to clip and draw. Do not recrop/recenter the atlas,
change global alpha/compositing, replace the image lookup, or draw an opaque
foreground rectangle. Fractional-camera/scaled raster equivalence needs its
own validation; native fixtures here use integer 1:1 pixels.

Gate **global reorder** integration on a verified plan. If it contains unsupported modes or ties,
retain the existing diagnostic fallback; do not silently reorder shadow/effect
passes using this body-only result. Mode 1 still needs its native shadow/body
passes; mode 3 has a proven pre-terrain pass; modes 2/4/5 are not
implemented here. In particular, do not remove the live cross-entity diagnostic
until the orchestrator supplies and tests the queue/order/camera contract.

The follow-up adapter's separate mask-only operation may clip supported bodies
in a mixed frame while preserving the existing draw order and unsupported passes.
Normal mode-0 horizontal mirrors are now supported by the
[Phase 4 original-source framebuffer proof](phase4-mirrored-body-20260919.md).

## Focused Verification

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/scene-occlusion-20260919.py
node --import tsx --test tools/qa/scene-composition.test.ts
```

Requires local original DC.EXE, Python Capstone 5 and Unicorn 2; the temporary
package directories above are the existing local installations. No dependency
or asset mutation is performed. Missing dependencies fail rather than skip.

The tests execute 12,996 original comparator pairs, original CRT sorting for
a crowded five-child queue, 1,536 cutoff cases, nine signed origin cases,
18 bypass cases, and six complete 128x256 framebuffer comparisons. Tall sprites
span two terrain columns with differing cutoff nibbles and asymmetric coverage
holes. One fixture adds transparent RLE runs and a nonidentity palette remap.
All framebuffer bytes, including untouched regions, are checked; TypeScript
clip output is independently rasterized and SHA-256 compared to native output.

Remaining gates: complete caller admission and auxiliary queue contributions,
exact equal-key order, effect/shadow passes, physical backing-buffer/map edges,
nonzero camera modes, live scene palette/alpha integration, and campaign visual
fixtures. Ordinary counter provenance is now established separately. Passing
these helper tests does not close the remaining live gates.