# HUMAN07 Ground Delivery

## Root Cause

The historical [latest census](campaign-adapted-census-latest-20260922.json)
records simulation tick 82: `transport:203:0`, slot 203, type 0/TRSC, attempted
admission at `(15,11)`, occupied by `placement:8`, slot 160, type 41/T.

`initializeCampaignSession` excludes zero-speed source actors while initializing
host collision, then restores their slots/registry without inserting their
ground cells. Colony footprints separately become ineligible ground cells, but
ordinary SCN static placements do not. The host therefore considered the turret
cell vacant while `DeterministicSimulation.addUnit` correctly rejected the
view's static footprint.

This is not a native256/subcell rounding defect. T41 has movement class 0 and
auxiliary field 0. The unchanged native static helper projects one ground cell;
its center is `(15*256+128,11*256+128)`, or `(15.5,11.5)` tiles. Both projections
select cell `(15,11)`. It is an ordinary SCN slot, not a fixed CITY slot.

## Host Fix

[transport-host.ts](../src/engine/transport-host.ts) adds a shared delivery
predicate for explicitly adapted worlds, identified by the existing
`world.browserCasualtyPickup.runtimeProfile === "browser-adapted"` owner installed
by adapted sessions. It checks the existing terrain/colony eligibility mask and
mobile occupancy, then live registered zero-speed ground actors in host slots.
Armed and unarmed ground statics block identically. Resource vents retain the
adapted view's blocking cell. Original mine types 45/46 use the auxiliary plane
and are excluded; owner-8 markers/carriers have no static blocking footprint.
The complete original zero-speed GAMESTAT inventory is checked against
`projectLegacyStaticOccupancy` in regression tests, including its auxiliary and
owner-8 exceptions. No new mine behavior is claimed.

Arrival inspection, fallback search, and actual allocation use the predicate.
A blocked arrival retains cargo and takes the reducer's existing orientation/
movement path. Search still visits each whole square with X outer/Y inner order,
and allocation still uses the payload's movement plane. There is no reserved
exit, view-side relocation, arbitrary coordinate offset, or collision bypass.

The default strict arrival check, exported `findTransportPosition`, reducer,
native static helper, native AI ownership guards, and checkpoint schema are
unchanged. The additional check is computed from existing live state; no cached
obstacle bitmap or new serialized fields are introduced. Colony compound
footprints continue to use the existing eligibility mask. This does not expand
native collision or CITY lifecycle ownership.

## Focused Verification

- Original full HUMAN07 SCN/TRO: 200 session ticks, JSON save at tick 80 and full
  replay/continuation equality, including poses, slots, generations and requests.
- Original full MissionView: real asset loading and 200 update/render frames in
  the Node source-render fixture. Six admitted deliveries, at simulation ticks
  74, 80, 86, 98, 109 and 121; no static-cell admission. The previously failing
  third drop now uses `(15,13)` at tick 86 after retargeting. Requested native
  positions equal admitted simulation positions; no duplicate bindings or POOP
  asset fetch. Observed 3,156 sprite draws and 61 source images.
- Separately labeled full-scene control: two carriers aimed at the original
  turret, eight ground deliveries through tick 200, no terrain/static/mobile
  overlap, exact pre-arrival host JSON replay, unchanged original actors.
- Small controls: all original static definitions, auxiliary mines, owner 8,
  death release, strict opt-out, blocked terrain/footprint cells, source search
  order, exact retarget phases, simultaneous arrival and unique allocation.
- Existing strict transport/reducer/static tests: 25 pass, one optional external
  native-trace test skipped because `DC_STATIC_NATIVE_TRACE` was not supplied.
- Total focused results: 28 pass, one skipped. Scoped TypeScript compilation of
  the host and its two test files passes with strict/unused checks; editor
  diagnostics are clean.

Run only this slice:

```sh
node --import tsx --test tools/qa/transport-host-human07.test.ts tools/qa/transport-host.test.ts tools/qa/legacy-transport.test.ts tools/qa/legacy-static-occupancy.test.ts
```

No MissionView/runtime edits outside the host, agents, browser runs, full suite,
package changes or asset changes were made for this fix. Node canvas/WebGL stubs
exercise real view/render code and asset reads, not GPU pixels or browser timing.
Existing FIN renderer native-cadence/event warnings remain. This is bounded
HUMAN07 delivery verification, not full-game certification; the all-mission
census artifacts have not been regenerated.