# Scene Queue Provenance: Live Integration Blocked

Follow-up: [mission scene adapter handoff](mission-scene-adapter-20260919.md)
adds bounded complete ordinary admission execution, raw indexed terrain coverage,
independent normal-body masking and original-source camera framebuffer tests.
The live hook is still not enabled; full city/auxiliary/map/effect queue provenance
remains incomplete. The report below records the earlier evidence and limits.

2026-09-19 continuation of [scene-occlusion.md](scene-occlusion.md).
**No live scene-plan hook is enabled.** The existing diagnostic FIN fallback
still draws the mission. This is not native render parity or acceptance.

## Executed Source Evidence

[Native probe](../tools/research/scene-queue-provenance-20260919.py),
[source fixture tests](../tools/qa/scene-queue-provenance.test.ts).
DC.EXE SHA-256 remains
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

| Native address | Verified rule |
| --- | --- |
| `0x40abee -> 0x435fb0` | Frame reset clears accepted queue count `0x4e6864`, not submission value `0x4e685c`. |
| `0x435fc0` | Stores `EAX & 0xfffffff8` into `0x4e685c`. |
| `0x4398fb..0x439904` | Ordinary entity resets from unsigned Y word at entity `+4`. |
| `0x439936..0x4399d7` | Traverses the loaded FIN child array in source order, submitting to `0x435fcc`. |
| `0x4360cc..0x4360de` | Stores the current submission value at queue `+8`, then decrements it. |
| `0x436180` | Increments accepted queue count. Admission at count 800 returns without decrementing the submission value. |
| `0x4395df`, `0x439615`, `0x439b54..0x439bc5` | Entity base is game `+0x7d28`; visits raw slots `0..799`, stride `0xdc`, testing status byte `+0x2c`. No entity-ID, Y, or diagonal sort. |
| `0x439c23..0x439d78` | Subsequent map-object pass iterates column ascending outside, native-world row ascending inside. This is not the entity pass. |

The probe executes ten reset cases, thirty accepted children, the full-queue
rejection, and fifteen coordinate boundaries. Native placement construction
supplies actual HUMAN02/ALIEN02 SCN records: 18 and 41 active placement slots.
The native traversal visits all 800 slots in each fixture, then a six-cell
column-major map rectangle. Traversal hooks skip entity admission/body at
`0x43961c` and return false for unseen, empty low-slot city visibility at
`0x444c80`. Thus **visitation is verified; full visibility admission is not**.
The fixture is the placement stream, not a complete city-initialized scene.

Four original multi-part FIN entries (HAZE, PORT, SHRI, BLEED2) contribute
14 children. Their disk order, offsets and modes are retained in loaded runtime
records. The ordinary caller and queue routine execute without interception.
Valid synthetic SPR headers isolate queue submission; these are not sprite
raster fixtures. Source hashes and an independent TypeScript FIN parse are
checked. Effect-mode children in these fixtures prove submission only, not
support for rendering their modes.

## Counter And Coordinates

[nativeOrdinarySceneSubmissionWord](../src/render/scene-composition.ts)
implements `(unsignedEntityYQ8 & ~7) - ordinal`, wrapping as a dword.
The ordinal counts already submitted children since that reset. For the bounded
all-normal primary list, this equals the original FIN child index. Do not use
the index after `composeFinSample` sorting or empty-frame filtering. Native
header-dependent skips, auxiliary lists and capacity also affect admission.
The special low-slot building path can subtract `0x108` before reset; the
ordinary helper does not model it. Map-object and effect callers reset from
their own native Y values.

Live simulation coordinates are Q10: 1024 subcells per 32-pixel tile. Native
entity words are Q8: 256 per tile, hence **one native unit is one eighth pixel**.
The current host handoff rounds `subcells * 256 / 1024`; using the simulation
number directly as eighth-pixels scales it by four. Source registration uses
the inverse scale. The boundary tests distinguish rounding from flooring at
Q10 value 2. This validates the host representation, not native motion or
fractional render interpolation.

Loaded signed-word FIN offsets are disk X times 8 and disk Y times -8. Add
them to native entity coordinates before `nativeScenePosition`. Native Y is
`(mapHeightQ8 - childYQ8 - 1) >> 3`; at Y=128 and mapHeightQ8=32768 it is
4079, not the current continuous browser baseline 4080. A direct browser
origin substitution would therefore be wrong at that boundary.

## Live Changes And Measurements

Only render-only snapshot consumption changed in
[MissionView](../src/mission-view.ts): visibility consumes the frame's captured
snapshot, including its daylight. The public visibility getter still captures
its own snapshot outside rendering. The orchestrator's explicit `tick`
parameter through `drawUnit`/`drawVisual` is preserved.

[Single-frame test](../tools/qa/scene-live-frame.test.ts) initializes actual
MissionView instances with original SCN/MAP/MTG/PTH/GAMESTAT/WEAPSTAT data and
published FIN/atlas/indexed palette assets. A recording Canvas2D surface and
loaded-image stand-in avoid a browser; WebGL takes the explicit fallback.
The fixture reveals all units and centers the densest cluster to exercise
multiple draws. Each real `render()` call performs **one snapshot read**:

| Fixture | Snapshot units | Palette-backed atlas draws | Snapshot reads |
| --- | ---: | ---: | ---: |
| HUMAN01 | 30 | 7 | 1 |
| ALIEN01 | 32 | 9 | 1 |

Health overlays and nine-argument atlas crops are checked separately. The
cross-entity unsupported-render warning remains present. This is an executable
render-call test, not browser timing, raster equivalence, or a live call to
`composeSceneFrame`. No such scene-plan call was added.

## Rendered Subset And Remaining Gates

The helper's verified subset is unchanged: normal unmirrored parts, flags 16,
mode/valueA 0, valueB 0, zero elevation, layers 0/1/2, within its documented
frame/map bounds, distinct non-overflowing keys, complete baseline cells and
source foreground coverage. **New live scene-plan rendered subset: none.**

- Complete city/ordinary/auxiliary/map-object/effect admission and capacity
  contributions must be represented before asserting native queue equivalence.
- Camera equivalence is not established. `0x4611ae..0x4611c6` aligns view offsets
  down to 32 pixels before the body pass; `0x4610ca..0x4610f4` uses view fields
  in MAP lookup. A final integer translation alone has not been framebuffer
  verified against that path.
- Live foreground masks must come from indexed terrain source indices, before
  remap/RGB/fog, retaining index-zero holes and the foreground reflection bit.
  No mask adapter or rectangular occluder was inserted into MissionView.
- Shadow mode 1, modes 2/4/5, mode-3 pre-terrain effects, mirrors, elevated
  carriers, native FIN events, viewport edges and equal-key sort behavior
  remain excluded. Palette/imageLookup, fog, selection and health code stay
  unchanged; no unsupported warnings were globally suppressed.

Focused checks only:

```sh
node --import tsx --test tools/qa/scene-composition.test.ts tools/qa/scene-queue-provenance.test.ts tools/qa/scene-live-frame.test.ts
npm run typecheck
```

The tests run the native probes with the existing local Capstone/Unicorn paths.
No agents, browser, full suite, engine/game-data/main edits, or asset builds.