# Source Host Ground Visibility

## Scope

Opt-in HUMAN02 source host/session integration of the unchanged
[native visibility owner](native-visibility-owner-20260920.md), now verified with
all 14 eligible fresh producers and no exclusions. The new 37-case ground
matrix and preserved 28-case bounded matrix remain separate native evidence. No trace is
used as runtime configuration. No MissionView, scheduler, assets or packages
were changed by this integration.

All 21 original SCN actors remain registered in their original slots. Real
`reinforce2` allocation can extend that world. Each caller must explicitly
partition all eligible producers into ascending `producerSlots` and
`excludedProducerSlots`. Admission uses the source factory's authenticated
`producerProfiles`, not a blanket type range or a host-owned 0/8 list. Exact
supported IDs are 0, 2, 8, 10, 16, 17, 28, 29, 41, 69, 73, 81, 84, 86, 89, 91.
The host already delegated this decision to the pure owner; the stale test
expecting CITY slot 5 to reject has been replaced with an ineligible-slot guard.
Explicit exclusions remain valid bounded experiments, not evidence that the
original game skips those actors. They are unnecessary for fresh HUMAN02.

The full host positive is HUMAN02 only. ALIEN02 has separate pure/native proof
(44 actors, 41/41 eligible, no exclusions), not host/session combat admission.
The combat provider remains HUMAN02-only; no factory was broadened to admit
ALIEN02 or commander combat. Source constructor cases for commanders 69/73
remain part of the pure native matrix, not a new host lifecycle claim.

## Configuration

[createSourceNativeVisibilityHostConfiguration](../src/engine/source-native-visibility-host.ts)
requires full original EXE/GAMESTAT/SCN/MAP/BTS/MTG/PTH bytes, the freshly
authenticated combat-task configuration and the same pre-install source world.
It checks the task world attestation, parsed SCN identity, dimensions and source
path families. The static source factory pins the complete asset hashes and
derives the actual native loader terrain/tree/type fields. Local team, alliance
mask, daylight and initial CRT seed are explicit caller-owned options; neither
wall time nor the session cycle derives them. Reveal overrides remain zero.

The host captures each of the seven typed byte inputs once, into private
`Uint8Array` copies before asynchronous hashing. Parsed-SCN attestation and
source hashing consume the same copy. SharedArrayBuffer-backed bytes are
accepted only through that copy boundary; later caller mutation cannot change
the configuration. Ordinary arrays still reject. Full source-world attestation
also rejects changed actor type bytes or type-movement enumeration.

```ts
const combatTasks = await withSourceNativeCombatTasks(taskConfiguration, proof);
const visibility = await createSourceNativeVisibilityHostConfiguration({
  assets: visibilityAssets,
  tasks: combatTasks,
  world: initialWorld,
  localTeam: 0,
  localMask: 0x40000000,
  daylight: 0,
  crtSeed: 1,
});
const providers = await createSourceNativeCombatOptions({
  configuration: taskConfiguration,
  proof,
  death: true,
  sound,
  visibility,
});
const session = new CampaignSession({ ...sessionOptions, ...providers });
```

`visibility` is identity-authenticated with a private WeakSet and deeply frozen
source data. Clones and lookalikes are rejected as external authority. It is
embedded in the immutable combat configuration and bound to its exact task
source ID. The sound factory remains separately opt-in; its initial CRT seed
must agree. No audio configuration is required merely to compute visibility.

Current terrain is the authenticated loader terrain plus the already-owned
host resource bit-26 field, indexed with reversed map Y. Other terrain changes
are rejected. Runtime metadata class `type+0x78` must be zero for every active
actor, including excluded producers. Producer radius/flight/detection fields
must match source values; unowned runtime upgrades are rejected. Existing source
SCN upgrades and combat/task source authentication are retained unchanged.
Pinned CITY profiles use `ground-unpruned` and may retain their constructor
altitude 600; their source `type+0x60 = 1` is not an aircraft permission. The
native city workers do not prune children on terrain bit 29. Other supported
ground profiles require altitude zero. Selected actors must remain status 1;
dying producers, aircraft, special/reveal profiles, reveal overrides and
nonzero current metadata classes remain rejected. The source profile map is
frozen and identity-authenticated, never a caller-supplied or serialized token.

