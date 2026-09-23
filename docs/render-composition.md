# FIN Child Composition: Verified Subset

Status: implemented subset, **not phase accepted**. No browser was opened.

## Integration

MissionView loads every sprite referenced by the FIN timeline and draws the
selected entry's complete child list, including attack/death effects. It no
longer selects one body child, carries a previous body through empty entries,
or recenters cropped images. All children share the entity origin.

MissionView edits are confined to imports, visual interfaces/loading and
`#drawVisual`. Constructor, update, input, state-entry, facing and entity lifetime
regions were not edited. Existing N8/NE10/E12/SE14 mapping and upward-world to
screen conversion remain in use.

`fin-composition.ts` provides pure composition, source-duration sampling and a
Canvas adapter. `atlas-cache.ts` coalesces case-insensitive requests with four
concurrent loads, 128 pending keys and 64 retained atlas entries. Failed requests
are retryable. Active mission visuals retain their own references; eviction
never invalidates them. Bounds are entry-based, not byte-based. Drawing performs
no requests.

## Executable Evidence

DC.EXE SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

| Address | Verified operation |
| --- | --- |
| `0x425c98` to `0x425cfe` | Disk child fields load into runtime sprite +4, X +6, Y +8, layer +10, flags +12, valueA +14, valueB +16. |
| `0x425d1c` to `0x425d36` | X becomes signed eighth-pixels; Y becomes negated signed eighth-pixels. |
| `0x439936` to `0x4399d7` | Entity traverses all children and submits them to `0x435fcc`. No body-name filter. |
| `0x43604e` to `0x4360c6` | Converts world to pixel queue coordinates. Layer, valueA, valueB become queue bytes +21, +23, +24. |
| `0x454590` to `0x454661` | Comparator uses layer-byte priority, insertion order and X. |
| `0x4548b3`, table `0x454664` | valueA selects mode 0..5; nonzero valueB selects mirrored blitters. |
| `0x4611cd`, `0x4611ef` | Normal body adds SPR anchorX and subtracts height. No anchorY read. |
| `0x461589` to `0x461595` | Mirrored body starts at child X plus width, without anchorX. |
| `0x4658b9` to `0x4658cf` | Mirrored literals store at start, start-1, start-2; leftmost pixel is child X+1. |
| `0x425b21` to `0x425b6b` | Zero field2 becomes 15; signed duration converts with truncation of `(field2 + 3) * 15 / 100`. |
| `0x4264f9` to `0x42655d` | Countdown consumes converted low byte, advances when zero, loads next countdown and decrements. |
| `0x41941b` to `0x419434` | Entity updates its three animation channels. Does not establish wall-clock cadence. |

### Placement

At the shared entity screen origin, in source pixels:

- Normal X offset: `child.x + frame.anchorX`.
- Mirrored X offset: `child.x + 1`, with horizontally reversed pixels.
- Y offset: `child.y - frame.height`.
- SPR anchorY is not a vertical pivot in these paths.

The native world-to-screen `-1` subcell convention cancels for child offsets
relative to the same entity origin. Browser camera raster rounding remains an
adapter choice. Executed native instructions confirm TRSC frame 0 at
`(-12, -41)` and GRAY at `(-11, -33)`. No per-unit calibration constants.

### Layer and Mode Handling

For the layer low byte, priority is `3000 * (floor(layer/2) + 1)` for odd values
and `-3000 * floor(layer/2)` for even values. Larger priorities draw first:
layer 1 precedes 0, which precedes 2. Equal priority retains source order.
This implements **entity-local** ordering, not the native global child queue.

Mode 0 uses the body path. Mode 1 includes a shadow and body pass; the browser
draws the body and reports a shadow-gap diagnostic. Modes 2..5 have distinct
native paths, including prepasses and palette-sensitive effects. They are not
claimed supported: the atlas child remains visible as a normal image with a
red diagnostic outline and warning. Unknown flags/mirror values also report.
Flags 16 are the observed baseline, not proof of general flag semantics.

Missing frames/images draw a crossed marker at the child offset. Truly empty
source frames remain empty. Missing states and unsupported durations draw a
marker and report the state. Warnings are deduped and capped at 256 keys per
page lifetime. Unsupported effects are never silently filtered out.

### Timing Contract

`finSourceDuration` reproduces signed conversion and low-byte truncation:
field2 0 -> 2 updates, 6 -> 1, 13 -> 2, 100 -> 15, 250 -> 37.
Zero converted countdowns have initialization/underflow behavior not modeled
by the stateless sampler and are rejected explicitly.

`createFinSourceSampler` consumes elapsed **animation updates**, not seconds.
It holds the first selected entry for its duration, loops living states and
clamps death to the last entry, including an empty entry. Native initial
zero-countdown/state-entry ordering and alternate end modes are not proven
equivalent to this presentation contract.

MissionView supplies one update per simulation tick (20 Hz). This provisional
adapter emits a diagnostic; it is **not verified original wall-clock timing**.

## Verification

```sh
node --import tsx --test tools/qa/render-animation.test.ts
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/qa/render-native.test.py
npm run typecheck
```

The native probe SHA-checks DC.EXE and executes duration conversion, child
offset conversion, body placement, layer comparisons and mirrored literal
stores with Unicorn. It does not boot the game or emulate palette effects.
The TypeScript tests compare raw FIN and generated metadata, then send every
selected TRSC/GRAY attack/death entry through a recording Canvas. They check
frame IDs, each child's own atlas, empty entries, mirrors, diagnostics and
balanced Canvas state. This is integration evidence, not screenshot proof.

Reproduce disassembly with the existing read-only tool, for example:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918 \
  python3 tools/research/trigger-audit.py disasm 0x461170 0x461230
```

## Handoff and Gaps

- Palette remapping, native shadows, lighting, prepasses and effect modes remain
  incomplete; unsupported effects remain visible with diagnostics.
- Original clock cadence, initial countdown phase, alternate end modes and zero
  converted countdown behavior remain unverified.
- FIN events are reported, not executed. Entry children render; event-spawned
  projectiles/effects are not synthesized.
- State-entry resets, attack restarts, facing preservation and dead-entity
  retention remain orchestrator-owned. Effects stop if the owner stops drawing
  a dead entity before its animation ends.
- Global child ordering and source-layer terrain interactions remain outside
  this entity-local compositor.
- Compass interpretation is source-frame verified for TRSC/GRAY, not every FIN.
- No browser visual/mobile inspection was performed, per ownership rules.

Do not mark the phase accepted from these tests or typecheck alone.