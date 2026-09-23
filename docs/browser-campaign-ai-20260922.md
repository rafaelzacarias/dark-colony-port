# Browser-adapted campaign AI

## Status and announcement

Implemented in [browser-campaign-ai.ts](../src/engine/browser-campaign-ai.ts).
Explicit profile: `browser-adapted`; strategy: `source-objectives-v1`.
Describe this as **browser-adapted AI using original scenario objectives and
team relations**, not the original AI decision algorithm or native execution.
This module is separate from strict native admission and changes no native guards.

The [frame-1136 source diagnosis](ai-post1136-20260922.md) verifies natural
ALIEN02 activation orders and HUMAN02 reinforcements. AI `issuedTick` names the
input simulation snapshot, not the post-advance frame: activation frame 1136
can legitimately issue at snapshot tick 1135. A continuing order need not be
reissued after that boundary.

`computeLegacyAiFullPolicy` needs complete initialized policy/team/entity buffers,
neighbors, demand tables, occupancy, allocation addresses and synchronous receipt
semantics. The current source-world factory constructs raw800/CITY records, but
still explicitly reports missing full type/FIN/geometry, terrain/PTH/global/heap
and local-session pointer ownership. Importing boundary oracle snapshots would
not solve source-only startup. This implementation therefore does NOT invoke that
policy, initialize fake native buffers, or manufacture mode5/7 packets. Modes9/10
and production/economy lifecycle remain the separate bridge owner's responsibility.

## Portable contract

```ts
const configuration = await createBrowserCampaignAiConfiguration({
  scenario: parsedOriginalScenario,
  units,
  weapons,
  dependencies,
  pathGrid: navigationGrid,
});
let state = initializeBrowserCampaignAi(configuration, 1);
const result = computeBrowserCampaignAi(configuration, state, {
  snapshot: defaultBrowserSimulationSnapshot,
  actors: currentWorld.entities,
  nativeBindings,
  selectors: currentWorld.aiSelectors?.modes,
  visibleIdsByTeam,
  staticObstacles,
  adaptedTroProjection: session.adaptedTroProjection,
});
for (const order of result.commands) simulation.queue(order.command);
state = result.state;
```

The integrator must stage enqueueing and state publication in its existing atomic
transaction. Commit the returned state only when all commands are accepted; on
failure discard both staged queue and state. Repeating an uncommitted computation
returns identical IDs/results. A repeated tick with committed state returns no
commands. Do not replay commands without their IDs or retain queues across an
unrelated mission instance.

- `scenario` is parsed original SCN, including `aiSlots`, not a reduced mission
  envelope that drops that field. `parseScenario` is browser-safe text parsing.
- `pathGrid` is the immutable terrain navigation baseline, in the same runtime
  cell coordinates as the browser simulation. Use the existing
  `createLegacyInfantryFamilyMask`, not nonzero PTH bytes as a substitute for its
  ground-family mask. Do not bake destructible building footprints into this
  configuration: current static occupancy belongs in `staticObstacles`.
- `actors` supplies `key`, `generation`, `rawSlot`, `simulationId`, `team`,
  `unitType`, `health`. Snapshot HP and poses are current physical observations.
  A missing snapshot actor cannot be commanded or targeted.
- Optional `nativeBindings` is an array of
  `{ key, generation, slot, simulationId }`, for actors whose world
  `simulationId` is null. Conflicting slot/generation/ID/team bindings throw.
- Commands are `{ id, team, actorKey, command, stance, route }`.
  `command` is a supported `SimulationCommand` (`move`, `attack`, `stop`).
  `stance` is `advance`, `attack`, or `defend`; `route` is the planned cell path
  for movement, empty for direct attack/stop. Queue only `command`, not the wrapper.
- `selectors` contains all eight CURRENT values, including TRO changes.
  Modes 1/2/3 generate commands. 0/4 generate none. Never replace
  selectors in SCN or enable teams merely because an army exists. Disabling a
  selector does not cancel a previously committed simulation order and releases
  the local policy's command signature. Existing generic guards are unchanged.

## Adapted Local Modes 1/2