## Explicit Phase API

```ts
const result = session.stepVisibilityForNativeView({
  visibilityFrame: {
    sequence: 1,
    counter: 0,
    producerSlots,
    excludedProducerSlots,
  },
});
```

- `stepVisibility` returns the full session frame and `entry.visibility` receipt.
- `stepVisibilityForNativeView` uses the existing private projection and returns
  `visibilityEvent` alongside `visibility.groundWords`. It does not copy source
  tables into the view result.
- `stepTransportHostVisibility(world, frame)` is the lower-level atomic host
  boundary; its result contains the candidate world and event.

Only `{ visibilityFrame }` is accepted by session visibility entry points.
They perform no actor visits, projectile visits, receipt intake, TRO scans,
production, resource, CITY or full-policy work. Clock, cycle counter and host
tick do not advance. The existing combat exclusivity guards still apply.

The caller models `0x419a30` testing `game+0x94c & 15`, followed on zero by
`0x419a39 -> 0x4456f0` clear and `0x419a41 -> 0x44a6d4` compute. It does not
assert where that slice belongs relative to `0x419248` actor visits, does not
call `0x439f40`, and does not equate visibility `+0x94c` with actor/resource
`+0x530` or a session counter. Applications explicitly order separate calls.

Sequence starts at 1 and must increment exactly once per accepted phase,
including false predicates. Duplicate/skipped sequences reject. Native
counter values may legitimately repeat or wrap: sequences 1/2 with counters
0/0 are two explicit caller invocations, not an accidental duplicate phase.
Counters with nonzero low nibble leave planes, raw actors and both RNG domains
unchanged, but still record their accepted caller receipt.

The candidate owns full ground flags through `nativeAiTasks.ground`, all raw
actors through `world.entityBytes`, and detection bytes coherently through
every corresponding `slot.nativeAiTask.raw`. Unowned actors' raw detection is
updated too. Registry/high-water come from the current host, not a truncated
producer list. Bit 31 is persistent local exploration; bits 23..30 are current
team sight. The visibility phase does not consume either RNG or publish audio.

## Replay And Publication

`nativeCombat.visibility` contains the mutable sequence and phase journal.
Each event records counter, sequence, selected/excluded lists, executed phases,
ordered-write count and unchanged RNG/CRT values. The primitive still returns
the exact ordered writes. `nativeSourceInputs` records every actor and visibility
input in order, independently of the bounded presentation journal. Replay
recomputes the phases and compares the entire resulting state and journals.

Restore retains the existing five-argument API:

```ts
const restored = CampaignSession.restore(checkpoint, undefined,
  freshProviders.nativeAiTasks, undefined, freshProviders.nativeCombat);
```

Fresh factories authenticate the expected external configuration, including its
visibility identity. Checkpoint JSON never establishes that identity. Missing
history or modified ground, RNG, detection bytes, sequence, journal, source
configuration or phase order rejects. Replay and the view entry point use the
private projection rather than repeatedly returning whole source tables.
Forks share immutable configuration but detach planes, raw buffers and journals.
Projection failure and late actor-frame failure cannot publish candidate changes.

Death sound continues through the existing committed `native-death-sound`
request; there is no new audio dispatcher. Consumers must publish only after
the outer transaction commits. Persistent exploration from the visibility
history feeds the actual native death gate, not a view-side fog approximation.

## Evidence And Limits

### Full Fresh HUMAN02

The exact daylight-0 producer list is:

