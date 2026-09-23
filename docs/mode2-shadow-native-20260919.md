# Native Mode 2: Bounded Shadow-Only Renderer

## Result

Implemented in new [mode2-shadow.ts](../src/render/mode2-shadow.ts) and
[mode2-canvas.ts](../src/render/mode2-canvas.ts), now integrated through
[mission-scene-frame.ts](../src/render/mission-scene-frame.ts). The live scene
attempts the bounded exact adapter and retains diagnosed fallback outside its
envelope. No mission-view, combat, loader, assets, or package changes were needed.

Mode 2 is the native projected **shadow only**, not a tinted body, alpha blend,
mode 5 effect, or opaque source copy. The original dispatch table at `0x454664`
selects `0x454bcd`, calling `0x4618c0` normally or `0x461d14` mirrored. It never
calls the body blitters `0x461170`/`0x46152c`. The enabled shadow path uses RMP
bank 0, row 72 on the destination index. Source color is irrelevant; SPR coverage
determines which pixels cast a shadow, including covered source index zero.

The projection is the already verified mode 1 shadow pass: vertical stretch
accumulator 40/256, horizontal shear 128/256, native terrain cutoff and reflected
foreground masks. `composeNativeMode2` delegates that geometry to
`composeNativeMode1` and returns only the shadow and its bounds. It does not emit
the mode 1 body. The mode 0 RMP base adjustment `+0x20000` is unrelated to mode 2.

## Supported Envelope

- FIN `flags=16`, `valueA=2`, `valueB=0|1`, layer 0 or 1, zero height offset.
- Existing source atlas/index/coverage/palette/RMP metadata; frames at most
  352x240, with ordinary validated FIN placement and complete terrain masks.
- Native shadow-enable is assumed on. A caller owning a disabled native shadow
  setting must omit this pass; this adapter does not own that global setting.
- Canvas requires identity transform, alpha 1, source-over, no filter/shadow,
  and an opaque palette-resolvable destination. No RGB approximation.
- Camera X/Y and width are 32-pixel aligned, nonnegative, dimensions at most
  8192. Top/horizontal clipping and physical negative-edge projection reject.
  Bottom clipping is verified against actual clipped native calls. The original
  blitter preserves the last viewport row, so writes stop before `height - 1`.
- One bounded getImageData/putImageData pair at most, 128*1024 readback pixels.
  Empty visible shadows need neither call. Every failure occurs before commit;
  failed readbacks and post-read palette rejection report charged readbackPixels.
- RGB collisions are accepted only if every palette index with that RGB maps
  through row 72 to the same output RGB. Unknown/translucent/ambiguous pixels
  reject the whole part. SPR holes and untouched framebuffer bytes stay intact.

The native clipping proof covers lower viewport clipping, not top/side clipping,
arbitrary transformed Canvas rendering, general scene order, or every FIN mode.
The caller must also own the Canvas clip region: putImageData ignores Canvas clips,
so use the scene context before installing a per-body clip.

## Original Evidence

[Native probe](../tools/research/mode2-effect-20260919.py) executes the original
EXE under Unicorn, reusing the existing source terrain/SPR harness. No native OS
window, runtime interception, blitter replacement, or fabricated sprite art.

EXE SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

Source children (zero-based indices), decoded from the unchanged ALBU.FIN:

| Timeline | Child | SPR frame | Layer | Original mirror | Position |
| --- | --- | --- | --- | --- | --- |
| 13 | 2 | ALBU 21 | 0 | 0 | -137, -100 |
| 485 | 1 | ORTU 4 | 1 | 1 | -164, 41 |

Four original banks: DESERT, JUNGLE, ATLANTIS, HTRAIN. Each child also has an
explicitly labeled controlled opposite-mirror case; those modified mirror bits
are not claimed as unchanged FIN records. Eight placements per case exercise
reflected/unreflected terrain, row phases, and baseline cell boundaries.

16 cases x 8 placements x 2 viewports = **256 native framebuffers**. Of 128
lower-clipped runs, 104 differ from their full framebuffer. Tests compare every
indexed byte and every palette-converted RGBA byte, including untouched tails.
Hooks require shadow and cutoff calls, forbid body calls, and restrict all RMP
reads to row 72. FIN/SPR/MAP/BTS/GIF/RMP hashes are checked against source files.

Verified trace: `/tmp/dc-mode2-native-11.json`, SHA-256
`4e260fc094af7d40e089a4d52124bcacffb1d69f4fecc092550aaa5d15e2e5ac`.
The trace is reproducible, not a required checked-in artifact.

## Live Integration

[createMissionSceneFrame.drawEntity](../src/render/mission-scene-frame.ts) now
dispatches `valueA === 2` before mode 5 and before per-body clipping. It passes
the actual native position, terrain, unchanged camera, indexed `imageLookup`
image, and remaining shared effect budget to `drawNativeMode2Canvas`.

- `requiredCells` includes mode 2's vertical stretch and leftward shear, including
  shadow baseline and ground-mask cells outside the body rectangle.
- Exact success records `mode2Results` by `rawSlot:sourceChildIndex` and continues
  without `drawImage`, a body pass, or a body clip.
- Only the command's mode 2 adapter/mode-unverified diagnostics are refreshed.
  Failure restores its mode/unverified diagnostics, adds the current adapter
  reason, and reaches the unchanged FIN fallback. Source FIN warnings, aggregate
  scene diagnostics, and unrelated command diagnostics remain intact.
- Mode 2 and mode 5 charge the same 128*1024-pixel frame counter, including failed
  readbacks and palette rejection after readback. It is not reset per part,
  entity, or repeated `drawEntity` call.
- Existing [palette image registration](../src/render/mission-sprites.ts) supplies
  the indexed metadata automatically. No new mission registration or loader
  disposal path is needed.

Actual mission cameras are usually not 32-pixel aligned. Those views correctly
remain on diagnosed fallback; the integration does not round the camera or widen
the adapter's proven clipping envelope. This is bounded live-path integration,
not global scene parity: `orderingVerified` remains false, `globalOrder` remains
null, and global admission/order diagnostics are retained. Browser appearance
and live warning removal are not claimed; main owns browser validation.

## Verification

**54 passed**: 10 [scene integration tests](../tools/qa/mode2-scene.test.ts),
27 [Canvas/unit contracts](../tools/qa/mode2-canvas.test.ts),
17 [native tests](../tools/qa/mode2-shadow-native.test.ts) covering provenance and
the 16 complete matrices (256 native framebuffers), using the supplied
`/tmp/dc-mode2-native-11.json` trace. Scene tests cover native-Q8 placement,
registered image metadata, no exact body draw, normal/mirrored shear and stretch,
atomic missing-mask fallback, unchanged unaligned cameras, diagnostic transitions,
and shared mode2/mode5 budgets in both orders across repeated entity draws,
including failed readbacks. They use an identity Canvas fixture with filter
`none`; no shader/browser rendering is involved.

Strict scoped TypeScript and editor diagnostics clean. Integration test log:
`/tmp/dc-mode2-integration-final-20260919-07.log`; scoped types:
`/tmp/dc-mode2-integration-types-20260919-06.log`.
Screenshots/browser tests: **not run**. No agents, full suite, or package commands.

From the workspace root:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/research/mode2-effect-20260919.py > /tmp/dc-mode2-native.json
DC_MODE2_TRACE=/tmp/dc-mode2-native.json node --import tsx --test \
  tools/qa/mode2-scene.test.ts tools/qa/mode2-canvas.test.ts \
  tools/qa/mode2-shadow-native.test.ts
```

Without DC_MODE2_TRACE, the native test regenerates the original evidence itself.