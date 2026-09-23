# Native Occupied Ground Route

## Integrated Follow-Up

The pending7 helper is now wired and `groundRoute.randomizedEndpoint: true`
owns the source endpoint retry. The combined opt-ins complete all native
boundaries1..32: HUMAN1,039 / ALIEN1,592 exact visits. Occupied-only routing
retains HUMAN16/29 endpoint rejections; ALIEN now completes32 without the new
endpoint option. Each test still starts from its original native boundary.
See [source proof and remaining scheduler limits](native-route-gaps-20260922.md).
The counts and blockers below record the previous occupied-only handoff.

## Result

HUMAN02 packet 16 slot 161/type 8 now matches the original occupied-path branch
`0x415458 -> 0x41518c -> 0x444540`, including both local searches, serialized
path, raw220/task stack, RNG 67 -> 67, and task6 budget 0 -> 2.

Enable the new owner explicitly with `groundRoute.occupiedPath: true` in
[native-registered-host](../src/engine/native-registered-host.ts), alongside the
existing authenticated ground-route/task9 sources and source MOVE relocations.
Omitting it preserves the previous ground-route/task9 contracts and gates.
No other agent was launched; this change owns registered-host integration only
for occupied routing, not the separately assigned ALIEN pending-task6 helper.

**32 contiguous registered phases are still blocked.**

| Source | Contiguous phases | Visits in prefix | Independently complete phases in 1..32 | Visits in complete phases | Exact visits including rejected prefixes |
| --- | ---: | ---: | ---: | ---: | ---: |
| HUMAN02 | 15 | 427 | 30 | 967 | 1,001 |
| ALIEN02 | 24 | 1,176 | 31 | 1,540 | 1,586 |

Each diagnostic phase begins at its explicit original source boundary. Later
successful phases do not provide a portable continuation across a rejected
phase. Rejected hosts retain all original state and retry deterministically.
Admission and executable-whole-game flags remain false.

## Source Behavior

[The ground-route helper](../src/engine/legacy-native-ground-route.ts) implements
the original local-search initialization, not generic A*. `0x444540` increments
the stamp, fills the 256-byte family mask with 255, excludes ground family 0 and
border family 255, initializes the original circular bucket queue, expands the
origin, then executes at most 256 queue pops. It reuses the already verified
eight-direction `0x443298/0x4443c4` expansion, original costs, equal-cost
replacement, diagonal corner rules, and southwest cost-index asymmetry.

Dynamic passability reads current ground words: low10 1023 is empty; actor IDs
and reservation 1022 remain blocked regardless of terrain/visibility upper bits.
The source grids are 96x84. Search state is the real 0x990ac-byte work buffer,
not a replacement route graph. Bounds, source PTH fields, dynamic/air caller
state, raw actor type/task, and the actor's current reservation are checked.

The caller scans forward through occupied route cells to the first free endpoint.
`0x41518c` temporarily releases only its own origin reservation in a private
search input, exactly as the source does, then preserves the actual ground plane.
No other actor or moving reservation is cleared and no terrain flags are changed.
The native distance code is 0x8000 when unreachable. Successful paths use the
existing backwards nibble serializer and source splice offsets, preserving
unused nibbles and updating task6 correction coordinates/cursor. The next task6
dispatch reruns correction until reaching that coordinate. Unreachable local
search follows the source allied displacement-byte check and two-word wait
initializer; long local chunks beyond 32 steps remain guarded.

## Next Unowned Gates

- HUMAN packet 16, slot 173/type 25, entry task 3: occupied scan reaches the end
  without a free point. `0x4155d5` pops/replans through randomized endpoint
  correction and `0x414ce4`. Original calls advance RNG 67 -> 69 -> 71 -> 73;
  the portable owner rejects before this branch. HUMAN packet 29 slot 157/type 8
  reaches the same unowned endpoint-correction family.
- ALIEN packet 25, slot 194/type 25, entry task 6: pending opcode 7 still requires
  `0x4157ec -> 0x412014 -> 0x416104 -> 0x414ce4`. This assignment does not own it.

There is no guard weakening, fake empty terrain, substituted actor, ignored
dynamic occupant, flight fallback, or changes to legacy-ai-task, scheduler,
sessions, packages, or assets. Original setup/platform substitutions remain as
documented by the inherited native harness; runtime core interceptions are zero.

## Verification

[Focused tests](../tools/qa/legacy-native-ground-route-occupied.test.ts) compare
12 actual local-search calls / 12,840 ordered internal writes and 12 complete
`0x41518c` caller raw/scratch/reservation results from original HUMAN packet16.
The probe observes original continuous execution; it does not restore a partial
machine snapshot to synthesize these occupied calls. The optional `--occupied`
observer is in [the native probe](../tools/qa/legacy-native-ground-route-native.py).

Tests also cover low10 actor/1022 blockage, upper-bit independence, native
unreachable distance, bounds/air rejection, caller immutability, per-visit full
game/dependency deltas, RNG/budget/registry, and complete phase game/planes/scratch/
dependencies/CRT/FIN. The retained 38 coarse-route triples / 25,955 ordered writes
and all 16 direct coarse/serializer controls remain unchanged. Existing task9
tests run without the new option and retain their prior gates.

All 25 focused tests pass: four occupied-route, six prior ground-route, five
task9, and ten registered-host checks. Scoped strict ES2022 / ES2023,DOM
no-unused typechecking and editor diagnostics are clean. Final occupied/delta
checks are in `/tmp/dc-occupied-final-o14.log`, types in
`/tmp/dc-occupied-types-o14.log`, preserved route/task9 contracts in
`/tmp/dc-occupied-focused-o10.log`, and host baseline in
`/tmp/dc-occupied-host-o13.log`.

New source capture: `/tmp/dc-occupied-human16-o01.json`, SHA-256
`b9a0df196fcda0aa3f54074e20c17aa925cac2943cb7debc009a3d1dc1aedbe0`.
The original 40-cycle HUMAN/ALIEN p34 captures remain unchanged. Without trace
environment variables the tests regenerate source captures. No browser, agents,
full suite, package/assets changes, or runtime oracle injection was used.

```sh
node --import tsx --test tools/qa/legacy-native-ground-route-occupied.test.ts
```