```ts
const visibilityFrame = {
  sequence: 1,
  counter: 16,
  producerSlots: [0, 1, 5, 152, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165],
  excludedProducerSlots: [],
};
```

All 21 original actors and registry identities remain intact, high-water 170.
Slots 153..155 (`+0xcb = 1`) and neutral team-8 slots 166..169 are ineligible,
not excluded. The native radii are 9 for slots 0/1/5 (types 16/17/81), 8 for
slot 152 (type 84), and 4 for slots 156..165 (type 8). No actor status is edited
and no exploration bit is injected in this positive.

The host matches every native ground word and all **10,487 ordered caller
writes**, yielding **411 explored / 411 team-0 sight**. Its source-normalized
raw actors match the pure result completely. Against native actors, all fields
read by visibility are exact: Q8 position/altitude, type, team, temporary reveal,
status and detection bytes. FIN pointer normalization is not falsely presented
as complete native raw220 identity. Registry, high-water, initial planes and
combat RNG also match. Native CRT begins at 0; this host's explicit audio
boundary begins at 1. Both remain unchanged, not conflated as identical startup.

A subsequent explicitly all-excluded caller gives **411 / 0**, and a full
recompute restores the entire original ground snapshot. Each phase restores
with fresh authenticated providers and compares the complete checkpoint,
including every input field, selected/excluded lists and journal. Compute and
recompute record `excludedProducerSlots: []`. Clock, actor visits, controller,
projectiles, registry, source tables and sound state do not advance.

The separate [view method test](../tools/qa/source-native-visibility-full-view.test.ts)
calls existing `advanceNativeVisibility`, snapshot and getter APIs only. It
verifies all 14 producers, exact 411-cell visibility/exploration, detached
outputs and full fresh-provider restore, with no view/render/terrain edits and
no browser. The main browser owner can now use the all-producer HUMAN02 input
above at an explicit visibility phase; this is not a browser playback or
whole-mission scheduling certification.

Runtime negative controls retain unsupported types 1/5/13/45/46/92, dying and
invalid-altitude rejection, ineligible producer rejection, all four current
source visibility-field guards, metadata checks even for ineligible actors,
reveal override rejection and terrain mutation rejection. Stage-only controls
use canonical host copies to reach those checks; mutated worlds/configurations
are not asserted to be valid source-owned lifecycle transitions.

### Preserved Bounded Sound

[Host tests](../tools/qa/source-native-visibility-host.test.ts) use source-byte
factories and genuine host allocation, movement, projectile damage and death:

- Original 21 actors preserved; two real source troops add slots 170/171.
- After 31 actual hits, producer 171 naturally explores victim 170 at cell
  1291. Visibility counter 0 computes; a separate counter-16 caller with every
  producer explicitly excluded clears current sight but retains exploration.
- Actor counter 614 delivers hit 32 and HP 0. Exactly one committed request
  is sound 28, `SOUND/TROPDEA3.WAV`, slot 170/generation 0, Q8 `(11124,3456)`.
- CRT starts at explicit boundary seed 1 with the real DEA descriptor, advances
  to 1103527590, and selects descriptor index 2 for the next death. Visibility
  does not advance combat RNG or CRT. The next death-task visit emits no repeat.
- Full interleaved history restores with fresh providers. A late lethal-frame
  failure rolls back audio, ground, actors, RNG and both histories.

This is a genuine host sound-request positive, not a manual bit-31 control and
not a browser playback test. The seed-1 bootstrap proof at `0x469754` is
independent native evidence; this caller explicitly starts there and has no
unowned intervening CRT consumers. It does not authenticate arbitrary mission
audio history, all-world service order, full original TRO, arbitrary dynamic producers,
nonzero metadata classes, mutable alliance/daylight, or a complete mission.
Those remain outside the bounded admission.

