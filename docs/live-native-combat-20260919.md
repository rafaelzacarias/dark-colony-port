# Live Verified Native Damage

## Scope

Implemented in [legacy-balance](../src/engine/legacy-balance.ts), using the existing
fail-closed hit path in [simulation](../src/engine/simulation.ts) unchanged.
No mission registration, data loader, extractor, rendering, or shared evidence
document was changed. This extends [the caller audit](combat-callers-20260919.md)
only for damage amounts at already resolved ordinary direct hits, not full combat
parity. Both HUMAN01 and ALIEN01 now have complete declared/scripted combat-roster
coverage under the conditions below; this is an integration API, not enablement
in the mission view.

The optional `weapon.sourceDamage` accepts either the existing fixed
`LegacyDamageProfile` or a new `NativeOrdinaryDamageProfile`, distinguished by
`mode: "verified-native-ordinary"`. The live profile has no `specialFlag`:
the simulation reads `SourceDayNight.phase` at each hit, after its existing
start-of-tick phase advance. Human type faction 0 is penalized in phase 1;
alien type faction 1 is penalized in phase 0. Ownership faction/race and visual
brightness are not inputs to this predicate. Registration copies/freezes profiles.

## Exact Eligibility

| Role | Allowed inputs |
| --- | --- |
| Source | TRSC type 0/faction 0: levels 0/1/2 select IDs 1/2/3, damage 100/125/150; GRAY type 8/faction 1: IDs 15/16/17, same damage |
| Commander source | Type 69/faction 0: initial ID 5, damage 160; type 73/faction 1: initial ID 62, damage 160. Level 0 only |
| Weapon/caller | Weapon class 0, BOOMSTAT profile 0 (`shots` in the current parser), dimension 1, ordinary direct caller, Inspire timer 0 |
| Target class 0 | Types 0/8; armor levels 0/1/2 have factors 256/204/170 |
| Target class 6 | Commanders 69/73: factors 256/204/170; objective 82: factors 256/213/182 |
| Target class 9 | Building types 16-22 and 28-35; factors 256/213/182 |
| Target class 8 | Colony TOWR 81 and SCN types 84/89/95; factors 256/213/182, zero class coefficient |
| Teams | Explicit source and target teams 0-7, independently of original type faction |
| Matrix row | Original Q8 coefficients `[64,30,64,46,64,230,12,128,0,12]` |

Separate Q8 truncations remain in `calculateLegacyDamage`. Objective 82 is
**class 6, not class 9**, even though those two entries happen to be equal in
this class-0 weapon row. Commanders' complete source weapon triplets are
`[5,8,6]` and `[62,8,6]`; weapon 8 is class 1. Their later slots are not approved.
Factories validate the exact selected weapon ID, damage, class, BOOMSTAT profile,
type faction, target class, and original armor percentages, not just type names.

Favorable/adverse damage examples from the original impact instructions:

| Base damage | Class-0 armor 0 | Class-0 armor 1 | Class-0 armor 2 | Class-6/9 armor 0 |
| --- | ---: | ---: | ---: | ---: |
| 100 | 25/18 | 19/14 | 16/12 | 4/3 |
| 125 | 31/23 | 24/18 | 20/15 | 5/3 |
| 150 | 37/27 | 29/21 | 24/18 | 7/5 |
| 160 | 40/30 | 31/23 | 26/19 | 7/5 |

The coefficient 12 is `trunc(5 * 0.01 * 256)`, not a direct 5-percent health
calculation. Class-8 hits produce zero, still emit a shot and consume cooldown;
they are not unsupported hits and must not receive a minimum-one clamp.

## Integration API

`sourceScenarioUpgradeLevels(team, typeIndex)` consumes the existing parsed
team shape `{ index, race, cityRows }`. It returns
`{ team, sourceTypeIndex, weaponLevel, armorLevel, origin }`. It requires one
10-integer-width city row and eight five-integer unit rows, validates levels
0-2, and rejects unsupported race/team/type indices. The unit rows are
`cityRows[1..8]`, not the city row itself. Column indices 2/3 are weapon/armor.
The initialized default is zero only for types not overridden by that team's
race mapping:

```text
race 0: 0, 2, 3, 6, 43, 5, 1, 4
race 1: 8, 10, 11, 14, 44, 13, 9, 12
```

`verifiedNativeDamageFromLegacy(unit, weapon, matrix, levels, state)` and
`verifiedNativeDefenseFromLegacy(unit, levels)` return either
`{ supported: true, profile }` or `{ supported: false, diagnostic }`.
Damage requires explicit `state: { caller: "ordinary-direct", inspireTimer: 0 }`.
The weapon argument is a record selected by explicit ID, not array position.
Defense level comes from the target's owning team, independently of the attacker's
team or either type's faction. A mismatched source armor-percentage pair is refused.

Exported integration constants, checked against the actual MBULLET bytes:

```ts
VERIFIED_NATIVE_ORDINARY_COEFFICIENTS // frozen [64,30,64,46,64,230,12,128,0,12]
VERIFIED_NATIVE_MBULLET_SHA256 // 2244665ec4fc4f344b4ad32ec47e209c79a1a240d48f8f43a6035ceab0ae1d22
```

This is weapon-class row 0, not the whole matrix. Pass the complete parsed
9-by-10 matrix to the factory. A low-level `NativeOrdinaryDamageProfile` may
use the exported row directly with a proven type/faction/weapon combination;
its enclosing `weapon.damage` must still equal that ID's actual base damage.

An orchestrator can assemble registration inputs as follows (variables refer
to its source records, current team, health override, and diagnostic sink):

```ts
const levels = sourceScenarioUpgradeLevels(team, unit.index);
const options = unitOptionsFromLegacy(unit, weapons, levels.weaponLevel);
const selectedWeapon = weapons.find(({ id }) => id === unit.weapons[levels.weaponLevel])!;
const damage = verifiedNativeDamageFromLegacy(unit, selectedWeapon, matrix, levels, {
  caller: "ordinary-direct",
  inspireTimer: 0,
});
const defense = verifiedNativeDefenseFromLegacy(unit, levels);
if (!damage.supported || !defense.supported) {
  // Surface each diagnostic; do not claim this registration is native verified.
} else {
  simulation.addUnit({
    ...options, team: team.index, faction: owningFaction, cell, health,
    weapon: { ...options.weapon!, sourceDamage: damage.profile },
    sourceDefense: defense.profile,
  });
}
```

Use the defense helper independently for a static target, passing its result as
`addStaticTarget({ ..., sourceDefense: defense.profile })`; retain explicit
scenario health and source default/max health independently. Provide the parsed
`scenario.rawHeader` as `SimulationOptions.sourceDayNightHeader`. Load and parse
MBULLET once with `parseLegacyDamageMatrix`.

The factories are policy checks on supplied source data, not authenticity
checks or a mutable upgrade subsystem. Use levels for the actual owning team
and type; retain the original `unit.faction` when constructing profiles even
when registering a different ownership faction. Direct profile construction is
a low-level assertion of the same eligibility, not an alternate upgrade path.
The orchestrator must ensure no save/script/command upgrade or Inspire mutation,
and no source type/slot replacement, invalidates these inputs during combat.
Recompute profiles using the actual owning team after a supported level change;
this API does not apply native upgrade commands or track mutable levels itself.
If these cannot be guaranteed, do not enable the live profile.

## Diagnostics and Compatibility

Factory diagnostics distinguish unsupported team/type, weapon level, armor
level, source/weapon, target type, matrix, and caller/Inspire. Invalid live
type/faction/weapon combinations and coefficient rows also fail registration.