These are **chosen ADAPTED semantics, not native algorithm parity**. They use
original SCN coordinate rows, directed alliances, unit sight and weapon tables.
No selectors, source commanders, funds, production, armies or TRO data are changed.

- Mode 1 defends the second own coordinate row (home), falling back to the first
  (rally). It returns there when idle and holds within two cells or at a reachable
  static-footprint perimeter. It never advances to hostile base coordinates.
- Mode 2 patrols home then rally, dropping absent/duplicate anchors. Arrival or
  five stationary decisions advances the anchor index; one anchor acts as a
  local rally. No valid anchor means no invented destination.
- Both intercept only currently team-visible hostiles within
  `max(original weapon range, own original day/night sight)` cells of the actor.
  Shared or supplied team vision cannot authorize a distant interception. Local
  home threats are preferred, then nearest distance and stable actor ID. An owned
  attack is stopped when the target dies, disappears, becomes allied or leaves
  this radius; idle mode 1 returns home and mode 2 resumes its retained anchor.
  There is no permanent pursuit of a last-known hidden mobile position. Decisions
  remain 20 ticks apart; combat/movement between decisions belongs to simulation.
- Existing non-idle orders or non-null targets are preserved unless the stored
  `signature` matches the current attack command and activity is attack/pursuit.
  A differing external attack, movement, harvesting or building order releases
  that signature before threat selection, even with a visible local enemy.
  Snapshot units do not expose route destinations/provenance, so **all targetless
  active movement is conservatively preserved**, including AI-issued return or
  patrol routes. Local threats can interrupt idle defense or recognized owned
  attacks, not those active routes. A TRO attack replacing an AI attack with the
  identical target is observationally indistinguishable; exact command provenance
  would require a separate owner signal outside this module's scope.
- `aiGroupWeights` is ignored by 1/2, including zero and negative overrides.
  Existing group, objective, signature, issued tick, position and stall fields
  provide version-1 checkpoint persistence; no new ownership state is fabricated.

Original HUMAN12 retains selectors `[0,3,3,4,1,4,1,1]`. Its selector-1 teams
4/6/7 are disabled, alien, unfunded, have no initial actors or direct TRO
reinforcements, and have rally-only anchors `(3,38)`, `(3,40)`, `(5,40)`.
The data test preserves those roles and uses explicitly controlled observed
deliveries to prove all three selectors defend; it does not claim natural mission
activation. The original scenario census contains no selector-2 teams, so patrol
behavior is tested with a labeled fixture rather than edited original selectors.

Focused tests cover original HUMAN12 data, actual simulated kills/return/patrol,
day/night range boundaries, remote/shared/hidden vision, external orders, unchanged
mode-3 weights, exact uncommitted repeats, committed-tick deduplication and fresh
configuration JSON checkpoint continuation. This is not a browser playthrough or
native-parity claim.

## TRO Projection

