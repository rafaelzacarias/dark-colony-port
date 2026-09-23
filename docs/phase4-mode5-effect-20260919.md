# Phase 4: Bounded Native Mode 5 Effects

## Orchestrator Browser Verification

The real embedded Canvas adapter rendered the unchanged BEAC timeline-1 effect
child over published HUMAN01 terrain in a controlled placement. Result:
`exact: true`, 800 readback pixels, one `putImageData`, zero fallback `drawImage`
calls, and 648 changed destination pixels. The source palette/atlas loaders and
indexed terrain renderer were used; no effect parameters or source indices were
rewritten. Screenshot captured, renderers disposed and temporary DOM removed.
This is a bounded browser-path check, not a native campaign visual baseline,
global ordering or performance certification. Final integrated gate passed 2,295
tests, four skipped, plus typecheck/build. Earlier browser exclusions below
describe the implementation author's scope before this orchestrator follow-up.

## Live Coverage

The existing mission sprite loader and frame adapter now automatically draw
ground-level, nonmirrored FIN mode-5 effects with flags 16 and layers 0/1. This is
an increment beyond mode-0 bodies and mode-1 shadows, not Phase 4 acceptance.
No feature switch, helper-only caller, MissionView/main/engine edit, source-asset
rewrite, opacity approximation or glow is involved.

The verified original children are BEAC.FIN timeline 1 child 1 (BEAC frame 1),
and HUBU.FIN timeline 0 children 1/2 (GLIT/GLAT frame 9). The implementation
operates on source indices and coverage, not a sprite-name special case, so
other children with the same bounded draw contract use the same path.
The default mission loader already loads these atlases and now registers their
indexed data against the mission object. The existing frame adapter consumes
that registration even when its image callback returns the ordinary PNG
(the current caller selects palette canvases only for modes 0/1).

This is automatic integration in the existing mission path, with controlled
source placements tested through the real published-asset loader. It is not a
new browser capture or certification of every effect in unchanged HUMAN01.
Native global admission/painter ordering remains unverified. Selection and
health overlays remain after world drawing; no caller order was changed.

## Native Contract

