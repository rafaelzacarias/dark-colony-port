# Campaign Session

[campaign-session.ts](../src/engine/campaign-session.ts) is a runnable deterministic
owner of campaign world, mission controller, native slots and transport host.
It does not require or modify the UI. The real HUMAN01 and ALIEN01 source scripts
run intact; startup troops are created by the host, not expanded into placements.

## Orchestrator API

```ts
const result = createCampaignSession({
  sessionId: "human-01-run-1",
  source: scenario,
  units,
  weapons,
  triggers,
  messages,
  map: bundle,
  pathGrid: bundle.pathGrid,
  tags: bundle.tagGrid,
  commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }],
  directionBits: [[0, 0], [1, 0], [0, 1]],
  fixedStepMilliseconds: 16,
  orientationSteps: 1,
});
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
const session = result.value;
const initial = session.snapshot;
const frame = session.step({
  clockMilliseconds: wallClockUint32,
  updates: unitUpdates,
  reservations: destinationReservations,
});
```

Import `createCampaignSession` from the new module. Inputs are parsed source
SCN teams (including both coordinate rows and all City rows), source placement
rows only, source GAMESTAT definitions including `rawTail`, WEAPSTAT, complete
TRO blocks and MSG records. MAP dimensions, unflipped PTH payload and source-row
MTG payload are required. Buffers and source objects are owned copies.

For ALIEN01 the explicit commander mapping is
`[{ team: 0, unitType: 73, sprite: "GRAY" }, { team: 1, unitType: 69, sprite: "TRSC" }]`.
The caller supplies the semantic commander role; the session validates each
mapping against the exact unit definition sprite and source team's race, then
binds its actual allocated slot after creation. It does not infer that role
from a shared sprite. Empty, mismatched or ambiguous mappings are diagnosed;
an `abduct` with no resolved commander fails rather than reporting extraction.

Call `step` once per native simulation cycle, not once per render frame or per
wall-clock millisecond. Pause by withholding steps. `cycleCounter` starts at zero,
increments as int32, and is passed raw to the VM, whose `c` operand shifts by four.
Normal scans occur at cycles 8, 16, 24, etc.; both startup `c>0` blocks first fire
at cycle 16. Wall clock is an independently injected uint32 millisecond value.
The host advances once per call. Cadence, orientation duration and direction bits
are explicit host policies, not recovered native timing or RNG.

External updates use `{type, slot, generation}`. `position` adds a native256
`position: {x,y}`; `combat-death` records victim losses once; `complete-removal`
unregisters a task-10 entity. A batch is applied before rebuilding occupancy,
allowing simultaneous swaps without cloning the world for each unit. The caller
owns ordinary movement, combat and removal completion. Use source units/weapons
to configure that simulation; this session does not silently substitute combat.

Reservations are `{slot, generation, tileX, tileY}` events from a successful
destination reservation, not inferred from movement or sampled standing cells.
Their team comes from the registered entity. MTG indexing flips source Y exactly
once. Event order is: external batch, host tick, reservation trips in supplied
order, then the normal scan when due. The session validates identity and bounds;
the external movement bridge must attest that the reservation actually succeeded.

Successful frames contain detached `world`, `controller`, `staticSlots`, raw
`cycleCounter`, `entry`, and `bailExpired`. Initialize the bridge from
`session.snapshot.world.entities`; then consume only successful `entry.requests`
(`create`, noncombat removal, collision clear, combat death, unregister).
Requests retain slot/generation. Read new health/type/team from the returned world.
`entry.commands`, receipts, full action trace, fired IDs, messages and bail are
also retained by `session.journal`. `bailExpired` is strictly after the native
10-second deadline, including uint32 wrap; it does not itself claim extraction
completion or stop stepping. The orchestrator decides when to leave the mission.
Any failure rolls back the complete tick, including host RNG cursor and journals.
Controller/host diagnostics preserve their codes and available source locations.

## Native Ownership

