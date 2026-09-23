# Native Ground Route: Packet 8

Final combined integration: [32 exact registered boundaries in both source worlds](native-route-gaps-20260922.md),
including opt-in occupied routing, source randomized endpoints, and pending7.
This is independent native-boundary parity, not whole-world TypeScript cycles.

Task-9 continuation: [packet-16 results and exact next blockers](native-task-nine-20260922.md).
The counts below describe the original ground-route-only configuration, which
remains unchanged. The task-9 opt-in extends ordinary troop movement separately.

## Result

The opt-in registered owner now completes packets **1 through 15** for both
unchanged fresh HUMAN02 and ALIEN02 source histories. Packet 8 consumes the actual
new type-25 RNAT path and first movement step. No actor, TRO action, HP, funds,
position, pending command, or FIN state is substituted in those positive runs.

| Mission | Native visits, packets 1..40 | Complete portable phases | Visits in complete phases | Exact visits including rejected-phase prefixes |
| --- | ---: | ---: | ---: | ---: |
| HUMAN02 | 1,327 | 15 | 427 | 627 |
| ALIEN02 | 2,008 | 15 | 708 | 1,208 |

There are **1,135 committed-comparable registered visits**, up from 455. The
prefix column includes detached diagnostics from failed transactions, not
additional committed phases. Native packets 1..32 retain the previous exact
counts of 1,039 HUMAN / 1,592 ALIEN visits. Both fresh histories execute through
packet 40, covering packet 8 plus the next 32 original cycles, with zero runtime
core interceptions. Portable packets 16..40 reject atomically.

Both source MAP headers and the original runtime report **96 x 84**, not 128 x
128. These captures do not claim a resized map or a 128 x 128 positive fixture.

## Packet 8 Proof

| Mission | RNAT slot | Actor origin | Corrected destination | Path steps | Packed bytes | Search expansions / writes |
| --- | ---: | --- | --- | ---: | --- | --- |
| HUMAN02 | 182 | (42,5) | (48,6) | 6 | `47 44 44` | 7 / 668 |
| ALIEN02 | 198 | (6,54) | (12,52) | 6 | `44 22 44` | 8 / 690 |

The search runs backward from the corrected destination to the actor. The actor
then consumes packed nibbles from cursor 5 downward. The first step is +30 Q8 on
X in both branches, with the original speed 30, turn step 25, real RNAT MOVE
FIN bank, task stack, reservation, and neutral-team occupancy behavior. Team 9
does not write player visibility-history bits. Neither path helper draws RNG or
CRT random values. Stamp `0x47a980` advances 16 -> 17 at search and 17 -> 18 at
serialization. Full packet-8 phases contain all 35 HUMAN / 50 ALIEN actors.

The successful phase tests compare the complete game buffer, every actor raw220,
all three occupancy planes, dependencies, production flag, shared RNG, CRT state,
task budget, carrier FIN input, and complete route scratch. Full game equality
includes HP, financial fields, registry, packet counter, and independent resource
counter. There is no scalar normalization or actor filtering.

## Source Algorithm

- [Portable route owner](../src/engine/legacy-native-ground-route.ts)
- [Registered integration](../src/engine/native-registered-host.ts)
- [Original-body observer and direct controls](../tools/qa/legacy-native-ground-route-native.py)
- [Focused comparisons and rejection controls](../tools/qa/legacy-native-ground-route.test.ts)

The implementation follows `0x44492c`, expansion `0x443298`, circular-bucket
consumer `0x4443c4`, distance `0x44302c`, and serializer `0x4430b0`. It is not a
generic A* replacement. It retains the source family chain, 256 bucket heads,
linked-list insertion/unlink order, equal-cost replacement, closed-node marker,
directional cost table, predecessor bytes, dynamic occupancy filtering, and
stamp writes. In particular, the blocked-west southwest branch at `0x4440e3`
uses cost index 1 rather than the usual southwest index 6; that asymmetry is
preserved and required by the native scratch comparisons.

All **38 naturally observed search/distance/serialization triples** through
packet 40 compare every scratch byte and ordered non-stack write: 28 HUMAN
paths, lengths 0..14; 10 ALIEN paths, lengths 3..8. There are **25,955 exact
search/serializer writes**. Expansion counts are independently checked against
the native worker's stamp-write count, not just the portable loop count.

Sixteen additional labeled direct controls execute original bodies after the
unmodified histories. They are not original gameplay:

- Static and dynamic occupancy pairs retain actual source cells and occupants.
- Odd output offset, shortened count, and zero count start with poisoned output
  bytes, proving unused-nibble preservation and little-endian byte writes.
- Long connected source routes return 91 HUMAN / 88 ALIEN steps, with exactly
  385 / 354 expansions and 13,023 / 12,166 search writes. Original serialization
  of the first 32 route nibbles matches all 98 writes, including the extra stamped
  predecessor and final global stamp.

