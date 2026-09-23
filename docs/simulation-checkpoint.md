# Deterministic Simulation Checkpoints

## API

Implemented in [simulation.ts](../src/engine/simulation.ts):

```ts
const checkpoint = simulation.checkpoint();
const json = JSON.stringify(checkpoint);
const input: unknown = JSON.parse(json);
const restored = DeterministicSimulation.restore(input);
```

`checkpoint()` returns a detached `SimulationCheckpoint` with `version: 1`.
Its data consists of ordinary objects, arrays, strings, finite numbers, booleans
and null. There are no typed arrays, maps, sets, functions or undefined fields.
The returned data is not frozen and can be stored independently. Mutating it
does not mutate the simulation. `restore(unknown)` validates the input and copies
it into a new simulation; later mutations to the input cannot affect that instance.
Restored profiles, coefficient arrays, alliance rows, paths, footprints and
immutable unit stats are copied/frozen as appropriate.

Capture between synchronous public operations, ordinarily immediately before or
after `advance()`. This is a simulation checkpoint, not an animation snapshot or
an in-progress update continuation. Subsequent identical commands, grid edits and
RNG calls produce the same future state and events. No RNG draws occur during
capture or restore. The stored nonzero xorshift state can be restored using the
existing RNG constructor, so no random-generator API change is needed.

## Preserved State

- Tick, entity-ID high water mark, command-sequence high water mark, and the full
  future command queue in tick/sequence order. Deleted IDs are not reused.
- Grid dimensions and every current uint16 traversal cost. Each static blocker
  also retains its overlap count and its separate pre-blocker `priorCost`.
  NavigationGrid has no additional original-cost array. Current costs are not
  recomputed from footprints: public grid edits while blocked must survive too.
  The last overlapping target's death restores the saved prior cost, including zero.
- Every unit's position, speed, activity, health, path, path cursor, reserved
  destination, weapon, source damage/defense profiles, vision, cooldown, target,
  harvester stats, cargo, resource target, dropoff and harvest phase.
- Resource nodes and remaining amounts; faction resources; buildings and ordered
  construction queues, including progress, costs, reserved cells and health.
- Static targets, including dead targets, positions, footprints, teams and profiles.
- Movement-reservation map and owner sets, preserving insertion order.
- Team-alliance rows, fallback day/night cycle length and full source day/night
  state, including transition blend, elapsed counter and phase.
- Combat, death, source-damage diagnostic and movement-reservation event buffers.
  These remain observable immediately after restore and clear on the next advance
  exactly as they do in the original instance.

## Validation

Version 1 uses a fixed, explicit schema, not a generic object serializer.
`restore` accepts `unknown`; TypeScript assertions are not a substitute for the
runtime checks. Unsupported versions, missing/extra fields, accessors, exotic
object/array prototypes, sparse arrays, functions, nonfinite numbers, invalid
enums and out-of-range values are rejected. Safe integer checks cover counters,
IDs, costs and integer stats. Static-target positions may contain finite fractional
subcells, matching the existing API.

Cross-checks include grid size and positions, unique entity IDs below the high
water mark, path cursors, cargo/cooldown bounds, target/resource kinds, unique
construction reservations, live-footprint blocker counts, reservation owners,
command ordering and sequence uniqueness, and last-tick event references.
Validation completes before constructing or publishing a new simulation. A failure
throws without modifying the supplied checkpoint or any existing simulation.

Some references intentionally need not resolve to a currently present entity:

- `removeUnit()` can leave an attack target, last-tick events and movement
  reservations referring to an already allocated unit ID. Restore preserves these
  historical references; the normal next update handles them.
- Queued commands may refer to removed, unknown or not-yet-created entities. This
  permits commands aimed at a building that an earlier construction will create.
  IDs must be positive safe integers; IDs that currently resolve must have the
  appropriate entity kind. Normal execution still decides whether an order acts.

Checkpoint validation is stricter than the deferred `queue()` API: malformed
commands, out-of-grid coordinates and wrong-kind references must be removed or
corrected before capture, even if executing them would otherwise be a no-op.
Health above maxHealth and source elapsed counters beyond the cycle length are
allowed because existing public creation APIs permit them. Validation is not an
authenticity check: changing a value to another coherent, in-range value cannot
be detected without an external signature. Apply file-size limits before parsing
untrusted saves; this API is not a sandbox for adversarial JavaScript proxies.

## Unsupported Boundary

**Any configured external `nativeInspire` adapter makes `checkpoint()` throw, even
when it has no registered entities.** Its callbacks own update order, occupancy,
positions, RNG index, task transitions and other external state. There is no
verified adapter state export/import contract, so version 1 does not serialize or
silently discard those callbacks. No adapter option is accepted by restore, and
extra adapter/registration/event fields in input are rejected. Without an adapter,
the Inspire maps and event buffer are necessarily empty. A queued Inspire command
without an adapter retains its existing runtime rejection behavior.

Current live missions do not configure this adapter. Source combat profiles and
source day/night state do not themselves require it and are supported.

This API does not restore mission-view, main, game-data, session, campaign world,
transport, orchestration, rendering, audio or other caller-owned state. A caller
must reconnect its own references and supply subsequent external inputs. No such
integration is introduced here, and this is not a complete mission/session save.

## Focused Verification

[simulation-checkpoint.test.ts](../tools/qa/simulation-checkpoint.test.ts) compares
snapshots, complete checkpoints and all event getters immediately after JSON
restore and across 100 further ticks. Fixtures cover mid-path reservations,
cooldowns and targets, simultaneous lethal combat, future commands and IDs,
all harvest phases and cargo, construction queues, overlapping blocker deaths,
independent current/prior costs, source transitions, teams and both damage-profile
forms, diagnostics, RNG/rejection sampling, detached data, removed-unit references,
adapter rejection and malformed/tampered inputs.

```sh
node --import tsx --test tools/qa/simulation-checkpoint.test.ts
```

Only focused tests and a TypeScript check of the simulation/test dependency slice
were run. No browser, agent, full-suite or mission/session integration test is part
of this verification.