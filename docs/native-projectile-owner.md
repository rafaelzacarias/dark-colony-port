# Bounded Native Projectile Owner

Date: 2026-09-19. Source-separated computation, not mission/session admission.

[legacy-native-projectiles](../src/engine/legacy-native-projectiles.ts) exports
`reduceLegacyNativeProjectiles`, its frame/result/table types, and
`LEGACY_NATIVE_PROJECTILE_SOURCE_PROJECTIONS` for a future authenticated provider.
It continues real [native fire](native-fire-owner.md) output through original
`0x44293c`: four `0x4423f8` travel substeps, `0x434f6c` collision selection,
ordinary direct `0x441930` damage, FIN tick, and `0x44168c` reclamation.

## Admitted Contract

Weapons 1/2/3 on type0, 15/16/17 on type8, 5 on type69, and 62 on type73;
BOOM0 width1, ordinary style0, lifetime -1, grounded source and collision target,
source control flag+d0=0, and explicitly zero SourceInspire at actor+d6.
Only positive, nonlethal damage is committed: entry health must exceed the exact
computed damage. Equality rejects the whole pass with
`native-projectile-death-owner-required`. No instant death, partial health write,
task replacement, occupancy release, or invented death animation is published.

Call once with `phase: "after-actor-visits"` after the owned actor visit phase.
The tag is a caller assertion, not scheduler authentication. Inputs are:

- Full 2024*40 projectile records, high-water, signed free/active heads and all96
  statistics dwords, using `LegacyNativeProjectileState` from the fire owner.
- All800 raw220 actors at this phase, including inactive/unrelated slots.
- Current ground/air/extra occupancy, PTH families, runtime relation bytes,
  dimensions, original GAME+53c policy, and shared RNG cursor.
- Source tables described below, including all referenced projectile/impact FIN
  banks. Bank0 genuinely needs no FIN entry; nonzero banks never silently fall back.

On success atomically commit replacement actors, pool and RNG. Occupancy,
registered actor list, PTH, high-water and statistics are unchanged by this
nonlethal pass. Fire remains the statistics event8 owner. Reclamation preserves
all unwritten pool bytes and prepends freed slots in native traversal order.
`impacts` and `reclaimed` are output receipts, not instructions to apply damage
again. On rejection the caller retains every input, including its last committed
projectile position and RNG; do not commit a prefix or skip that projectile.

Damage follows signed32 multiply/shift stages: source MBULLET Q8 coefficient,
weapon damage, explicit uninspired256 multiplier, the target team's selected
native armor coefficient, then the source-race/original-policy 3/4 reduction.
Actor+c7/c8/c9 feedback bytes are reproduced as well as HP. Grounded troop hits
are 25/31/37 in the base fixture; commanders hit40. Controlled source armor
levels1/2 yield29/24, or21/18 under the alternate original policy.

Projectile position advances before collision. Collision scans columns, rows,
then air/ground/extra, using native score and strict-greater tie selection,
rectangle bounds, source-team exclusion and the final alliance check. It does
not implement a terrain-wall stop: source PTH walls can be crossed, and an empty
shot expires when its signed age exceeds the weapon age limit (36 substeps for
the captured troop profiles). Native collision itself does not categorically
exclude aircraft. An intersecting aircraft is explicitly rejected by this owner;
the aligned aircraft fixture instead misses because of its real rectangle.

Commander impact consumes one shared RNG value and enters projectile status2.
The original mode1 FIN timeline runs until its mode byte reaches2, then status4
is reclaimed by the same wrapper. Native effect banks and RNG wrap are compared,
not replaced by a fixed presentation lifetime. General status3 effects, delayed
shots, trajectories, splash, healing, city collision, nonzero SourceInspire,
dead/removed sources, airborne hits and lethal task chains remain blocked.

## Required Source Projections

The exported projection descriptor records source addresses and layouts. A future
provider must authenticate EXE, GAMESTAT, WEAPSTAT, MBULLET, BOOMSTAT, FIN/SPR and
scenario inputs, and bind these projections to the current world:

- `typeTable`: all110*280 records. Execute the loader's armor normalization,
  retain the SCN team's actual weapon/armor levels, and supply collision
  rectangles derived from the stand FIN children and SPR frame geometry.
- `weapons`: all80*72 normalized records, including age, damage class, BOOM,
  trajectory flag and projectile/impact FIN pointers/counts.
- `boom`: all13*136 source records. Only id0/width1 is admitted.
- `damageTable`: native signed16 Q8 MBULLET rows, not source percentages.
- `fin`: each referenced relocated bank maps to all32 direction delay arrays,
  with the original native duration conversion and fallback binding.