Preserved oracle: `/tmp/dc-visibility-matrix-own31.jsonl`, SHA-256
`66bf4aeab4b08ce1d9e919ee871ea2298aee916bc29e427da8d7bd1cbe66a22c`.
Natural integration log: `/tmp/dc-vis-host-natural-20260920-final.log`.
Two new host tests, three existing combat regressions and the 30-test native
matrix selection passed without skips. The matrix selection comprises the
28 preserved native cases, rejection coverage and its parent test. Strict
TypeScript/no-unused validation and editor diagnostics are clean.
Valid-shaped ground/RNG/detection tampering specifically fails complete replay,
not merely JSON shape validation. A separate labeled detection-byte control
checks atomic reset in both owned and unowned actors; it is not the natural
visibility/audio positive.

Final logs: `/tmp/dc-vis-host-replay-final-20260920-a1.log`,
`/tmp/dc-vis-host-regressions-20260920-final.log`,
`/tmp/dc-vis-host-matrix-20260920-final.log`,
`/tmp/dc-vis-host-types-20260920-final2.log` and
`/tmp/dc-vis-host-docs-20260920-final.log`.
No full suite, browser, agents, package changes or asset generation were used.

### Full-Producer Integration Verification

The historical logs above remain bounded evidence. This follow-up passed
**90 distinct focused checks**: 21 host/view checks (including 15 runtime guard
subtests) plus 69 pure matrix checks. Zero failures, cancellations or skips in
the completed runs. The 37 new native cases cover 185 phases and **1,038,548
ordered phase writes** (311,226 caller writes); the old 28 cases retain all
**196,473 caller writes**. ALIEN02's pure fresh result is **452 / 452** at
daylight 0 with all 41 producers and all 44 original actors retained.

New capture: `/tmp/dc-vis-ground-matrix-g21.jsonl`, SHA-256
`c206618bed6e596b5f7df9af07854dd3d5a4e4374857a7485dfe2d3a1ad8279b`.
The old capture SHA-256 remains exactly the value recorded above.

Measured wall times on this machine, not frame-rate guarantees:

| Check | Time | Log |
| --- | --- | --- |
| Full HUMAN02 host parity + three phase restores | 14.53 s | `/tmp/dc-vis-fullhost-parity-20260920-h05.log` |
| Single full visibility host call within that test | 28.81 ms | Same log |
| Existing sequence/partial/bounded replay guards | 25.42 s | Same log |
| Runtime controls + view test, combined process | 17.88 s | `/tmp/dc-vis-fullhost-guards-view-20260920-h07.log` |
| View method/restore test within that run | 13.34 s | Same log |
| Final source identity/SAB/type-enumeration test | 2.05 s | `/tmp/dc-vis-fullhost-auth-20260920-h14.log` |
| Both native matrices | 5.45 s | `/tmp/dc-vis-fullhost-matrices-20260920-h12.log` |
| Preserved natural lethal-sound/replay case | 170.22 s | `/tmp/dc-vis-fullhost-natural-20260920-h09.log` |

Counts, producer radii and capture hashes are recorded in
`/tmp/dc-vis-fullhost-evidence-20260920-h13.log`. Strict scoped TypeScript and
no-unused validation covers the host and both tests. This follow-up changes
only the visibility host, its tests and this document; the pure visibility
owner, source factory, combat factory, session, view and terrain are untouched.

```sh
DC_VISIBILITY_GROUND_MATRIX=/tmp/dc-vis-ground-matrix-g21.jsonl \
  node --import tsx --test tools/qa/source-native-visibility-host.test.ts \
  tools/qa/source-native-visibility-full-view.test.ts
DC_VISIBILITY_GROUND_MATRIX=/tmp/dc-vis-ground-matrix-g21.jsonl \
DC_VISIBILITY_MATRIX=/tmp/dc-visibility-matrix-own31.jsonl \
  node --import tsx --test \
  --test-name-pattern='^(ground visibility matrix:|source visibility matrix:)' \
  tools/qa/legacy-native-visibility.test.ts
```