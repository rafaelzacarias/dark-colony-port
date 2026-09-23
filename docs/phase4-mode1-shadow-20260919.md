# Phase 4: Native Mode 1 Shadow And Body

The later [mode-5 increment](phase4-mode5-effect-20260919.md) adds bounded
nonmirrored BEAC/GLIT/GLAT effects through the same live frame adapter. It does
not change these shadow results, overlay order or global-order limitations.

## Live Browser Follow-Up

MissionView now draws selection rings and health bars after world sprites/carriers,
preventing non-palette UI pixels from forcing shadow fallback. It reads mode-1
draw results after execution, suppresses resolved shadow/mode warnings and reports
the specific fallback reason otherwise. Whole-part fallback remains atomic.

Real embedded Canvas/WebGL on unchanged HUMAN01 at tick 220 produced six native
shadow writes both selected and unselected, with overlays after those writes and
no obsolete TRSC shadow warning. A screenshot shows the rendered shadows. A
120-frame synchronous sample in this 35-unit scene measured 9.6 ms p50, 11.5 ms
p95 and 14 ms maximum draw work. This does not measure rAF cadence, global native
scene ordering, sustained battle performance or device portability. Final full
gate: 2,035 passed, four skipped, typecheck/build passed. Browser fixture removed.

## Implemented Path

[Indexed CPU renderer](../src/render/mode1-shadow.ts) implements the original
ground-level flags-16, mode-1 shadow/body pair. It consumes actual SPR indices
and coverage, original FIN offsets/mirror flags, source RMP bytes and MAP/BTS
coverage. There is no ellipse, alpha-darkening overlay or body-only acceptance.

[Canvas adapter](../src/render/mode1-canvas.ts) uses one bounded RGBA readback
around visible shadow pixels, shades them through the actual indexed remap,
then lets the existing scene adapter draw the normal body with terrain clips.
Covered indices that remap to palette zero remain opaque. Transparent SPR runs
are controlled by coverage, not by the resulting palette color.

[Mission sprite palettes](../src/render/mission-sprites.ts) register indexed
metadata on their existing cached color canvases. The existing
[scene adapter](../src/render/mission-scene-frame.ts) detects it automatically;
no MissionView, main, engine, generated asset or source-data edit is needed.
The existing caller already chooses these palette images for modes 0 and 1.

## Native Evidence

[Probe](../tools/research/mode1-shadow-20260919.py) executes DC.EXE SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Code/read hooks only observe execution; no routine, pixel, child field, flag,
offset or source sprite is replaced. Shadow-enabled, ground-level drawing is
explicit fixture state. The original mode-1 dispatch branch is `0x4549f6`.

| Pass | Normal | Mirrored |
| --- | --- | --- |
| Shadow | `0x4618c0` | `0x461d14` |
| Body | `0x461170` | `0x46152c` |
| Baseline cutoff, both passes | `0x461090` | `0x461090` |

Shadow lookup is exactly `RMP + 0x4800 + destinationIndex`: bank 0, row 72.
The writer `0x45b812` reads the destination byte and writes the table result.
All 256 destination indices are executed against each of the four source RMPs.
Body dispatch switches the base by `0x20000` and uses row `128 + teamSelector`.

The native table generator `0x44f525` proves brightness 9/16, selector 0, with
integer truncation and reserved indices 138..143 selecting entries 96..101.
The native RGB lookup `0x42bb98` independently verifies the source RGB table.
**The shipped RMP is authoritative.** Rebuilding its shadow row from the
current GIF/RGB files does not reproduce every shipped byte; the renderer
therefore never replaces it with computed darkening or a regenerated row.

Shadow height is `height + floor(height * 40 / 256)`. Native byte accumulators
repeat source rows on overflow of 40, without advancing that accumulator on
the repeated row; horizontal shear advances on overflow of 128. Initial X is
the normal body X minus half the shadow height. The mirrored shadow's ground
mask/cutoff samples destination X minus one, including tile boundaries.
Normal-body mirroring retains its separately proven world-coordinate mask.

## Strict Checks

[New tests](../tools/qa/mode1-shadow-native.test.ts) compare all bytes of 256
native 320x256 backing frames, separately after shadow and after body, plus
256 integer crops. Eight unchanged FIN children cover TRSC timelines
0/268/380/401 and GRAY 0/250/306/348, including both mirror states and large
117x148 bodies. Eight placements per child cover both foreground reflections,
high/low terrain cutoffs, adjacent pixels and all eight team selectors.

Backdrops use original HUMAN01 MAP/DESERT BTS geometry, with native terrain
composition and source bank-0 row-128 colors under DESERT, JUNGLE, ATLANTIS and
HTRAIN palettes. These are controlled source placements, not four natural
campaign captures. FIN, SPR, MAP, BTS, GIF, RGB and RMP hashes are checked.

The automatic scene/Canvas path also matches all 256 final native RGBA buffers
using a browser-free pixel-recording Canvas implementation. Tests check one
body draw, balanced context state, at most one readback/write, the 128-Kpixel
per-part readback cap and unchanged global-order warnings. Rejection tests
prove no destination write on unknown colors, conflicting palette aliases,
translucency, transforms or unavailable readback.

Run only this slice:

```sh
node --import tsx --test tools/qa/mode1-shadow-native.test.ts
```

The test regenerates evidence and fails, rather than skips, when source files
or Unicorn/Capstone are unavailable. `DC_MODE1_TRACE` accepts a saved probe JSON.
Native dependencies use the existing `/tmp/dc-re-capstone-20260918` and
`/tmp/dc-trigger-unicorn-20260918` installations.

## Integration Contract And Limits

- `createMissionSpritePalettes(...).indexedImage(name, owner, override)` exposes
  atlas indices/coverage, display palette, source remap and selected team row.
  Treat returned source arrays as immutable. `nativePaletteImage(image)` also
  retrieves the metadata registered on a cached color canvas.
- `composeNativeMode1({ part, position, sprite, terrain })` accepts a decoded
  frame, not the whole atlas. `drawNativeMode1Indexed(surface, plan, sprite,
  remap, selector)` mutates a caller-owned indexed destination; optional pass
  selection supports shadow/body testing. Camera crops do not recompute masks.
- Existing `frame.drawEntity(...)` attempts both native passes automatically.
  `frame.mode1Results.get("rawSlot:sourceChildIndex")` reports exact local draw
  acceptance/readback size or a separate `mode1-shadow-*` fallback diagnostic.
  Static FIN/scene planning diagnostics remain conservative because indexed
  image/destination availability is known only at draw time.
- Canvas requires an identity transform, source-over, alpha 1, no filters or
  Canvas shadow effects, and the existing full-viewport clip. Palette aliases
  are accepted only when every alias has the same resulting shadow RGB.
  Selection rings, overlays, anti-aliased colors or translucent destinations
  can force whole-part fallback. No partial exact-shadow write is committed.
- Elevation, unsupported FIN metadata, absent ground coverage and negative
  physical world origins remain rejected. Native physical backing-buffer edge
  quirks are not certified by cropped padded frames. The indexed API avoids
  Canvas readback, but GPU integration is not implemented here.
- `globalOrder=null` and `orderingVerified=false` remain unconditional.
  City/effect admission, global painter ordering, natural first-mission parity
  and live GPU/readback frame timing remain unverified. No browser, agents or
  full suite were used; the pixel budget is not a GPU performance measurement.