# Native Task 9: Packet 16

## Integrated Follow-Up

The production pending7 integration advances task9-only ALIEN coverage to31
complete native phases/1,540 visits, with1,588 exact visits including the rejected
phase32 prefix. Its remaining gate is occupied routing at slot196/type25.
HUMAN task9-only coverage is unchanged. The combined occupied and randomized
endpoint options now complete32 boundaries for both worlds; see
[the source proof and scheduling caveat](native-route-gaps-20260922.md).
The original counts and next blockers below are historical handoff evidence.

## Result

The opt-in registered owner now consumes the actual pending opcode 9 on HUMAN02
slot 156/type 8 and ALIEN02 slot 168/type 0 at packet 16. The source handler is
**cyclic waypoint movement**, not teleportation, abduction, carrier pickup, or
retirement. Both original actors retain their HP, source waypoints, and position
until the real route/turn/movement consumers update them.

**32 complete contiguous registered phases are not reached.** A new occupied-path
consumer blocks HUMAN packet 16 later in that same phase. ALIEN packet 16 is
complete, including the original same-cycle type-69 constructor output; its first
remaining rejection is packet 25.

| Source | Consecutive complete phases from 1 | Visits in that prefix | Independently complete phases in 1..32 | Visits in complete phases | Exact completed visits including rejected-phase prefixes |
| --- | ---: | ---: | ---: | ---: | ---: |
| HUMAN02 | 15 | 427 | 26 | 823 | 945 |
| ALIEN02 | 24 | 1,176 | 30 | 1,488 | 1,582 |

The 56 independently complete phases contain **2,311 visits**. Each starts from
its explicit original boundary. Later successful boundaries are not portable
continuations across a rejected phase, and these are not complete shared-world
cycles. Native 1..32 totals remain 1,039 HUMAN / 1,592 ALIEN visits. The inherited
40-cycle captures retain 1,327 / 2,008 visits and zero runtime core interceptions.
Their platform/startup substitutions are unchanged.

## Source Semantics

- `0x4122c8` interrupts task 3 on a pending command before comparing HP/countdown.
- `0x4148b0 -> 0x412014` clears the old task stack and pending flag, dispatches
  opcode 9 through initializer `0x416094`, then clears pending opcode to 255.
- `0x416094` requires a moving type and pushes task 9 with one zero word.
- `0x416198` compares the signed cursor with waypoint count `raw+0xc6`, wraps it
  to zero when exhausted, copies `+0xa6/+0xa8 + cursor*4` to `+0x2e/+0x30`,
  increments the cursor, and calls `0x414ce4` with mode 1 and correction flag 0.
- Pending bytes are `+0x36/+0x37`; `+0xc6` is waypoint count, not task opcode.
- The registered loop still resets task-6 budget to zero per actor/index. Task 9
  itself draws no RNG. The two original packet-16 target visits each end with
  budget 1 and unchanged shared RNG.

[The new handler and troop route caller](../src/engine/legacy-native-task-nine.ts)
reuse the verified search/distance/serializer primitives. The existing route
module remains unchanged, including its RNAT-only caller guard. The new caller
authenticates and privately copies EXE/MAP/PTH through the existing source
factory, derives original tables and families from those bytes, and checks
current scratch against them. No captured paths, native profiles, oracle deltas,
callbacks, or substitute actor types are runtime inputs.

[The registered host](../src/engine/native-registered-host.ts) accepts optional
`groundRoute.taskNine` from `createLegacyNativeTaskNineSource` plus explicit
`troopMoveBanks` relocations for types 0 and 8. With that option it additionally
requires the real type-69 stand relocation. FIN names and all directional frame
durations come from authenticated TRSC/GRAY source timelines. Type 69 shares the
source TRSC animation mapping, but retains its own relocation and GAMESTAT row.
Caller-owned current buffers and relocations remain distinct from authenticated
static sources. The troop no-target check conservatively rejects any eligible
visible hostile in the map; it does not implement target selection.

The source counters remain independent: `game+0x94c` is the packet counter,
`game+0x530` is 5100 + packet for HUMAN and 5700 + packet for ALIEN. There is no
normalization, HP/status filtering, actor omission, or skipped dying actor.
Unsupported status/damage/FIN states reject the whole phase.

