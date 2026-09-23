# MissionView Checkpoints

`MissionView.checkpoint()` returns a detached, JSON-compatible version 1
`mission-view` checkpoint. Restore with the same loaded `CampaignMissionData`:

```ts
const saved = JSON.parse(JSON.stringify(view.checkpoint()));
const restored = MissionView.restore(canvas, stage, callbacks, mission, saved, audio);
await restored.initialize();
```

The factory is synchronous. It validates unknown input, restores the simulation
and campaign session through their own APIs, and returns a new view. It does not
render, publish callbacks, play audio, fetch assets, or replay session frames into
the view. A temporary clean constructor initializes source definitions only;
its initial entities are replaced, not appended. Failed validation throws without
changing the existing view. The caller owns swapping/disposal and initialization;
no UI or main-loop integration is included here.

## Exact Version Boundary

The outer MissionView format remains version 1. New saves contain a schema-2
`campaign-session-snapshot`; older nested schema-1 replay sessions remain readable.
The format preserves simulation internals and queued commands, direct campaign
state and source options, source slot/generation bindings and reverse bindings,
unit stat references/current weapon IDs/teams, static objects, selection,
waypoint routes/cursors/draft, order mode and movement stance, combat movement
intents and pending manual suppression, recorded deaths, detached IDs, pending
native reservations, explored cells, camera/focus state, cached messages/carriers,
outcome/diagnostic, and source animation action/facing/start tick.

Simulation and session checkpoints remain owned by their respective classes.
Native Inspire's external adapter is rejected by the simulation checkpoint API.
MissionView does not opt into the resource runtime. Source bindings must cover
the live simulation entities; injecting unrelated entities directly into the
public simulation is outside this source-bound view format.

The source fingerprint is the complete canonical JSON identity, not a short or
collision-prone checksum. It includes the scenario ID, source path/SHA-256,
raw headers/placements/team data, scripts, messages, unit/weapon/damage data,
map dimensions and metadata, all loaded navigation/tag/terrain planes, and
asset metadata/URLs. Typed arrays normalize to numeric arrays and object keys
sort deterministically. Equivalent loaded data is accepted regardless of object
identity/key order; changed data is rejected. This is intentionally larger than
a digest. It does not authenticate checkpoints or re-hash unloaded image files.

Validation rejects unknown versions/fields, non-JSON values/prototypes/accessors,
duplicate identities, invalid IDs/coordinates, inconsistent source bindings,
source/session option mismatches, map costs, missing unit metadata, invalid route
cursors, and inconsistent cached carriers/messages/outcomes. Historical identities
are checked against initial source entities, durable creation provenance and the
current world so slot reuse does not erase older bindings. Recorded deaths and
detachments use `session.identityProvenance`, not the per-frame session journal.
Nested engine/session state uses those APIs' own validation. Schema-2 restoration
does not call `CampaignSession.step`; the restored public journal starts empty
and records only subsequent steps. Live, uninterrupted journals remain complete.

See [direct session checkpoints](campaign-session-checkpoint.md) for the nested
schema, validation boundaries, legacy migration, retention policy and timings.

## Presentation Lifecycle

Canvas, DOM, audio manager/state, images, textures, palette/atlas caches, renderer
fallback status, and disposal state are not serialized. Pass fresh live surfaces
and optionally an audio manager; call the existing cancellation-aware
`initialize()` lifecycle to load assets. A disposed view cannot be checkpointed.

The restored clock starts empty with no previous wall-clock sample. Its first
`update(time)` establishes the new origin without advancing. Fractional elapsed
time is discarded, interpolation starts at zero, and the previous render snapshot
is the restored current simulation snapshot, preventing interpolation from the
temporary constructor's units. Animation state is retained. Historical combat
audio is not presented again; subsequent ticks present new events normally.

## Focused Verification

```sh
node --import tsx --test tools/qa/mission-checkpoint.test.ts
npm run typecheck
```

Tests cover real HUMAN01/ALIEN01 mid-carrier saves and actual live movement,
attacks, waypoint drafts/routes, exploration, pending manual orders and native
reservations. Restored/uninterrupted snapshots and journal entries are compared
for 100 ticks, including subsequent audio events. A separately labeled accelerated
combat fixture exercises eleven source deaths, commander pickup/detachment and
delayed outcomes; it is not a native balance acceptance test. Additional cases
cover malformed/source-mismatched input, detached export data, reset interpolation,
clock reset, and disposed initialization. No browser or full-suite gate is implied.