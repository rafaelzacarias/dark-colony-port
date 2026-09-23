# First Four World Calls: Verified Prefix, No Whole-Cycle Admission

## Result

Follow-up: the [source constructor initializer](source-native-world-initializer-20260922.md)
now builds both missions' raw800 pools from original assets, including all 120
CITY calls, SCN placements, registry, ground occupancy and dependency writes.
Its first-entry raw800 non-FIN discrepancy is zero. Full type/FIN tables,
allocation graph, terrain/PTH/globals and local-session startup remain unowned;
the following original loader audit is historical and the whole-cycle count
below is unchanged.

**Contiguous source-started TypeScript whole cycles: HUMAN02 0, ALIEN02 0.**
`admitted` and `executableWholeGame` remain false. No default campaign, selector,
registered host, scheduler host, policy, production bridge, or asset was changed.

The new [world prefix reducers](../src/engine/native-world-cycle.ts) own two
explicit, disjoint original instruction spans:

| Reducer | Original span | HUMAN calls 1..4 | ALIEN calls 1..4 |
| --- | --- | ---: | ---: |
| Census and persistent commander flags | `0x4196f4..0x41981c` | 3,664 ordered writes | 3,856 ordered writes |
| Clock, population cap, relations, daylight | `0x41989e..0x419a28` | 364 ordered writes | 364 ordered writes |

All **8,248 ordered writes** and complete before/after game, statistics,
type-statistics, alliance/vision, RENAT, and RNG/CRT buffers match the original.
Each segment is independently seeded from its native entry. These are **not**
four TypeScript cycles, nor a contiguous prefix across the omitted platform and
initial visibility work. No world exit is published by these reducers.

`transactNativeWorldCycle` rejects **before running any reducer** because there
is no authenticated source-startup world owner. Repeated rejection leaves the
input untouched. There are no phase callbacks, certificate strings, reseeding
hooks, or placeholder successful frame results. The two reducers are selected
by a closed discriminated step type.

## Source And Startup

The [source prefix factory](../src/engine/source-native-world-state.ts) accepts
only executable and original SCN bytes, hashes both, and derives the eight
alliance bitsets, self-only initial shared-vision bitsets, and all RENAT records.
SCN `%TeamAllies` is eight indexed flags, not a list of team IDs; the original
scanner at `0x41bf45..0x41c029` sets self bits unconditionally. Configuration is
identity-branded and mutable outputs are detached. No native output is runtime
configuration.

This is deliberately **not** a full source-state factory. MAP/PTH terrain,
source FIN relocation, all raw220 constructors, type/dependency tables, full
game initialization, heaps, and mutable native globals still need one consistent
source-derived owner. Passing an explicit boundary to a prefix reducer does not
authenticate that boundary as original startup.

The [startup audit](../tools/qa/source-native-world-state-audit.ts) runs the
existing source loader using actual SCN/MAP/MTG/PTH and GAMESTAT/WEAPSTAT. It
invokes no triggers or cycles and compares all 800 raw records with original
first-entry bytes, separating the three FIN pointer fields from other bytes:

| Existing loader discrepancy | HUMAN02 | ALIEN02 |
| --- | ---: | ---: |
| FIN pointer byte differences | 177 | 396 |
| Other raw byte differences | 1,045 | 1,327 |
| Records with non-pointer differences, including unused slots | 788 | 788 |

The first registered mismatch is slot 0, team 0, type **16 / 28**. Native CITY
has animation modes `+1a/+22/+2a = 2`, observer `+35 = 255`, task depth `+38 = 1`,
tasks `[1,19]`, payload cursors 3/4, and constructor-specific payload/AI fields.
The general loader does not build that record; its `+38 = 255`. The first
unregistered mismatch is slot 15, `+08 = 1` natively versus 0 in the loader.
Copying only live actors or patching FIN addresses is therefore insufficient.
The existing bounded native-task constructor explicitly accepts living ground
actors on teams 0..7; it does not replace the CITY/resource/carrier constructors.

**Original startup tuples, resolved by the constructor follow-up:**

- `(HUMAN02, before cycle 1, 0x41b920 -> 0x444f14/0x437bc4, slot 0, team 0, type 16, owner source-native-world-state)`
- `(ALIEN02, before cycle 1, 0x41b920 -> 0x444f14/0x437bc4, slot 0, team 0, type 28, owner source-native-world-state)`

Current full-state blocker: `(HUMAN02/ALIEN02, before cycle 1, 0x43c388,
complete type/FIN tables and persistent allocation/global graph,
owner source-native-world-state)`. The new factory is a source SCN constructor
prefix, not a whole-world admission token.