## Exact Next Blockers

| Source | Packet | Slot / type | Entry task | Pending | Source behavior |
| --- | ---: | --- | ---: | --- | --- |
| HUMAN02 | 16 | 161 / 8 | 3 | `[1,9]` | Task 9 reaches task 6, then occupied-path `0x415458 -> 0x41518c` |
| ALIEN02 | 25 | 194 / 25 | 6 | `[1,7]` | `0x4157ec -> 0x412014 -> 0x416104 -> 0x414ce4`, then task 6/turn/move |

HUMAN slot 161 has HP 800, resource counter 5116, two waypoints, native RNG
67 -> 67 and budget 0 -> 2. Thirteen earlier visits in that phase compare exactly
but are not committed. The occupied branch scans ahead, may dynamically reroute
through `0x41518c`, can write another actor's displacement byte, and can push a
wait. Original packet 16 performs additional distance/serialization calls and
turns. This is not a missing task-9 initializer or a safe empty-cell fallback.

ALIEN slot 194 has HP 750, resource counter 5725, one new waypoint, native RNG
105 -> 105 and budget 0 -> 2. Forty-six earlier visits compare exactly but are
not committed. The current task-6 guard rejects its pending order before the
native reinitialization branch. Later original boundaries 26..31 can compare
independently; they do not bypass this rejection in a running host.

All rejected packets in 1..32:

- HUMAN: 16/161, 24/175, 29/157, 32/181 occupied paths; 30/173 and 31/163 have
  dynamic correction payloads that remain unowned.
- ALIEN: 25/194 pending task-6 order; 32/196 occupied path.

No additional guard widening was performed after identifying these consumers.
Dynamic rerouting, trip callbacks, active acquisition/combat, route continuation
beyond the retained chunk, damage/death, and shared-world ordering remain closed.
`sourceNativePolicy`, scheduler admission, sessions, and checkpoints are untouched;
both success and failure still report `admitted:false` and
`executableWholeGame:false`. HUMAN01/ALIEN01 source initialization was not
validated by this continuation; it uses the documented HUMAN02/ALIEN02 boundaries.

## Verification

[Focused task-9 tests](../tools/qa/legacy-native-task-nine.test.ts) compare all 14
natural task-9-to-route handoffs, raw220/task stacks, every game/dependency byte
delta for completed visits, RNG, budget, and registry high water. Complete phases
compare full game, all occupancy planes, route scratch, dependencies, production
flag, CRT state, and carrier FIN. Rejected phases leave the host unchanged on
repeated attempts. Additional checks cover source mutation during asynchronous
authentication, forged source identities, invalid relocations, malformed handler
entries, late dying/type-69 FIN failures, counter mismatch, and corrupted scratch.
Rejected-phase prefix counts prove raw/game-delta/RNG/budget parity, not a committed
occupancy result for the rejected phase.

The prior six ground-route and ten registered-host tests also pass unchanged,
including all 38 source route triples / 25,955 ordered writes. Scoped strict
ES2022 / ES2023,DOM no-unused typechecking and editor diagnostics pass. No agents,
browser, full suite, package/assets changes, or legacy-ai-task edits were used.

Evidence reuses the unchanged original captures:

- `/tmp/dc-ground-HUMAN-40-p34.json`, SHA-256
  `a6ce670497885d6e3d8c861e0f62cc6f22892b87d30d2e5bd1795c4f71ba0717`.
- `/tmp/dc-ground-ALIEN-40-p34.json`, SHA-256
  `38ff5df9524b275e3b252c92433731c6aac567aa73c3e682e41c4148d2790e59`.

Without `DC_GROUND_HUMAN_TRACE` / `DC_GROUND_ALIEN_TRACE`, the new test regenerates
the original 40-cycle captures using the existing native observer. Native source
disassembly and first-blocker extracts are in `/tmp/dc-task9-next-source-a06.log`
and `/tmp/dc-task9-exact-next-blockers-a10.jsonl`.

```sh
node --import tsx --test tools/qa/legacy-native-task-nine.test.ts
```