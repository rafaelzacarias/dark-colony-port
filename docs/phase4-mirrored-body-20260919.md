# Phase 4: Mirrored Normal Bodies

## Live Coverage

[scene-composition](../src/render/scene-composition.ts) now admits flags 16,
mode/valueA 0 and mirror/valueB 1 when `part.mirrored` agrees with the original
child. Value 0 remains supported. Unknown values, inconsistent metadata,
elevation, missing coverage and existing FIN diagnostics still fall back.
All previous bounds remain in force.

The existing [adapter](../src/render/mission-scene-frame.ts) and MissionView
consumer need no API or implementation change. Each supported part gets one
clipped body draw using the existing source atlas and palette/team image lookup.
There is no added shadow silhouette, alpha trick, duplicate body, global sort,
or change to mission-view, main, engine, generated assets or source data.
`globalOrder=null` and `orderingVerified=false` remain unconditional.

## Original Source Proof

[Native probe](../tools/research/mission-scene-frame-20260919.py) and
[framebuffer test](../tools/qa/mission-scene-native.test.ts) execute the original
DC.EXE, SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
FIN/SPR/BTS/MAP source hashes are emitted and independently checked.

The new case is original TRSC.FIN timeline **276**, in `TRSCDIEA2`:
SPR frame **135**, offsets **(-52,29)**, layer **1**, flags **16**,
mode **0**, mirror **1**. Its frame is **64x44**, anchorX **147**,
anchorY **125**. No child fields are rewritten or borrowed from mode 1.

Native body entry **0x46152c** starts at queuedX + width and walks left,
placing the leftmost destination at **queuedX + 1**, not queuedX + anchorX.
It calls the same baseline cutoff routine **0x461090** as the unmirrored
**0x461170** path, with reverse traversal. Mask decisions are destination/world
coordinates; only source pixel selection reverses. Clips must not be mirrored
a second time by the adapter.

Eight complete **192x192** original-terrain/body framebuffers cover both source
foreground reflection states, two sub-tile placements and adjacent one-pixel
positions. Every byte matches, including unchanged terrain, and every case
differs from a native mask-bypass render. Eight **32x32** integer viewport crops
also match, with negative body origins and clipping on every side. The four
existing unmirrored framebuffers/crops remain green. These are body palette-index
comparisons under the existing identity-remap fixture, not native shadow/RMP or
final display-palette certification.

## Camera And Edges

The original-source test also sweeps twelve Q10 positions across quantization
boundaries and six fractional camera positions each. Camera motion only
translates the integer viewport; it does not change world mask coverage or
switch a supported part to fallback as its extent moves. Native origin and
draw origin use the same integer translation. Fractional Q10 interpolation,
non-unit scaling and transitions to unsupported modes remain outside this proof.

A direct mirrored native draw crossing the physical backing-buffer left edge
was investigated: the original (-5,-6) fixture differed at three x=0 pixels.
Moving that same placement into a tile-padded native backing framebuffer
removed the discrepancy. The eight accepted comparisons use padded backing
frames and integer viewport crops. They do **not** certify arbitrary native
physical-buffer edge behavior. No camera-dependent border special case was
added to the planner, since that would change world coverage during scrolling.

## Live Test And Remaining Gates

[Live consumer test](../tools/qa/live-terrain-mask.test.ts) uses original ALIEN01
data, source-checked FIN/SPR, the actual indexed-terrain renderer path with
recording Canvas/WebGL contexts, and existing palette/team canvas lookup.
It selects unchanged timeline 276 through a controlled state-range fixture:
one clip, 44 spans, one matching atlas body draw, width-64 mirror translation,
scale(-1,1), balanced save/restore and unchanged health overlays. The fixture's
placement is not occluding; actual pixel removal is proven by native cases.
This is consumer integration evidence, not browser pixels or a natural campaign
death capture. No browser, agent or full-suite execution was used.

The subsequent [mode-1 shadow/body increment](phase4-mode1-shadow-20260919.md)
adds the exact source-RMP shadow plus clipped normal body through registered
indexed palette images. Missing/ambiguous destination data still causes
whole-part diagnostic fallback, never a body-only parity claim. This earlier
mode-0 proof remains unchanged. Global queue ordering, effects, elevated
carriers and complete campaign visual parity remain blocked.

Focused verification: 15 tests across scene-composition, mission-scene-frame,
mission-scene-native and live-terrain-mask. Missing native dependencies fail
rather than skip. The native probe uses the existing Unicorn/Capstone installs
at `/tmp/dc-re-capstone-20260918` and `/tmp/dc-trigger-unicorn-20260918`.