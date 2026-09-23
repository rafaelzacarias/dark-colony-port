# Source-Derived SCN Constructor State

## Result

The original slot-0 CITY constructor gap is implemented for **HUMAN02 and
ALIEN02**. The source-only factory now produces all **800 raw220 records**,
including unused records, exactly at the original first world entry after
relocating only the three actor FIN pointer fields. Runtime inputs are original
EXE/SCN/GAMESTAT/DEPEND/MAP/FIN bytes, never native JSON or an existing browser
world. This is **not a complete native-world initializer**: complete type/FIN
tables, pointer allocations, terrain/PTH and mutable globals remain unowned.
**Contiguous whole cycles remain 0 for both missions.** No readiness gate changed.

## APIs

Implemented in [source-native-world-state.ts](../src/engine/source-native-world-state.ts):

- `constructSourceNativeCity(source, current, team, city)` owns the fresh fixed
  CITY `0x444f14` call, including `0x412014`, `0x41822c`, local dependency refresh
  `0x437bc4`, footprint, registry and production-ready writes. Returns a detached
  candidate plus every ordered game/dependency/ground/dirty write. This explicit
  boundary API is not a fresh-world authentication claim.
- `createSourceNativeCityStartup(assets)` constructs its own source-derived
  state and executes all **120** calls in source team/slot order. Returns
  `beforeCities`, `afterCities`, `placementEntry`, ordered `calls`, and canonical
  `finFields`. The six-pair SCN row is preserved by parsing; only its first five
  pairs are consumed. Slot 5 uses source base-coordinate presence, not pair 6.
- `createSourceNativeScenarioStartup(assets)` continues that same candidate
  through the actual SCN placement stream to `0x41c6b4`. Returns `state`, RENAT,
  source-row/slot/type placements, resource terrain-cell writes, and a separate
  `scnReturnGame` with the original `0x44ab80/0x44ac28` checksum. The explicitly
  unallocated pointers remain zero and are listed, not silently normalized into
  claimed allocations. Missing FIN and unsupported placement branches reject.

`SourceNativeCityAssets.animations` contains original binary FIN files, not
generated JSON. The fixed CITY pass requires HUBU/ALBU/TOWR. The complete two
mission placement tests additionally supply TRSC/GRAY/REAP/SCYT/VENT/BEAC/DISH/
CENT/TONG/TURR. Every supplied asset is hash checked. Input bytes are privately
copied before asynchronous hashing. Source identities are WeakMap-branded.

FIN IDs are `0x10000000 + type * 280 + 0x80`: identities of source stand fields,
not captured allocation addresses. Tests map the original type's `+80` pointer
to this identity at actor `+14/+1c/+24`; no non-pointer actor byte is normalized.
These IDs do not yet represent complete materialized FIN bank allocations.

## Instruction Provenance

| Fields or behavior | Original instructions |
| --- | --- |
| Zero-filled game allocation, pool heads, registry -1, 2024 projectile sentinels | `0x40bddc..0x40bdef`, `0x40bf80..0x40c09b` |
| Controller identity, transport flag | `0x40c0a0..0x40c139` |
| Raw `+08`: floor(slot/15) for 0..119, then 8 | `0x41b965..0x41b9c8` |
| Timing defaults, population ceiling 150, latency 33 | `0x41b9d3..0x41baae` |
| SCN clocks, relations, all team fields | `0x41bc24..0x41c31b` |
| Five CITY pairs, implicit slot 5, unchanged ignored sixth pair | `0x41c0db..0x41c20d` |
| GAMESTAT scanner offsets, boolean fields and Q8 multiplier | `0x43bbc5..0x43bd2f` |
| Source weapon/armor upgrade bytes | `0x41c216..0x41c287` |
| CITY type, position, footprint and queue-group tables | EXE `0x47afa8`, `0x47ab70`, `0x47abe8`, `0x41ae30` |
| Animation reset only when bank/mode differs | `0x42630c..0x426331` |
| CITY tasks `[1,19]`, depth 1, cursors 3/4, observer 255 | `0x412014`, `0x412654`, `0x41822c` |
| CITY dependency availability and dirty byte | `0x437bc4..0x437e9d` |
| Footprint low-10-bit replacement and registry | `0x445237..0x445397` |
| Ground initialized to 1023 | `0x445570..0x4455fc` |
| Placement counterpart, RENAT, resource reserve and terrain bit | `0x41c453..0x41c6af` |
| Actual raw ordinary/static/resource constructor | `0x41af14..0x41b49b` |
| SCN return checksum, inclusive high-water scan | `0x44ab80..0x44ac50` |

PE reads honor section `IMAGE_SCN_CNT_UNINITIALIZED_DATA` (`0x80`): such bytes
are zero, even when the file header has a nonzero raw size and raw pointer zero.
The four unused type records 106..109 are explicitly checked as zero. Do not
copy PE headers into BSS metadata. Full callback tables are not materialized by
this factory and remain a full-world requirement.

