# Simulation Resource Actor Ownership

2026-09-19. Scope: [simulation](../src/engine/simulation.ts) and
[focused tests](../tools/qa/resource-actor-ownership.test.ts). No view, session,
transport, main or game-data implementation changes.

## Contract

The previously proposed simulation APIs now exist. They do not by themselves
admit LIVE harvest commands or prove native moving-harvester handoff.

- `registerResourceActor(identity, profile)` optionally binds an existing,
  quiescent mobile actor before simulation movement. Identity includes
  `simulationId`, native `slot`, `generation` and `key`. It returns an ownership
  token with `ownershipGeneration: 0`.
- `claimResourceActor(token, profile)` atomically transfers that same actor to
  the resource host and increments the ownership generation. An unregistered
  actor can be claimed directly with generation zero, including an explicitly
  sourced deployed resume. The profile must supply a constructor/resume task
  owner, evidence identifier and complete native task payload; activity text is
  not admission evidence. Constructor admission checks the actual 160/128
  directions, EXPL/SLUG stand FIN state and `[65535,0,0]` idle words.
- Claims reject movement, attack, cooldown, harvesting, cargo, reservations,
  incoming attackers, recent combat, queued orders (including future stop and
  incoming attack), stale identities and conflicting slot ownership. Source
  Inspire ownership remains incompatible and its checkpoint rejection is
  unchanged. No new callback-based adapter is introduced.
- `publishResourceActors([{token, profile}, ...])` validates the entire batch
  before changing any actor. Current profile and identity are available through
  `resourceActors` and `snapshot.units[].resourceActor`, as detached copies.
- `requestResourceActorReturn(token)` records a checkpointable pending return.
  The actor remains host-owned and cannot execute simulation commands.
- `releaseResourceActor(token, acknowledgement, profile)` requires the exact
  ownership generation, `hostReleased: true`, a released host task, and a
  separately supplied source-idle acknowledgement. This includes evidence,
  matching mobile type, canonical idle words and the actual signed-byte facing
  (`160 -> -96`, `128 -> -128`), not a fabricated zero direction. Publication
  of a released host task without acknowledgement blocks the next simulation
  update before mutation. Release does not invoke or emulate an idle initializer.

The host evidence identifier is caller-supplied provenance, not an executable
proof certificate. The host/orchestrator remains responsible for supplying an
actually sourced constructor, resume or source-idle state. In particular,
**native idle transfer is not proved by this API**.

## Profiles And Events

`ResourceActorStateProfile` is distinct from immutable source unit statistics.
The retained mutable mapping admits only source type pairs 6/47 and 14/48 with
their original simulation ID, team and faction. A profile publishes native
identity, integer Q8 position, full nonnegative signed-32-bit HP, maximum HP,
speed, explicit nonweapon/non-synthetic-harvester settings, source defense,
vision, ground occupancy, status, task name, direction byte, FIN bank/frame/
delay/mode, pending/order bytes, released flag and complete logical task stack.
Task words must match the top stack payload. Copies and restore reconnect that
canonical reference. Type and defense source indices must agree. HP is not
clamped to a private source-stat constant.

While resource-owned or pending return, actors reserve host-published occupancy
and expose updated position/HP/type to selection consumers, but do not move,
attack, receive simulation combat or collect synthetic resources. Combat against
them requires a future explicit host combat contract, not two HP writers.

`movementFinishedEvents` comes from the actual path-completion branch. Events
contain `unitId`, tick, final native `finalXQ8`/`finalYQ8`, and, when registered,
the native identity and ownership generation. Simulation subcells are 1024 per
tile; these events convert to native 256-per-tile Q8. Reservation, partial
movement, blocked paths, stationary orders and stop do not produce completion.
The event does not initialize native idle or authorize a claim without a task
owner payload. It is a last-update event, checkpointed and cleared next update.

Publishing an explicit host death task with a positive-to-zero HP transition
emits `resourceActorEvents: combat-death` and exactly one normal `deathEvents`
entry on the next simulation advance. Zero HP during a removal task is not a
kill. `removeResourceActor(token, "remove-noncombat")` removes the projection,
retains an identity tombstone, emits a distinct noncombat event and never emits
a death. Native slot reuse requires a strictly newer generation. Neutral type-40
sources remain in the host, not fictional faction-8 simulation combat actors.

## Checkpoints And Boundaries

Checkpoint version stays 1. Optional `resourceActors`, `resourceActorEvents`
and `movementFinishedEvents` fields allow older v1 checkpoints to restore.
Ownership records retain the original admission profile/token, current host
inputs, canonical stack, pending-return generation and release acknowledgement.
Restore validates these directly, including native identity cross-checks,
stale ownership generations, mismatched payloads, edited signed directions,
conflicting commands and disagreement with the simulation projection. Unsupported
schema fields and source-Inspire adapter serialization remain rejected.

Transactions validate a candidate checkpoint before committing simulation state;
failed claims, batches and releases leave state unchanged. This is atomicity
inside the simulation, not a new cross-session transaction. The live incoming
resource binding/release input contract is still outside this change. A detached
session snapshot is not mutated to impersonate that missing contract.

After acknowledgement, the retained host profile describes the last handoff;
normal simulation movement can subsequently change simulation coordinates. A
new claim must provide current matching Q8/HP and an explicit sourced task owner.
No moving-harvester or native-idle parity claim is made here.

## Verification

The labeled same-tile HUMAN/ALIEN fixtures use original unit/weapon tables,
source FIN metadata and explicit constructor directions/task payloads. Existing
session and transport APIs deploy 6/14 to 47/48, generate positive canonical
credit income without simulation grants, retain the same actor ID/key, and
replay session and simulation checkpoints from mid-extraction. These fixtures
are not original mission admission and do not exercise movement-to-native-idle
handoff. Release tests use explicitly labeled scripted source-idle payloads.

```sh
node --import tsx --test tools/qa/resource-actor-ownership.test.ts
node --import tsx --test tools/qa/simulation-checkpoint.test.ts tools/qa/simulation-diplomacy.test.ts
npm run typecheck
```

No agents, browser tests or full suite are needed for this bounded API change.

Final focused run: 36 tests passed (12 ownership/integration cases and 24
checkpoint/diplomacy regressions). The owned files have no editor diagnostics.
Repository typecheck was blocked by TS2339 at
[legacy-harvester-idle.test.ts](../tools/qa/legacy-harvester-idle.test.ts#L86),
outside this change's ownership; that file was not modified here.