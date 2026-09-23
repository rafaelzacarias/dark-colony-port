# Bounded Native Class/Armor Damage

## Scope and Evidence

This is an opt-in arithmetic path, not full native combat parity. The existing
MissionView is unchanged and does not enable it. Generic sandbox combat and
mixed-profile attacks continue to subtract the weapon's flat damage. Both an
attacker `weapon.sourceDamage` and a target `sourceDefense` are required.

Evidence comes from `docs/balance-runtime.md` and the hash-gated executable
probes in `tools/research/balance-audit.py`:

- GAMESTAT token 11 is the target class; tokens 9/10 give armor percentages.
  The current parser already exposes `targetClass`, `armorUpgradePercentages`
  and corrected `health`; the earlier parser handoff in the audit doc predates
  those corrections. No raw-tail inference is used here.
- WEAPSTAT token 2 (`rawPrefix`) selects the MBULLET weapon-class row. Weapon
  selection still uses explicit weapon IDs, including upgraded weapon IDs.
- MBULLET loader `0x43b24b..0x43b2ef` converts percentages to signed 16-bit
  coefficients. `parseLegacyDamageMatrix` accepts the evidenced 9-by-10 integer
  percentage format and returns coefficients, not percentages. It rejects
  malformed dimensions, negative values and coefficients above 32767.
- Armor initialization `0x43bd46..0x43bd86` gives factors
  `[256, trunc(25600 / firstPercentage), trunc(25600 / secondPercentage)]`.
- Arithmetic `0x4419e5..0x441a12` multiplies and shifts independently:

```text
damage = (coefficient * baseDamage) >> 8
damage = (damage * callerFactor) >> 8
damage = (damage * armorFactor) >> 8
if specialFlag: damage = (damage * 3) >> 2
```

`calculateLegacyDamage` accepts only nonnegative signed-32-bit operands and
rejects an intermediate product above 2147483647. Native overflow, signed
negative damage and healing are outside this bounded API; they are not silently
wrapped or clamped. Zero damage is valid, still emits a shot, consumes the
existing cooldown, and does not receive a minimum-one clamp. Shot events report
calculated damage before health is clamped to zero, preserving overkill events.

## Integration Contract

The future MissionView/data owner must load MBULLET text (no new generated asset
or loader is included), parse it once, supply source stats, and select explicit
per-team/per-unit-type upgrade levels. No faction-based armor guessing is used.

```ts
const matrix = parseLegacyDamageMatrix(mbulletText);
const options = unitOptionsFromLegacy(unitStats, weaponStats, weaponLevel, {
  matrix,
  armorLevel,
  callerFactor,
  specialFlag,
});
simulation.addUnit({ ...options, faction, team, cell, health });

simulation.addStaticTarget({
  faction,
  team,
  cell,
  maxHealth: staticStats.health,
  health,
  footprint,
  sourceDefense: defenseOptionsFromLegacy(staticStats, armorLevel),
});
```

The helpers above are exported by `src/engine/legacy-balance.ts`.
`unitOptionsFromLegacy` retains its original three-argument behavior; the fourth
argument opts into source profiles. The selected weapon requires `rawPrefix`;
the unit requires named target-class and armor fields. Missing source data is
rejected. Static defense does not require movement or weapons. Explicit scenario
health and team-derived faction remain the registering caller's responsibility.
The adapter's source faction behavior is unchanged.

For direct simulation registration, `WeaponStats.sourceDamage` takes
`{ coefficients, callerFactor, specialFlag }`, where `coefficients` is one
10-column coefficient row. `AddUnitOptions.sourceDefense` and
`AddStaticTargetOptions.sourceDefense` take `{ targetClass, armorFactor }`.
Profiles are validated and copied on registration, including matrix row storage,
so later caller mutation cannot change combat. These are registration-time
profiles; live upgrades or per-hit changes need a separate future API.

**Caller policy is required:** the provenance of the native caller factor and
special flag remains unresolved. Neither has an implicit default in the source
API. Choosing `callerFactor: 256, specialFlag: false` is an explicit neutral
browser policy or controlled fixture, not a proved universal native call site.
Do not enable this path in missions under a claim of full source fidelity until
the applicable caller semantics are established. Missing either combat profile
intentionally falls back to flat damage; callers seeking source calculations
must register defense for every intended mobile and static target.

## Preserved Behavior and Blockers

Team diplomacy, range/path checks, target acquisition, simultaneous pending
damage, deaths, footprint release, shot ordering and generic weapon validation
are unchanged. Source-profile weapons additionally allow zero base damage.

Unresolved: factor/flag provenance; damage caller coverage; hit and splash
selection; healing; projectile effects and travel; native burst clock domain;
dynamic weapon/armor upgrades. Existing `rateOfFire -> cooldownTicks` remains a
browser approximation. No unnamed WEAPSTAT fields were reinterpreted here.

## Focused Verification

```sh
node --import tsx --test tools/qa/native-combat-fidelity.test.ts tools/qa/simulation-diplomacy.test.ts tools/qa/combat-events.test.ts tools/qa/static-targets.test.ts tools/qa/engine.test.ts
npm run typecheck
```

The new test file covers six arithmetic probe vectors, corpus class/armor data,
explicit weapon ID selection, opt-in/mixed behavior, mobile/static targets,
zero damage and cooldown, profile immutability, class-column selection, caller
inputs, bounds rejection, directed alliances and simultaneous static death.
These runtime tests use controlled caller inputs and are not mission parity
tests. The existing executable audit can independently verify all 90 converted
matrix entries, four armor fixtures and six arithmetic fixtures using the
Python dependencies and executable hash documented in `docs/balance-runtime.md`.