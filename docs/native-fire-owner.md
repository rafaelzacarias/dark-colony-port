# Native Ordinary Attack Owner

Date: 2026-09-19. Source-separated pure owner, not original mission admission.

## Accepted Visit

[legacy-ai-task](../src/engine/legacy-ai-task.ts) now completes original `0x419248`
visits through task6 Attack guard1 or idle acquisition, `0x41481c`, turn,
`0x412d00`, `0x441710` projectile launch and task11 reload. It uses existing
source relation/type/visibility acquisition; no preselected target is installed.
Turning visits complete without firing RNG. Launch visits commit a real native
pool candidate, not an instant-damage call or an unconsumed spawn promise.

[legacy-native-fire](../src/engine/legacy-native-fire.ts) owns the bounded launch.
Supported type/weapon pairs are 0:1/2/3, 8:15/16/17, 69:5 and 73:62. Source team
weapon selection, variant count and FIN bank pointers are inputs, not base-weapon
constants. Source profiles must be authenticated by the caller. Range remains
closed to the verified ordinary ground-target envelope. Nonzero altitude,
nonzero spread, delayed/multiple muzzle markers, burst reload, other weapons,
special abilities and general pursuit remain rejected. Nonzero spread/muzzle
construction arithmetic is not an admitted profile.

The original BOOMSTAT loader `0x43b344` and weapon FIN binder
`0x43b84f..0x43b955` execute in the oracle. Missing explosion/weapon FIN states
come from ANIM.DAT source files; native duration conversion and bank fallback
execute normally. Pointer relocation keeps these banks separate from actor banks.
The admitted source weapons have BOOM id0 and zero muzzle markers. Tests do not
claim nonzero spread proof from those zero-spread cases. Type8/weapon15 positively
constructs a nonzero projectile animation bank, including its untouched padding.

## Caller Contract

Supply existing source `world.combat`, source `world.fin` delays including every
actor fire variant, and `world.nativeFire`: all32 direction arrays of raw72 FIN
timeline records plus BOOM spread bytes starting at source `0x4f9144` (stride136).
These are source tables, never captured launch answers.

Supply `frame.projectiles` on every owned visit:

- `records`: all2024 native records, stride40, including untouched bytes.
- `highWater`: native GAME+0x7d24 allocation counter.
- `heads`: signed16 free and active heads at GAME+0x468e8/+0x468ea.
- `statistics`: all96 signed dwords at `0x4956e0`, team stride12. Launch increments
  the source team's event8 count with native 32-bit wrapping.

The owner validates pool chains, allocates from the free list or high-water,
preserves unwritten bytes, links the active list, writes position/velocity/source/
weapon/direction/lifetime/status/FIN state and returns full replacement pool data.
Native allocation asserts when incremented high-water reaches2024; that boundary
rejects atomically. A projectile's `+12` dword contains weapon/source words;
its `+24` dword contains lifetime/direction words. Tests compare all80960 pool
bytes, not merely a decoded spawn shape.

Pass the current shared `rngCursor` and source256-value table. The admitted
launch advances twice: fire variant, then projectile random byte. The reducer
never resets RNG. Pass actual scheduler counter and task6 budget each visit;
the test caller resets that budget at explicit scheduler boundaries, not inside
the reducer. FIN preamble and `actor+0x10` low-five-bit countdown execute first.

Commit successful actor raw220, exact task stack, ground/ordered writes, RNG,
task6 budget, projectile pool/statistics and pending receipt together. `spawns`
contains the allocated slot/raw40 and a typed sound event for presentation.
`combatGate.readyAttackVisit` is true only for a completed fire-path visit;
`readyEndToEndCombat` is always false. `requiredOwners` names
`projectile-travel-collision-damage` and `session-atomic-projectile-commit`.
Do not turn the sound/spawn event into immediate target damage.

Without both fire tables and pool ownership, the previous hostile
`supported:false`/`combatHandoff` contract remains. No pending receipt may clear
from that prefix. No transport, session or source-options factory was edited.

## Reload And Stop

Launch pushes task11 with source timer15. Fifteen visits decrement to zero;
the next visit pops without redispatch. The following visit can reacquire/fire,
giving17 visits between launches. Completed fire animation resets to stand.
Stop stays pending through every reload visit, including the zero-entry pop.
Types0/8 accept Stop at the next task6 boundary; 69/73 with energy for task13
reject that entire accepting visit and retain the last committed pending state.

## Evidence