At a resolved hit, a live profile with missing native phase, teams outside
0-7 (including absent teams), missing/unsupported defense, an unproved armor
factor for that target type, or base damage inconsistent with its explicit
weapon ID is refused. `simulation.sourceDamageDiagnostics` reports
`{ tick, attackerId, targetId, reason }`, reset each advance. Reasons are
`missing-native-phase`, `unsupported-native-team`,
`unsupported-native-defense`, and `unsupported-native-base-damage`.
There is no flat-damage fallback, shot, health change, or cooldown consumption
for a refused hit. Persistent unsupported orders can report again next tick.

Generic sandbox combat and existing fixed profiles retain their previous
behavior, including mixed-profile flat damage. Fixed profiles still support
explicit factors/flags, zero damage, integer bounds, and synthetic fixtures;
the live verified subset now includes four class-8 zero-damage targets. Diplomacy, range/path guards,
pending simultaneous damage, overkill shot values, health overrides, deaths,
and footprint release remain in the existing simulation path.

Excluded: other source types/weapons (including static shooters), commander
weapon levels 1/2, unverified dynamic upgrade application, Inspire, team 8, area/terrain-effect callers, healing, projectile
travel/scatter/collision, native cadence, slot reuse, and native death/retaliation
semantics. Passing browser death regressions does not verify native deaths.

## Initial Scenario Evidence

Raw [HUMAN01](../raw_cd/DC/SCENARIO/HUMAN/HUMAN01.SCN) has zero weapon/armor
columns in all 64 unit rows. Race sequence for teams 0-7 is
`[0,0,1,1,1,0,0,0]`.

Raw [ALIEN01](../raw_cd/DC/SCENARIO/ALIEN/ALIEN01.SCN) has race sequence
`[1,0,1,0,0,0,0,0]`. Team 0's first unit row is `0 0 1 1 0`, which maps to
GRAY type 8 at weapon level 1 and armor level 1. Every other unit row has zero
upgrade columns. **ALIEN01 team-0 GRAY is now supported as both source and
target: weapon ID 16/base 125 and armor factor 204.** Team-2 GRAY retains ID 15
and factor 256; team-1 TRSC retains ID 1 and factor 256.
Listed buildings are absent from the eight-row mapping and retain initialized
zero levels within this initialization path. This is not evidence that all
objects or all later states in either mission qualify.

Source SHA-256:

- HUMAN01: `af82c538181ca182481562dfa75ff1f39038a58445b019cd6a52426b33e968e7`
- ALIEN01: `3a971792a6661c6595ea22a5fa071abe12d03392ab3d8ec40c212328c1298b1e`
- DC.EXE: `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`

The [scenario-level native probe](../tools/research/live-native-scenario-levels-20260919.py)
uses the existing hash-gated executable fixture. It executes poisoned native
type initialization, native scanner argument construction at `0x41c229`, checks
the five `%d` destinations including frame `-0x70/-0x6c`, marshals raw SCN
integers to those destinations, and executes the original writes
`0x41c24e..0x41c287`. It checks all 128 raw unit rows and 3,392 type/team level
bytes across two initialized fixtures. It does not execute CRT `sscanf`, file
I/O, enabled-team branching, or full scenario boot. The native city-line read
at `0x41c0db` precedes the eight-row read loop at `0x41c216`.

## Mission Coverage

The roster test parses the actual SCN and TRO, includes `projectLegacyColony`
objects, all positive-count `reinforce`/`reinforce2` groups, and `newtype`
destinations with their existing owners. It does not infer roster membership
from sprites or use a mission-name exception to bypass the profile checks.

| Mission | All declared/scripted attacker types | Target-type union |
| --- | --- | --- |
| HUMAN01 | 0, 8, 69 | 0, 8, 16, 17, 69, 81, 84, 95 |
| ALIEN01 | 0, 8, 69, 73 | 0, 8, 69, 73, 82, 89 |