High-water is **0 before CITY**, **5 after CITY** for these two original SCNs,
then **152** at `0x41c42d` before placements, finally **170 / 193**. The value
**150** is the separate population ceiling at game `+4`, not low-slot high-water.
No independent native boundary is reseeded between the 120 source CITY calls.

Placement preserves default status/flags, old-HP idle payload, direction,
construction coordinates, `+d1=255`, `+d2/+d4=-2`, registration and all zeroed
unused bytes. Resource type 40 is owned by team 8, leaves ground occupancy alone,
and writes reserve `+32` separately. The original fresh configuration's resource
scales are 256; this factory does not claim configurable resource-global ownership.
Neither pinned source SCN uses the rejected commander, type-37, air or extra-plane
constructor branches. RENAT rows consume no actor slot.

## Comparisons

[Native probe](../tools/qa/source-native-world-initializer-native.py) observes
the existing original local-session startup, without replacing constructors.
It inherits the scheduler harness's documented file/platform/type/FIN setup
substitutions. In particular the inherited type scanner/FIN binding path is
bounded: this is not a claim that the entire original application loader ran.

[Focused tests](../tools/qa/source-native-world-initializer.test.ts) verify:

- Slot 0: complete `0x471b0` game, all type/dependency bytes, unchanged RNG,
  and every ordered write, including footprint and external dirty writes.
- All 120 CITY calls: source-created entry and final raw800/team/pool/registry/
  dependency/ground state plus every native call's ordered writes. HUMAN uses
  types 16/17/81; ALIEN uses 28/29/81. No native input is fed to this factory.
- All placements: **18 HUMAN / 41 ALIEN**, complete raw800/registry/high-water/
  ground/dependencies, source scanner and upgrade fields across all 110 types.
- First world entry: its raw800 bytes equal the original SCN-constructor exit;
  therefore the source factory raw800 comparison covers that first entry too.
- SCN-return game: every byte outside named unallocated pointer fields matches,
  including checksum (`0x7fd4` HUMAN, `0xceb4` ALIEN). Pointer omissions are
  asserted as actual nonzero residual differences, not hidden as relocations.
- Forged identity, occupied footprint and changed source data reject; failed
  construction leaves its caller unchanged.

## Concrete Remaining Ownership

The first full-state blocker is now type initialization `0x43c388`, not a missing
slot-0 constructor. The two raw-pool discrepancies previously reported as 1045 /
1327 non-FIN bytes are **zero for the new source factory**. The old browser loader
is unchanged and still has its old discrepancies.

- Type `+7c..+d8`: remaining FIN banks and idle count; `+e4/+e8`: variant counts.
  Unconstructed types also lack stand banks. Scanner/upgrade fields outside
  these regions match the inherited native captures. Full geometry and armor
  loader transformations require a full-loader proof, not the bounded capture.
- Game pointer allocations: `+544` configuration, `+958` command storage,
  `+7d18` application, `+46f2c` map, `+471a0/+471a4` alliance/vision objects;
  message pointers in `+46fa0..+4719b`. No backing allocations are invented.
- Native terrain/air/extra/PTH/route planes, all type/callback/metadata globals,
  weapons/projectile service tables, resource/statistic globals, CRT state,
  TRO/message/AI heaps and their source-normalized allocation graph.
- Local-session transition to first world entry changes 14 game bytes in both
  captures: packet `+94c`, input pointer `+950`, command length `+95c`, AI pointer
  `+b94`, and eight team `+e20` words. Raw800 and RNG do not change. This transition
  is not supplied by the SCN constructor API.
- World composition still stops at the previously documented platform/initial
  visibility interval and has not joined registered/policy/scheduler owners.

`transactNativeWorldCycle` still rejects before mutation; `admitted` and
`executableWholeGame` remain false. No cycles 1..4, screenshot, playable02,
browser, default runtime or readiness-gate claim follows from these comparisons.

## Reproduce

Final verification: **5 HUMAN02 + 5 ALIEN02 + 12 existing cycle-prefix tests
passed**, no failures or skips. Scoped strict/no-unused ES2022 / ES2023,DOM
TypeScript checks and editor diagnostics passed. Evidence:
`/tmp/dc-world-init-final-human-20260922-i31.log`,
`/tmp/dc-world-init-final-alien-20260922-i33.log`,
`/tmp/dc-world-init-cycle-regression-20260922-i34.log`,
`/tmp/dc-world-init-final-types-20260922-i35.log`.

```sh
DC_WORLD_INITIALIZER_MISSION=HUMAN node --import tsx --test tools/qa/source-native-world-initializer.test.ts
DC_WORLD_INITIALIZER_MISSION=ALIEN node --import tsx --test tools/qa/source-native-world-initializer.test.ts
```

Without `DC_WORLD_INITIALIZER_TRACE`, each run generates a new native capture.
Use that variable to supply output from the probe's `--mission HUMAN|ALIEN` mode.
Initial local captures: `/tmp/dc-world-init-{human-20260922-i09,alien-20260922-i13}.json`;
later tests regenerate additional placement and first-world boundaries. All
logs use unique absolute paths. No agents, browser, full suite, Git commands,
packages or assets were used or modified.