- `randomTable`: the original executable's256 values; the cursor is mutable
  shared state, never reseeded by either launch or projectile continuation.

Structural validation is not source authentication. Do not authenticate a trace
of expected answers or accept replayed browser-provided tables as a source
provider. Pointer relocation must be consistent between fire, projectile records
and FIN tables. Missing source geometry rejects instead of producing false misses.
The existing fire-only fixture omitted collision rectangles and base armor
normalization, so its tables alone are not a complete damage profile.

No shared host, session, simulation, view, renderer, source factory or existing
fire implementation was edited. `readyEndToEndCombat` in that integration remains
false. This module proves bounded fire-to-damage computation; a future session
owner still needs authenticated projection construction, phase ordering, atomic
commit, replay/checkpoint ownership and lethal/general-effect handoffs.

## Evidence

[Native probe](../tools/qa/native-projectiles-native.py) starts fresh source SCN,
relations and original PTH worlds. Native constructors create source and target;
an actual registered Attack visit calls `0x441710`. Projectile positions are
never assigned to manufacture an impact. Native stand collision geometry executes
`0x43be82..0x43bf38` from source FIN child/SPR frame metadata; armor executes
`0x43bd46..0x43bd89`. The probe supplies real occupied cells, actor statuses and
source team policy rather than a captured damage answer.

[Tests](../tools/qa/legacy-native-projectiles.test.ts) replay launch into the new
pass and compare every80960 pool bytes, heads/high-water, all800 raw220 actors,
all96 statistics, and every projectile RNG write against the original executable.
Thirty isolated trajectories cover all eight weapon pairs, adjacent same-family
hits, longer travel, upgrades, two simultaneous active shots, noncontiguous
poisoned free-list reuse, high-water allocation, commander FIN impact completion,
RNG wrap, no-target expiry, complete aircraft geometry and airborne rejection.
The natural continuation additionally completes reload, reuses the just-reclaimed
slot without increasing high-water, and hits the already-damaged target again.

SCN upgrades and policy alternatives are labelled controlled inputs, not claims
about historical scenario upgrades. Expiry uses the original unregister routine
after launch. The wall fixtures copy a source impassable PTH record after launch
as a labelled controlled obstacle input; they do not modify projectile positions.
Aircraft fixtures use an original constructor and original zero stand-bank state,
with a complete source collision rectangle. Tests also reject death and missing
impact FIN after staged movement/damage/RNG, proving no candidate escapes.

Current evidence: `/tmp/dc-native-projectile-validreuse-20260919-Rxsh1I`.
35 projectile tests and 34 fire tests pass together:
`/tmp/dc-validreuse-owned-tests-20260919-IwuK2c`.
Strict scoped TypeScript passes: `/tmp/dc-validreuse-types-20260919-BD7KYy`.
No agents, browser or full suite ran.

The old `/tmp/dc-projectile-source-20260919-p19.jsonl` is superseded, not
overwritten. Its reuse input (including case1) had high-water3 but only free
`0 -> 2 -> -1`, orphaning slot1. The shared source fixture now supplies
`0 -> 2 -> 1 -> -1`; slot1's link changes from poisoned `0xa5a5` to `-1`,
and slot2's link changes from `-1` to `1`. These are the only four changed input
bytes (record-buffer offsets60/61/100/101). High-water, heads, statistics and all
other poisoned bytes are preserved. Tests assert the complete input buffer in
all12 reuse cases and valid reachability throughout native travel/reclamation.

All30 trajectories were freshly captured from the original executable. Together
with the fresh fire matrix,1880 pool snapshots differ only in these links and
the native free-head continuation to slot1; all other trace fields are unchanged.
Non-reuse rows are identical in full. The separate orphaned-reuse negative control
and existing orphan-head regression prove TypeScript rejection before dispatch
without caller mutation. They do not claim that native code validates or rejects
orphans. The runtime validator and original scatter logic remain untouched.
See the [fire fixture correction](native-fire-owner.md#poisoned-reuse-fixture-correction)
for neighboring tests and the unaffected movement trace.

Reproduce with `PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918`
and `python3 -B tools/qa/native-projectiles-native.py --suite`; `--case N` selects
one fixture. `DC_NATIVE_PROJECTILE_TRACE=<jsonl> node --import tsx --test
tools/qa/legacy-native-projectiles.test.ts` replays saved evidence; without the
variable, tests regenerate the source matrix. Captures are test evidence only.