**Both entire source mission rosters can use matrix damage amounts**, including
later scripted reinforcements, starting ALIEN01 upgrades, commanders, and all
eleven type-82 objectives. No listed attacker or target needs an arbitrary
flat-damage fallback. This approval assumes ordinary resolved hits, the initial
levels (or explicitly refreshed proved levels), unchanged source slots/types,
and no active Inspire. HUMAN01's native base TOWR is type 81/class 8, not a
class-9 building; beacons/pads 84/89/95 likewise take zero from these weapons.

This does not certify transport carriers as targets, arbitrary newly produced
types, commander transformations, dynamic upgrades, mission completion,
target acquisition, firing cadence, projectile travel/scatter/collision, or
native death handling. Those states need separate evidence and retain
fail-closed diagnostics. These files do not wire profiles into the mission host.

## Independent Upgraded-Hit Evidence

The [upgraded-hit probe](../tools/research/live-native-upgraded-hit-20260919.py)
imports the hash-gated caller fixture and executes the original type scanner
and initialization, weapon scanner argument construction `0x43b78b..0x43b7ca`,
all native MBULLET conversions, and BOOMSTAT-0 parsing
`0x43b407..0x43b49e`. CRT values are marshalled to native scanner destinations;
file I/O, CRT `sscanf`, and animation/resource loading are not emulated.

All eight admitted source weapon records independently pass the original
BOOMSTAT-dimension branch at `0x44275a` and original caller `0x442877`, through
the helper `0x441930` to health write `0x441a38`, stopping at `0x441a3e`.
No damage helper is replaced. Hooks assert factor 256, source team, type-faction
phase flag, actual weapon pointer, selected target armor factor, and matrix
coefficient. Other target-team armor bytes are deliberately set to a different
level, and cases include source/target team pairs `(0,1)`, `(7,3)`, `(3,3)`.
Same-team cases prove arithmetic, not hostile target selection.

The matrix has **3,456 health-delta cases**: eight source records, 24 target
types, three armor levels, two native phases, three team pairs. Source faction
comes from native type `+4`, never owner/race. Weapon triplets and base damage
are asserted from native-scanned records; commander slots 1/2 are excluded.
The fixture supplies the selected weapon record and resolved target slot: it
does not execute weapon acquisition, firing, or projectile flight. Every native
delta is compared against the TypeScript API by the optional report-backed
focused test, enabled in the reproduction command below.

Additional source SHA-256 values emitted with the probe:

- GAMESTAT.TXT: `ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629`
- WEAPSTAT.TXT: `391e5603108b73cff4a5d2135ae751a0c8aebb934e6f3d6e5e09c5e807e520d0`
- MBULLET.TXT: `2244665ec4fc4f344b4ad32ec47e209c79a1a240d48f8f43a6035ceab0ae1d22`
- BOOMSTAT.TXT: `b80addf8e43bacc66c0ab63f4852f0ef13341f3a914d7305743557968baac33a`

## Focused Verification

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 python3 tools/research/live-native-upgraded-hit-20260919.py > /tmp/dc-upgraded-hits.json
DC_NATIVE_HIT_REPORT=/tmp/dc-upgraded-hits.json node --import tsx --test tools/qa/live-native-combat.test.ts tools/qa/native-combat-fidelity.test.ts
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 python3 tools/research/live-native-scenario-levels-20260919.py
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --types node src/engine/simulation.ts src/engine/legacy-balance.ts tools/qa/live-native-combat.test.ts tools/qa/native-combat-fidelity.test.ts
```

24 focused tests passed with no skips, including comparison with all 3,456 native
health deltas, both full mission rosters, exact MBULLET row/checksum, initial
upgrades, original type versus ownership faction, static/commander/objective
defense, live zero-damage shots, fail-closed diagnostics, simultaneous deaths,
guards, and copied profiles. Both native probes and the narrow TypeScript check
passed. Without `DC_NATIVE_HIT_REPORT`, only the report-comparison test is skipped.
No browser, extra agents, or full test suite was used.