[Probe](../tools/qa/native-fire-native.py) and
[tests](../tools/qa/legacy-native-fire.test.ts):30 fresh isolated native worlds,
710 original registered visits;708 accepted byte-exact visits and two expected
special-Stop rejections.58 projectile launches and116 firing RNG advances.
Coverage includes both idle and Attack acquisition, real constructor headings,
turning, every owned base type, 0/8 weapon levels1/2, RNG wrap, poisoned unused
pool bytes, noncontiguous free-list reuse, new high-water allocation and Stop.

Original ALIEN02 slot152/team0/type8 remains at its source placement. It acquires
a genuinely hostile constructor-backed target through scout-generated visibility;
both idle and Attack cases run at base and upgraded levels. Upgrade cases alter
only a labelled SCN unit-row input before the original scanner. They prove
controlled upgrades, not historical ALIEN02 upgrades. Other sources/targets are
explicit isolated constructor fixtures. Poison/free-list inputs are labelled in
`fireOptions`; they are not claimed as naturally evolved projectile history.

Relations matter: ALIEN02 teams1/2 are allied; team0 is hostile to1.
HUMAN02 source team1 uses hostile team2. Positive selected-target and shot-count
assertions prevent false-friend or no-shot fixtures from passing. Candidate
raw220 remains unchanged; no projectile travel pass is executed in these cases.

Current evidence: `/tmp/dc-native-fire-validreuse-20260919-e27iOo`.
34 fire tests and 35 projectile tests pass together:
`/tmp/dc-validreuse-owned-tests-20260919-IwuK2c`.
223 existing acquisition/movement/handler regressions pass:
`/tmp/dc-validreuse-neighbors-20260919-dRKZFA`. Scoped strict typecheck passed:
`/tmp/dc-validreuse-types-20260919-BD7KYy`.
No agents, browser or full suite ran.

### Poisoned Reuse Fixture Correction

The shared setup in [nativeactor-task-native.py](../tools/qa/nativeactor-task-native.py)
now links all three allocated slots: free `0 -> 2 -> 1 -> -1`, active `-1`,
high-water3. The superseded `/tmp/dc-native-fire-final-g3.jsonl` had
`0 -> 2 -> -1`, leaving slot1 unreachable with its next word still `0xa5a5`.
Native allocation does not initialize that word. The repair changes only slot1's
next word at record-buffer offsets60/61 to `-1` and slot2's at100/101 to `1`.
Every other input byte is preserved, including all poison outside the link words.
Tests pin the complete80960-byte input, high-water, heads and output reachability.

Both full30-case matrices were freshly executed, not patched from old outputs.
Across1880 before/after pool snapshots, only those link words and the resulting
native free-head continuation to slot1 differ; all other trace fields are equal.
All non-reuse rows are wholly unchanged. Old trace files were not overwritten.
Separate TypeScript-only orphan controls reject before registered/projectile
dispatch without caller mutation, retaining the allocated-slot orphan-head
regression. These are runtime admission checks, not evidence that the original
native executable validates or rejects unreachable slots; it may ignore them.
Runtime validators and original scatter logic were not changed by this repair.

`DC_NATIVE_ACTOR_MOVEMENT_TRACE=/tmp/dc-ai-task-movement-20260919-g1.jsonl`
remains unaffected: all84 rows have no `fireOptions`, native fire tables or pool
snapshots. The movement-suite entry point never supplies the repaired options.

Reproduce with `PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918`
and `python3 -B tools/qa/native-fire-native.py --suite`; `--case N` selects one
fixture. Run `DC_NATIVE_FIRE_TRACE=<jsonl> node --import tsx --test
tools/qa/legacy-native-fire.test.ts`. Without the trace variable the test regenerates
the suite. Temporary captures are evidence only, never runtime lookup tables.

## Remaining Gate

The separate [bounded projectile owner](native-projectile-owner.md) now proves
real launch-to-travel-to-nonlethal-damage and pool reclamation for these ordinary
weapons, including commander FIN impacts. It requires complete source collision
geometry and normalized armor tables in addition to this fire-only profile.
It is not wired into a shared host/session; lethal and general-effect paths remain
rejected. The fire owner's `readyEndToEndCombat` remains false.

The future session owner must authenticate and atomically account for this pool,
statistics, shared RNG ordering and receipt state, including replay/checkpoints.
It must integrate the bounded original projectile passes (`0x44293c` / `0x4423f8`)
with current actor/occupancy state and authenticated projectile/effect FIN bindings,
and provide owners for target death and larger effects. Existing damage helpers
alone do not satisfy that gate. This is a ready bounded attack visit and a separate
verified nonlethal continuation, not a playable end-to-end native combat world.