The optional `adaptedTroProjection` observation is the complete current
`session.adaptedTroProjection`, not reconstructed event arguments or a native
policy buffer. MissionView provides it after the candidate session commit and
before generic guards/engine advance; all effects publish only with the outer
view transaction. See [integration status](adapted-tro-semantics-20260922.md#view-integration-follow-up)
for the remaining pickup owner and unsupported strategy modes.

Projected relations override snapshot/source relations for targets and rebuild
hostile SCN base objectives. Projected sharing expands fallback observers by the
explicit matrix row. Supplied `visibleIdsByTeam` remains authoritative, including
empty arrays; sharing never makes another team's actors controllable. MissionView
supplies independently computed per-team geometric masks.

`state.aiGroupWeights[team][selector]` is consumed only by mode 3. Selectors
1,2,3,4 map to demand categories 0,2,3,4, respectively, matching native policy
offsets `0x6c18..0x6c24`; human/alien types below 16 use `type % 8`.
An absent override retains the old every-decision behavior. A positive override
admits an actor's decision when its next persisted team RNG draw modulo the
largest positive team override is below its weight. Thus `[4,4,8,1]` gives
relative decision frequencies `[1/2,1/2,1,1/8]`. Zero suppresses that category's
decisions and stops its existing move/attack at the next policy decision.
Negative overrides reject when encountered rather than being silently clamped.
Other categories retain existing behavior. Skipped positive-weight decisions
do not cancel an already committed order or alter weapon cadence.

This is an **adapted category decision-frequency rule**, not the native
`counts * weight` production-demand minimization, native RNG or native scheduler.
It neither produces units nor claims native algorithm parity. Modes 1/2 remain
independent of aimsg; their proven empty native aimsg callbacks do not establish
native strategy behavior. Their chosen local movement semantics are defined above.
No dfiddle production rule is duplicated in this movement/combat strategy.
RNG draws for weights persist in the existing checkpoint alongside group draws.
View policy events invalidate the 20-tick decision wait; standalone callers that
omit the projection retain their prior behavior.

## Current Static Occupancy

The optional observation field has the exact type:

```ts
staticObstacles?: Readonly<Record<number, readonly GridPoint[]>>;
```

Each key is the observing team, and each value is its complete current known
blocked static cells, not a delta. The planner clones the terrain grid per active
team/decision and overlays these cells. Omitting a team preserves terrain-only
behavior. Cells must be integer in-bounds map coordinates; invalid cells throw.
No footprint, HP, hidden actor position or mutable navigation grid is added to
the configuration fingerprint or AI checkpoint.

The simulation/view owner must provide exact occupied cells for living own
buildings and applicable source-known static objects. Original SCN static
placements can remain known while unseen; this does not make hidden mobile
positions known. Do not infer shape from an anchor, unit count, sprite size, or
an approximate rectangle. Use the same verified footprint/placement producer
that populated the simulation. Snapshot `staticTargets` exposes poses/HP but
does not expose footprints. `simulation.checkpoint()` is a method; its
`staticTargets[].footprint` contains grid indices. For those targets, the owner
can project an already-authorized per-team set as follows:

```ts
const checkpoint = simulation.checkpoint();
const staticObstacles = Object.fromEntries(configuration.teams.map(({ team }) => [
  team,
  checkpoint.staticTargets
    .filter(target => target.health > 0 && knownStaticTargetIdsByTeam[team].has(target.id))
    .flatMap(target => target.footprint.map(index => simulation.grid.point(index))),
]));
```

`knownStaticTargetIdsByTeam` is owner-supplied knowledge from original static
placements/own buildings/current authorized observations, not every actor in a
snapshot. Append exact cells for any other applicable static building records
not represented as static targets. Remove cells when a known destruction or
other authorized static-world update clears occupancy, preserving overlapping
living blockers. Never construct this mask from hidden mobile coordinates or
copy the entire live occupancy grid. Persist/reconstruct the owner's knowledge
alongside the simulation so replay supplies the same observation.

For an objective inside a supplied footprint, the planner searches that connected
static footprint's in-bounds free perimeter as well as the existing nearby
goals. Candidates are ordered by squared distance to the objective, distance to
the actor, then row/column; A* must prove reachability. This covers footprints
wider than the former two-cell search. An actor already on its chosen free
perimeter holds there rather than repeatedly moving around the base. A blocked
origin is not forcibly opened: the simulation also rejects moves from it.
Visible attack selection and terrain-only fallback sight remain unchanged.

This slice does not modify the main-view/session adapter. **The owner must wire
`staticObstacles` for the live campaign fix to take effect**; omitted observations
cannot reconstruct exact footprints from snapshot target centers alone.

## Decisions and persistence

Call once per browser tick. This profile assumes browser 20 TPS and decides every
20 ticks (one simulated second); it does not claim native scheduler cadence.
Skipped ticks produce one current decision, not a fabricated native history.

Living armed mobile actors are discovered from observations, including delivered
reinforcements. Resource-owned actors, harvesters, static actors and neutral teams
are never commandeered. No money, HP, placement, spawn or SCN/TRO mutation occurs.

For mode 3, own first coordinate row is an adapted rally waypoint, followed by known hostile
SCN base coordinates (second row). Zero/zero is absent. Directed ally flags are
read by index, never interpreted as a list of team IDs. The second own row is the
home-defense anchor. Visible enemies near home are prioritized, otherwise nearest
visible enemies with stable ID tie-breaking. Unknown moving enemies never become
objectives or path blockers. Static source objectives can be approached unseen.

Original `aiSlots` are retained as persistent adapted group labels; their complete
native meaning is NOT asserted. These labels are not native policy group buffers.
Waypoint index, group label, last command signature/tick, stall count and position
persist per actor key/generation/simulation ID. Existing A* supplies passable routes
and nearby free endpoints; unreachable objectives emit nothing. Arrival or five
stationary decisions advances the waypoint. Accepted continuing commands are not
requeued; idle/stalled orders may retry after 100 ticks. There is no attack-move
simulation primitive: advance orders are interrupted by attack decisions.

Supply `visibleIdsByTeam[team]` from a current per-team source visibility producer
when available; an explicit empty array means no visible enemies. Do NOT use the
local player's fog for other teams. Missing entries use an explicitly adapted
fallback: own living source-stat observers, source day/night sight radius, and
grid ray occlusion through impassable cells. This is not native visibility,
shared allied vision, altitude or stealth parity. A hidden/dead target is not
selected; an existing mode-3 attack with no visible target is stopped at the next AI
decision (up to 20 ticks later). Combat between decisions remains the simulation's
responsibility.

Factory SHA-256 covers source scenario/tables/dependencies/grid and strategy name;
it is a configuration fingerprint, NOT native authentication. Private copied data
and frozen public config avoid source mutation. No Node/Buffer or filesystem code
is imported at runtime. The factory uses Web Crypto in a secure browser context.
Per-team xorshift RNG assigns adapted group labels and projected weight admission. It persists independently
of browser combat RNG and is NOT the original executable RNG stream.

Save `result.state` as JSON alongside simulation and selector state. Rebuild the
configuration from the same sources, then call
`restoreBrowserCampaignAi(configuration, savedState)`. Restore checks fingerprint,
version and state shape, not historical native authenticity. A fresh configuration
must be made by the factory, not deserialized as a plain object.

## Focused validation

[browser-campaign-ai.test.ts](../tools/qa/browser-campaign-ai.test.ts) covers owned
movement/visible attack, selectors0/4, directed alliances, hidden-position
independence, deaths, day/night/occlusion, exact retries, checkpoint/source/binding
rejection, discovered deliveries/generation reuse, blocked routes, defense, and
actual movement plus HP damage after enqueueing into `DeterministicSimulation`.

Five static-footprint regressions additionally cover actual 3x3/5x5 blocked bases
at `(12,3)` with a unit starting at `(2,3)`: movement at tick0, progress by tick120,
no repeated center order at tick100, and attack/damage only after supplied
visibility. They cover exact wall detours, hidden-position independence both
with explicit empty vision and the geometric fallback, directed allied mobile
actors, team isolation, real target death clearing its footprint, retained terrain
walls, stable fingerprints/fresh-factory replay, edge-map bounds, sealed routes,
and blocked origins. These controlled fixtures validate the observation API, not
automatic extraction of every original mission's static footprints by the view.

Original HUMAN02 and ALIEN02 fixtures use all original placement actors, parsed
tables/dependencies and the same source navigation mask as the view. Each runs
1,240 observation ticks and replays ticks1,000..1,239 with a fresh factory and JSON
checkpoint. The test supplies selector4-to-3 changes at tick1,000 as a labeled
bridge input, not as a claim about native TRO timing. Original selector values,
zero money, source rows and inputs remain unchanged. These source replay fixtures
hold poses fixed; the separate simulation test proves executable movement/damage.
They do NOT establish a complete live campaign, source-policy parity, trigger
integration, production, rendering or victory. Delivery tests introduce observed
actors as a controlled bridge fixture; this AI never spawns them.

Run only the owned test file with `node --import tsx --test
tools/qa/browser-campaign-ai.test.ts`. No full suite, browser, package changes,
generated assets or session/controller/view edits are required by this slice.