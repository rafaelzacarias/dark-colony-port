# Physical centered PETRA7 mining

New browser-adapted harvest orders target the VENT cell itself. The collector
walks through the ordinary simulation movement queue; extraction requires its
exact center pose and idle state. No rendering offset, teleport, source asset,
health, starting-credit or strict-native scheduler changes are used.

## Ownership and occupancy

- One new reservation per VENT, including commands queued before the next tick.
- Repeated centered orders preserve extraction progress.
- Stop, death, rate shutdown and depletion release economy orders. A live stopped
  collector remains a physical blocker until moved away.
- Impassable terrain, sealed routes, live mobiles and other static footprints
  still reject orders without changing simulation queues or reserves.
- Fresh adapted VENT static targets have empty collision footprints. Source
  identity, slot, generation, position and resource data remain registered.
- The transport host bypasses its unowned-native-extraction guard only for the
  existing explicit adapted discriminator, without native AI/combat owners.
  It does not extract resources; the adapted economy remains the income owner.
- Source VENT is type 40. Type 43 is ENGI, not an auxiliary VENT; neither H02 nor
  A02 declares type 43. VENT constructor Q8 is tile * 256 + 128.
- Host position publication follows simulation movement on the next staged
  frame. Pointer tests verify exact Q8 and ground-slot ownership before income.

## Explicit Save Compatibility

Unversioned adjacent orders remain valid and restore without moving collectors,
resetting progress or silently rewriting footprints. Existing concurrent
adjacent saves keep their finite-reserve/depletion behavior; new competing
orders are rejected. Mixed centered/adjacent reservations for one source are
invalid checkpoints.

Reissuing an adjacent order targets the center if passable. Old saves that retain
the original one-cell VENT blocker continue their adjacent extraction exactly;
centered reissue is rejected while that legacy blocker exists. No automatic
blocker migration is performed. Fresh missions use centered footprints.

## Verified Evidence

- 9 dedicated centered-mining controls: movement bounds, queue contention,
  Stop, physical occupancy, combat death, depletion, terrain/static/mobile
  rejection, exact replay, legacy orders and strict-host guard.
- 10 economy regressions including explicit legacy concurrent depletion.
- 7 SARGE income-interception regressions.
- H02 and A02 full actual-loader pointer tests: upper-sprite public command,
  actual walking, unchanged source hash and health, exclusive centered pose,
  source host identity/ground occupancy, earned credits and exact JSON replay.
  H02: cell (69,48), Q8 (17792,12416), extraction tick 131, final credits 44.
  A02: cell (4,80), Q8 (1152,20608), extraction tick 168, final credits 50.
- 6 focused MissionView cases: H02/A02 startup, legacy adjacent save continuation
  and earned 350-credit FIN production with mid-period restore.
- 2 actual-loader collector-production cases: earn 1500, publicly walk the
  original collector off the vent, purchase a replacement, extract again and
  replay all production/mining boundaries exactly. H02 earned 1540 total,
  spent 1500, retained 40; A02 earned 1525, spent 1500, retained 25.
- Total: 36 distinct focused tests passed, with no skipped tests in those runs.
- Strict scoped TypeScript compilation passes for all modified runtime and QA.

Logs: `/tmp/dc-centered-pointer-economy-1790184733543.log`,
`/tmp/dc-centered-legacy-host-1790185045807.log`,
`/tmp/dc-centered-view-1790184566065.log`,
`/tmp/dc-centered-types-1790185878947.log`,
`/tmp/dc-centered-final-production-HUMAN-1790185952727.log`,
`/tmp/dc-centered-final-production-ALIEN-1790185952727.log`.

Actual-loader checks use Node NullCanvas with original assets, not browser pixel
verification. No external browser, agents or full suite were used. Palette and
render functions are untouched by this change.