[Probe](../tools/research/mode5-effect-20260919.py) executes original DC.EXE
SHA-256 `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Hooks observe only. Actual FIN children, compressed SPR payloads, MAP/BTS,
GIF and RMP bytes are unchanged and hash-checked.

- Mode-5 dispatch: `0x454924`, normal wrapper `0x462444`, raster `0x462468`.
- The wrapper adds `0x10000` to the RMP pointer, restoring it after drawing.
- Pixel writer `0x45b3f5` loads AL from destination, AH from SPR source, then
  writes `RMP[1][sourceIndex][destinationIndex]` to the destination.
- The source index overwrites the incoming brightness/team row. The shipped
  bank-1 table is authoritative; it is not regenerated from current colors.
- Every one of the 65,536 source/destination pairs is executed for all four
  RMPs, varying the incoming row. These supplemental pixel-primitive fixtures
  are distinct from the unchanged real FIN/SPR framebuffer cases.
- No source RGB lookup is consulted by this draw path. The published `.RGB`
  resource is RGB555 (32,768 bytes), not RGB565. Missing RGB metadata on
  `NativePaletteAtlas` therefore does not block mode 5. Any quantization used
  to build the shipped bank is already represented in its exact bytes.
- Normal effects share the ground cutoff `0x461090` and foreground coverage
  semantics verified by the framebuffer tests. Mode 3 is a separate native
  pre-terrain pass, not admitted here or treated as another body-layer effect.

BEAC.FIN timeline 3 child 1 also executes the actual mirrored wrapper
`0x4627e4`/raster `0x462808`. Its mask behavior differs from ordinary mirrored
body masks. All 32 captured mirrored frames are negative admission evidence:
the renderer rejects them rather than claiming approximate parity.

## Atomic Canvas Adapter

[Indexed renderer](../src/render/mode5-effect.ts) stages indexed writes.
[Canvas adapter](../src/render/mode5-canvas.ts) uses one bounded readback,
recovers destination palette candidates, applies the original bank-1 lookup,
and commits once only after every covered pixel passes validation.

No nearest-color quantization is used to recover destination indices. Unknown
RGBs and translucent pixels reject the whole effect. Duplicate palette RGBs
are accepted only if every candidate index maps to the same output RGB for
that source index. Palette zero is opaque when coverage is set; SPR holes do
not read or change their destination. Rejection never commits partial exact
pixels before the ordinary diagnostic fallback.

[Palette loading](../src/render/mission-sprites.ts) registers sources in a
mission-keyed WeakMap and unregisters on disposal. Different missions do not
share an active-palette singleton. Registered arrays must remain immutable.
Explicitly registered palette images are also supported by the Canvas API.

[Frame adapter](../src/render/mission-scene-frame.ts) exposes `mode5Results`
keyed by `rawSlot:sourceChildIndex`. It removes local mode-5/scene warnings
from executed commands only on exact success, and retains a specific runtime
diagnostic on refusal. Static planning diagnostics remain conservative;
`globalOrder=null` and `orderingVerified=false` remain unconditional.

## Gates And Verification

- Flags 16, mode 5, exact layer 0 or 1, mirror 0, elevation zero only.
- Integer source placement; frame width 1..352, height 1..240; valid atlas
  rectangle and matching index/coverage lengths. Negative physical world
  origins and missing required terrain coverage remain rejected.
- Integer viewport up to 8192 per dimension. Camera crops retain world masks;
  native physical backing-buffer edge quirks are not certified by padded crops.
- Identity Canvas transform, source-over, alpha 1, no filter/shadow, existing
  full-viewport clip. Arbitrary external Canvas clips cannot be inspected.
- Maximum 128 Kpixels of cumulative effect readback per scene-frame object,
  charged even on destination rejection; no readback once the remaining
  budget cannot cover the next effect. Each part has bounded source work.
  The existing caller creates frame objects per visual, so this is not a
  whole-game-frame GPU or performance guarantee.
- Modes 2/3/4, mirrored/elevated effects, unverified global ordering and live
  readback performance remain gates. Whole-part diagnostic fallback remains.

[Focused tests](../tools/qa/mode5-effect-native.test.ts) cover 96 full native
320x256 framebuffers, 96 integer crops and 96 real-loader Canvas RGBA results
under DESERT/JUNGLE/ATLANTIS/HTRAIN, plus 32 mirrored rejection fixtures and
262,144 native pixel pairs. Cases cover foreground reflections, high/low
cutoffs, adjacent positions, source holes and palette-zero coverage. Tests
also cover late alias/unknown/translucent rejection, invalid state/metadata,
aggregate budgets, mode-3 exclusion and one whole fallback draw.

Verification: 27 new focused tests passed; combined mode-5, mode-1, mission
frame, sprite palette and all-terrain palette regressions passed 108/108 with
no skips. Project typecheck and touched-file editor diagnostics are clean.
The combined run regenerated the native mode-1 oracle; mode 5 used the freshly
generated native trace. A terminal-interrupted run was discarded, then the
same finite checks completed in an isolated process group.

```sh
node --import tsx --test tools/qa/mode5-effect-native.test.ts
npm run typecheck
```

`DC_MODE5_TRACE` accepts saved native evidence. Otherwise tests regenerate it
using the same Unicorn/Capstone dependencies as the mode-1 probe and fail,
not skip, when original assets/dependencies are missing. No agents, browser
or full suite were used for this increment.

## Source Layer 1 Extension (2026-09-21)

The only production change is admitting exact layer 1 in
[composeNativeMode5](../src/render/mode5-effect.ts). It continues to use the
existing terrain-aware body masks, not an unmasked layer-1 shortcut. The
[Canvas adapter](../src/render/mode5-canvas.ts), shared frame budget, root
readback behavior and source registration API are unchanged. No source assets,
packages, mission loader/metadata, MissionView or global admission were edited
for this extension.

The `--source-effects` probe preserves the actual FIN child records and SPR
payloads. Its raster entry is now the original caller setup at `0x45485a`,
not a preloaded bypass flag followed only by the mode-5 branch. At
`0x45487d..0x4548a6`, layer 2 or nonzero elevation selects bypass; layers 0/1
at zero elevation both clear it. The caller then dispatches normal mode 5 to
`0x462444`, cutoff `0x461090` and raster `0x460131`. Observed masked writer
selection at `0x4602c1` proves that layer 1 does not bypass terrain coverage.
All cases restore the RMP pointer after the bank-1 wrapper. Original EXE hash
remains `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

Actual source selections, each tested in all four palette/RMP banks:

| FIN | Timeline:child | Source effect | Result |
| --- | --- | --- | --- |
| VENT | 19:2, 20:2 | GLIT frame 6, (-54, 11), layer 1, flags 16, A=5, B=0 | Exact |
| VENT | 38:2 | GLIT frame 10, (-80, 9), layer 1 | Exact |
| VENT | 19:0, 20:0 | PUFF frame 0, layer 0 | Exact |
| CENT | 0:2, 12:1 | GLAT frame 1, layer 0 | Exact |
| CENT | 53:1, 53:2 | CENTSTAND0 GLAT frames 0/5, layer 0 | Exact |
| CENT | 54:1 | CENTSTAND0 GLAT frame 5, layer 0 | Exact |
| CENT | 0:0 | GLAT frame 15, mirrored | Rejected |
| VENT | 38:0 | PUFF frame 18, layer 2 | Excluded and rejected |

The matrix contains 44 case rows / 352 native framebuffers: **320 exact normal
frames, including 96 layer-1 frames, and 32 mirrored rejection controls**.
Every normal frame also matches an indexed crop, the published-loader Canvas
RGBA output and an integer Canvas crop. The unchanged legacy matrix adds 96
normal matches and 32 mirrored rejection controls. All 262,144 original
source/destination pixel pairs across the four RMPs remain exact.

Before the production guard edit, all 96 layer-1 framebuffers already matched
the existing body composer in a separate positive preflight; the fixtures
include genuinely occluded covered source pixels. Original ordinary actor
admission also queues the complete unchanged timeline children with exact
source offsets. This is a controlled ordinary queue fixture, not certification
of native city admission for CENT. Raster placements use original HUMAN01
MAP/DESERT BTS terrain with each palette bank, not a whole ALIEN01 framebuffer.
The new oracle proves actual Alien FIN effects and the closed draw contract;
it does not prove original mission scheduling or painter order.

Both layers retain atomic rejection for unknown/translucent/ambiguous
destinations, missing terrain masks, bad Canvas state, source bounds, flags,
mirror and elevation. Equivalent destination RGB aliases still commit once.
Mission identity/disposal gates indexed sources. Failed destination readbacks
are charged to the same cumulative 128-Kpixel budget; the next over-budget
part performs no read. Missing masks and offscreen effects perform no read.
Exact executed commands lose their local mode-5 fallback diagnostic, while
`globalOrder=null` and `orderingVerified=false` remain unchanged.

There is no new camera-alignment gate: integer crops, including unaligned
origins and 7x5 dimensions, match crops of native padded framebuffers. This does
not broaden the claim to arbitrary original physical backing-buffer edges or
the full default-camera mission raster. No root-canvas readback was added.

Verification: source mode **66/66**, legacy mode **37/37**, then the final
source-exclusion/budget subset **5/5**, all with no skips. Strict scoped
TypeScript with unused checks and editor diagnostics pass. No agents, browser
or full suite were used for this extension. The earlier browser and integrated
suite results above are historical, not new verification.

```sh
DC_MODE5_SOURCE_EFFECTS=1 node --import tsx --test tools/qa/mode5-effect-native.test.ts
DC_MODE5_SOURCE_TRACE=/tmp/dc-mode5-source-effects-20260921-m05.json node --import tsx --test tools/qa/mode5-effect-native.test.ts
DC_MODE5_TRACE=/tmp/dc-mode5-legacy-20260921-m12.json node --import tsx --test tools/qa/mode5-effect-native.test.ts
```

`DC_MODE5_SOURCE_TRACE` selects the new source matrix directly;
`DC_MODE5_SOURCE_EFFECTS=1` regenerates it if no source trace is supplied.
`DC_MODE5_TRACE` retains its original legacy meaning. Both probe paths reuse
`/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918`.
New oracle SHA-256:
`48d2a4d89d8e3092015efb10df48ca40715f4e350faec766238a9267347099b5`.
Legacy oracle SHA-256:
`82f18033742fccf0f33e3d558d717db5b4442c8342df3fbd73d829434f01123b`.
Evidence logs: `/tmp/dc-mode5-source-final-20260921-m14.log`,
`/tmp/dc-mode5-legacy-final-20260921-m15.log`,
`/tmp/dc-mode5-strict-20260921-m16.log` and
`/tmp/dc-mode5-preflight-budget-final-20260921-m17.log`.