The concrete completion condition is a source-only factory producing all 800
raw records, all native game/globals/heaps/planes and authentic type/dependency
tables with consistent FIN/address normalization, followed by one staged owner
that feeds each original consumer's actual output into the next. Until then,
oracle-seeded prefix or registered-phase successes cannot admit a whole cycle.

## Exact Prefix Rules

- Census clears category 1 of all 110 type counters and population category 6
  for each of eight teams. It scans raw **slot** 152..799 when that slot's registry
  entry is not -1, independent of HP/status and independent of the registry's
  stored target value. Other statistic classes and teams 8/9 remain unchanged.
- Population flags use the **previous** `game+528` cap, before recomputation.
  Every nonnegative commander in the four `game+1934+team*e30` words gets
  raw `+0a = e6` when census is at least that cap. Below-cap visits do not clear it.
- Clock increments `game+530` and `game+52c`, in original write order, without
  changing packet counter `game+94c`.
- Cap subtracts RENAT `+16` reserves from 648, counts status-nonzero raw mobile
  slots independently of registry, subtracts teams 0..8 that lack a colony,
  subtracts 100, divides toward zero by the number of teams with any nonzero
  CITY health in slots 0..4, and applies the current ceiling. Team 9 is not
  subtracted. There is no invented lower clamp.
- Relation cache uses mutual bits from the current alliance object, with stride
  10. Shared vision uses its distinct mutual-bit object plus the team's own
  `0x40000000 >> team` bit. Cache padding and rows 8/9 are untouched.
- Day wrap uses strict `elapsed > period`; transition uses signed native integer
  division. Unsupported arithmetic bounds reject without mutating caller state.

## Native First-Four Experiment

The first experiment ran the existing observer **before any edit**. The new
[observer](../tools/qa/native-world-cycle-native.py) then recorded eight complete
original world calls with zero runtime core interceptions. Original startup and
platform substitutions are inherited unchanged and remain listed in the trace.
No SCN AI mode, actor, phase, health, funding, or TRO condition was disabled.

| Entry/exit | HUMAN02 | ALIEN02 |
| --- | --- | --- |
| First packet counter `+94c` | 1 | 1 |
| First TRO counter `+52c` | 0 -> 1 | 0 -> 1 |
| First elapsed clock `+530` | 5100 -> 5101 | 5700 -> 5701 |
| Shared RNG at exits 1,2,3,4 | 10,10,10,15 | 30,30,30,32 |
| Cycle-4 selector teams | 2,3,4 | 1,2 |
| Cycle-4 actual full-policy calls | teams 3 and 4 | none |
| TRO calls through cycle 4 | 0 | 0 |

HUMAN's mode-3 calls are mandatory. They ran in the original; they were **not**
ported or skipped here. The previously proven ALIEN activation at 1160 is a
different suffix proof and does not supply fresh HUMAN policy initialization.

After source startup, the first uncomposed world interval is
`(cycle 1, 0x41981c, platform flags/timing, owner native-world-cycle)`, followed
by the first `+52c == 0` visibility clear/compute/dirty calls. Path stamp,
team maintenance, registered actors, projectiles, frame recording/reporting,
AI state and synchronous receipts, and timing must share the same candidate.
Existing separately verified owners have not been silently composed here.
TRO is not a reason to skip anything in calls 1..4; it first gates at 8.

## Verification

[Focused tests](../tools/qa/native-world-cycle.test.ts): **12 passed**, zero
failures/skips. Six additional source-disassembly-based controlled cases exercise
slot versus registry identity, dead-but-registered census, preserved statistic
classes and commander flags, zero/multiple colony cap arithmetic, asymmetric
alliances, separate vision, cache padding, and independent clocks. These controls
are labeled separately from the fresh original oracle comparisons.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/native-world-cycle-native.py --mission HUMAN > /tmp/world-human.json
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/native-world-cycle-native.py --mission ALIEN > /tmp/world-alien.json
DC_WORLD_PREFIX_HUMAN_TRACE=/tmp/world-human.json \
DC_WORLD_PREFIX_ALIEN_TRACE=/tmp/world-alien.json \
  node --import tsx --test tools/qa/native-world-cycle.test.ts
DC_WORLD_PREFIX_HUMAN_TRACE=/tmp/world-human.json \
DC_WORLD_PREFIX_ALIEN_TRACE=/tmp/world-alien.json \
  node --import tsx tools/qa/source-native-world-state-audit.ts
```

Without trace variables the focused tests regenerate both four-call captures.
Local evidence: `/tmp/dc-world-prefix-{HUMAN,ALIEN}-20260922-w08.json`,
`/tmp/dc-world-prefix-tests-20260922-w15.log`, and
`/tmp/dc-world-startup-audit-20260922-w16.log`.
Strict ES2022 / ES2023,DOM no-unused scoped checks and editor diagnostics passed.
No agents, browser, full suite, packages, or assets were used or changed.