Serialization is a direction-nibble stream, not Q8 position pairs. It walks
until the absolute output cursor reaches -1 or the predecessor is self. A
nonzero starting offset does not impose a separate lower-bound stop. It returns
the requested count even if the self predecessor terminates earlier. The tests
preserve these observed semantics rather than correcting them.

## Runtime Contract

`createLegacyNativeGroundRouteSource` privately copies and authenticates the
original EXE, mission MAP, and PTH before asynchronous hashing. It reads the
65,536-byte directional prefix and family grid directly from PTH, and costs and
direction codes from EXE. No capture JSON, precomputed path, or oracle profile is
a runtime configuration input. The existing navigation mask helper does not
implement this search. Movement uses the existing verified harvester integer
trigonometric tables; no floating-point angle approximation is introduced.

Pass that factory identity as `groundRoute.source` to
`createNativeRegisteredConfiguration`, together with the explicit RNAT MOVE-bank
relocation and original WEAPSTAT bytes. FIN durations come from authenticated
RNAT.FIN, not a stand-bank alias or no-op animation. The weapon source and EXE
scan rings establish a conservative no-target acquisition branch for team 9's
all-player visibility mask. An eligible visible target rejects at `0x435570`.

The current registered boundary supplies `groundRoute` state: relocated address,
all `0x990ac` path scratch bytes, stamp, family mask, neighbor scratch, and explicit
dynamic/air flags. It is current caller state, not authenticated startup output.
The source factory remains separate from current-state provenance. Shared buffers,
forged source identities, wrong mission/map relocation, changed source family or
prefix bytes, and stamp overflow reject. Scratch/output are copied; neither
failure diagnostics nor successful returned snapshots can mutate the host.

The primitive has native-positive dynamic occupancy controls. Registered route
construction currently admits only the observed static ground-search caller;
dynamic/air caller setup, occupied-step replan `0x415458`, trip callback
`0x43e530`, attack acquisition, other route modes/types, and route continuation
beyond the retained chunk remain closed. Search expansion is bounded by source
grid area; a budget rejection cannot commit partial scratch or actor changes.

## Next Consumer

| Mission | Packet | Slot / type | Entry task | Pending bytes | Actual next original dispatch |
| --- | ---: | --- | ---: | --- | --- |
| HUMAN02 | 16 | 156 / 8 | 3 | `[1,9]` | `0x4122c8 -> 0x4148b0 -> 0x412014 -> 0x416198` |
| ALIEN02 | 16 | 168 / 0 | 3 | `[1,9]` | `0x4122c8 -> 0x4148b0 -> 0x412014 -> 0x416198` |

This is ordinary-troop **pending opcode 9 / task 9**, not another RNAT route
failure. The original then calls `0x414ce4`, the now-tested path helpers, task 6,
and turning. HUMAN HP remains 800 at Q8 (13184,7296); ALIEN HP remains 400 at
(16768,14464). Both have two waypoints. Subsequent source phases require their
real MOVE FIN and movement consumers. Those owners were not broadened here.

No full mission, shared scheduler cycle, checkpoint replay, next-mission
admission, or 32 complete portable phases is claimed. Each tested registered
phase starts from its explicit original boundary; unsupported world phases
between boundaries are not replayed by this owner. The existing scheduler and
session integration remain unchanged. Configurations without `groundRoute`
retain the prior seven-phase behavior and pass all ten existing baseline tests.

## Verification

Six focused route tests and ten prior registered-host tests pass, with no skips.
Strict ES2022 / ES2023,DOM, no-unused typechecking and editor diagnostics pass.
No browser, agents, full suite, assets, packages, or unrelated runtime modules
were changed. The only existing runtime file edited is the registered owner.

Final native captures:

- `/tmp/dc-ground-HUMAN-40-p34.json`, SHA-256
  `a6ce670497885d6e3d8c861e0f62cc6f22892b87d30d2e5bd1795c4f71ba0717`.
- `/tmp/dc-ground-ALIEN-40-p34.json`, SHA-256
  `38ff5df9524b275e3b252c92433731c6aac567aa73c3e682e41c4148d2790e59`.

Large raw-buffer strings use a `z:` prefix for zlib-compressed base64; this is
lossless QA storage only. Ordered writes and all phase records remain present.
Native control wall measurements include Unicorn hooks/capture overhead and
are not original game timing or browser performance measurements.

Logs: `/tmp/dc-ground-final-tests-p37.log`, `/tmp/dc-ground-baseline-p32.log`,
`/tmp/dc-ground-types-p35.log`, `/tmp/dc-ground-evidence-p36.log`.

```sh
node --import tsx --test tools/qa/legacy-native-ground-route.test.ts
```

Without saved captures this runs each original 40-cycle probe once. Optional
`DC_GROUND_HUMAN_TRACE` and `DC_GROUND_ALIEN_TRACE` select saved captures. The
probe reuses the installed Capstone/Unicorn libraries and inherited source
startup harness. Its original loader substitutions and platform boundaries are
unchanged; zero runtime core interceptions is not a stub-free startup claim.