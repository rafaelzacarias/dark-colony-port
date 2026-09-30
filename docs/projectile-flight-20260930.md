# Projectile flight and fire cadence (playable simulation)

Evidence: native projectile wrapper `0x44293c`, phase ordering `0x419bbe..0x419c13`, launch `0x412d00`, loader lifetime `0x43b935..0x43b952`, [legacy-native-fire.ts](../src/engine/legacy-native-fire.ts), [legacy-native-projectiles.ts](../src/engine/legacy-native-projectiles.ts), [fire-cadence-20260919.md](fire-cadence-20260919.md).

## Simulation (`DeterministicSimulation`)

- A weapon with WEAPSTAT `speed` (`WeaponStats.projectileSpeed`, plus `weaponId` and `splash` = `shots`) launches a projectile instead of applying damage instantly. Weapons without `projectileSpeed` (synthetic tests) keep the old instant behaviour.
- Coordinates are Q8 cells. Velocity is fixed at launch from the 256-heading direction to the target's launch position: `vx = trunc(sine(h+64)*speed/2048)`, `vy = trunc(sine(h)*speed/2048)` (not homing). Four substeps per tick, run after all actor updates in a tick, newest projectile first.
- Lifetime in substeps is `trunc((2*((range<<8)+1024)+1)/(2*speed))+1` (35 for range 4 / speed 60). Positional (`shots>0`) projectiles instead end after `trunc(distance/velocity)` substeps.
- Each substep the projectile checks hostile live actors (the intended target always qualifies; other hostile units/structures on the flight line are struck too). Damage is computed at impact against the victim actually hit, using the attacker's launch-time inspire factor; the existing `shot` combat event is emitted at impact. Expiry without a hit is a miss; a target that dies or moves away is simply not hit.
- Cadence: after a launch the reload countdown is `rateOfFire + 2` (countdown to zero, pop update, launching update), i.e. launches at ticks 0, 17, 34, 51 for rate 15.
- Presentation feeds: `launchEvents`, `impactEvents` (including misses, with Q8 position), `projectiles` (in-flight snapshot). Checkpoints carry optional `projectiles` / `nextProjectileId`.

## Rendering ([render/projectiles.ts](../src/render/projectiles.ts))

Weapon banks follow the original binder: travel `<visualClass>BULLET0`, impact `<visualClass>EXPLODE0` then `<visualClass>EXPL0`, looked up by state name across loaded FIN archives. The generic `weapons` class has neither bank in the original, so those bullets are invisible (as in the original); GRAY/TURR/XENO/... classes draw their FIN states.

## Limits

- Collision rectangles are per-sprite in the original; here units use a half-cell square and structures their footprint cells (splash weapons get one extra cell of tolerance at expiry). Random BOOM spread and area damage for `shots>0` weapons other than mines are not modelled.
- Muzzle offsets from FIN slot-7 events are not applied (none exist for the base-weapon subset).