- Reserved colony slots 0..119 start cleared and receive only buildings returned
  by `projectLegacyColony`, with exact native positions, HP and `b(team,slot)`.
  Ordinary source rows bind to slots 152+ in source order. Placement `rawTail[0]`
  overrides current HP unless it is -1; max HP remains the unit definition value.
  Raw words +0/+4, type/team +6/+7, HP +0x0c and status +0x2c match the registry.
  This is not a claim that all opaque task bytes emulate the native loader.
- Definition `rawTail[2]`, not `rawTail[0]`, supplies movement class: supported
  host planes are class 0 ground and class 1 flying. Other classes remain in the
  raw table but have no invented host definition. The table has capacity for 110
  types, not a requirement for 110 source records; absent types have sentinel
  movement byte 255 and no host definition.
- Static entities have allocator/registry reservations in host slots but are
  explicitly excluded from single-cell transport occupancy. Their raw state is
  synchronized by this module. PTH families 0/255 stay blocked. Verified colony
  footprints additionally deny ground entry; no terrain is unblocked to admit
  a building. Static unregister frees slot ownership for later mobile allocation.
- Census counts registered source/payload slots 152+, including dead entities
  awaiting unregister, not just positive-HP units. Colony and carrier slots are
  excluded. Only verified victim-loss and per-type census statistics are seeded;
  unknown selectors produce missing-input diagnostics. Exomoney stays a side
  assignment and is not fabricated into statistics.

## Ordered Execution

The controller's whole-scan `pendingEvaluation` cannot commit world writes before
a later condition. The session scopes one eligible source block at a time, in
numeric order, through `planMissionStep` and `commitMissionPlan`. All blocks remain
available for `setlifes`; no source action is removed, and controller reverse
action execution preserves `bail` and `setlifes`. Original block declarations are
restored in the public controller state. World feedback is refreshed before each
subsequent condition. Temporary trip dispatch supplies the actual trip team.

Every world command commits through the existing campaign adapter. Between
commands, this module explicitly synchronizes changed entity types into host
records, validates/rebuilds the affected occupancy, and preserves raw bytes.
Thus a later host save cannot undo a beacon's `newtype`. Static-to-mobile transfers
and raw changes to host records outside world ownership are diagnosed instead.
No existing host, controller, colony or world implementation was changed.

## Verification And Limits

Run `node --import tsx --test tools/qa/campaign-session.test.ts`.
Tests use raw source files for both missions and verify native colony/source
initialization, HP overrides, no startup expansion, five delayed player units,
ALIEN01 direct enemy reinforcement, actual commander slots, HUMAN01 trip-7 beacon
ownership, host/raw persistence, losses/census/unregister, pickup scheduling and
bail, numeric feedback resumption, atomic batches, deterministic replay, diagnostics
and static-slot reuse. Strict TypeScript and declaration emission are separate gates.

Remaining boundaries are explicit:

- No ordinary unit AI, combat engine, waypoint following or bridge is invented.
  Waypoint task bytes are preserved for a consumer; this module accepts the
  external unit-update/reservation port instead. It is runnable headlessly but
  not connected to main or mission-view.
- Static source-object footprints beyond the projected colony are not decoded.
  Static registration is separate from transport collision; arbitrary source
  objects do not gain guessed footprint blockers. Colony footprint masks remain
  conservative after building removal; native terrain restoration is not modeled.
- Host type-40 special placement, unsupported movement classes, coordinate-FIFO
  producer policy, special zero-first-word transport payloads and native path
  optimality remain outside this session. No coordinate FIFO is fabricated from
  ambiguous City fields. Unsupported creation is diagnosed transactionally.
- Host direction-bit exhaustion, capacity/occupancy failures, campaign message
  rollover beyond 16 or special parameter4=255, unsupported actions/conditions,
  unknown statistics and unresolved commanders retain diagnostics.
- Source commander-role verification is an explicit input contract, not a new
  executable proof of automatic commander classification. Source types 69/73
  and their definitions are pinned by the fixture mappings, not guessed from
  successful-looking animation. Pickup scheduling and bail are independently
  observable; neither is presented as proof of complete native mission parity.