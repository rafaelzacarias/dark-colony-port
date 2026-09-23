# Direct Campaign Session Checkpoints

2026-09-19. Owners: `src/engine/campaign-session.ts` and the historical-binding
validation in `src/mission-view.ts`. No main, control-group, storage, simulation,
resource-host or production-reducer orchestration changes.

## API And Migration

`session.checkpoint(): CampaignSessionCheckpoint` now writes:

```ts
{
  schemaVersion: 2,
  kind: "campaign-session-snapshot",
  options: { /* source options, pathGrid/tags as number arrays */ },
  state: { /* complete current session state */ }
}
```

`CampaignSession.restore(value: unknown)` is synchronous and accepts both
schema 2 and legacy schema 1 (`campaign-session-replay`). Schema 2 initializes
source definitions for validation, decodes typed arrays and installs the saved
state directly. It never calls `step`. Legacy schema 1 still replays its input
log, can therefore be slow, and writes schema 2 on its next checkpoint. The old
100,000-input admission limit applies only to legacy reads. Existing storage and
the outer MissionView version-1 envelope do not need a schema change.

The snapshot includes native bytes, movement classes, RENAT data/allocation,
world entities and statistics, controller lives/revision/losses/delayed bail,
transport reducer/carriers/motions/occupancy/registry/generations/high-water,
resource source clock/tasks/animation/stacks, production economy/queues/clock/
pending work/reservations and semantic requests. Resource stack `taskWords`
aliases are checked and reconnected on restore. All existing resource and
production options, explicit per-frame inputs and ownership restrictions remain.

## Retention Contract

- No per-tick inputs or session frame entries are serialized or replayed in v2.
- Live `session.journal` returns a detached retained suffix, capped at 4,096
  entries by default. `journalLimit: 0` disables storage; `"all"` explicitly
  opts into unbounded diagnostic recording. `journalStats` exposes retained,
  total and dropped counts without cloning history. A v2-restored instance starts
  with empty diagnostics and journals future frames; compare continuation suffixes,
  not old histories. See [retention evidence](session-retention.md).
- `session.identityProvenance` returns detached semantic create/death/removal/
  collision-clear/unregister requests, retained in the host state. MissionView
  checks historical bindings and death/detachment boundaries through this API.
  Slot reuse does not erase old identities. There is no entry for an empty tick.
- Session-owned production bookkeeping is compacted at each successful commit:
  automatic credit-sync, idle, wait and animation-advance records are discarded.
  External command IDs and semantic producer events remain. Requests are not
  re-emitted at restore, and repeated external command IDs remain idempotent.
- Size is bounded by source/current state plus semantic provenance, not elapsed
  idle ticks. Actual unit creation/death, commands, messages and effects can
  still grow semantic history. This is not a fixed-size cap for endless combat.

## Validation

The decoder rejects non-JSON values, accessors, prototypes, sparse arrays,
unknown fields/discriminants, wrong array sizes and invalid scalar ranges before
installing state. Source initialization runs existing host/resource and production
admission checks, including native production FIN hashes and timelines. Saved
definitions/profiles/catalog/selectors/clock configuration are compared to that
initialized source. MissionView additionally compares source fingerprint/options
against the caller's loaded mission, unchanged from the previous contract.

Cross-checks cover native slot/generation/registry/raw identity and health,
creation/loss provenance, world/host bindings, task stacks and animation banks,
controller/world statistics, occupancy rebuilt through the session's existing
host path, producer queue items/tickets/costs, native exit ownership, full32
credits and allocation identities. Production eligibility is revalidated using
the existing reducer. Source day/night elapsed phase is checked without replay.
Malformed saves throw before a restored session is exposed; existing sessions
are unchanged. These checks are structural/semantic integrity, not authentication
against a coherently rewritten source and state.

## Measurements

Local macOS Node/tsx runs; JSON parsed before the timed restore. Single samples,
not latency guarantees. Full MissionView remains synchronous and has a fixed
source-fingerprint/initialization cost; this change removes elapsed-time replay,
not every possible main-thread pause.

| Fixture | Tick | JSON bytes | Restore ms |
| --- | ---: | ---: | ---: |
| Small-map session, real source definitions | 220 | 457,695 | 32.5 |
| Same | 1,000 | 457,698 | 29.9 |
| Same | 20,000 | 457,701 | 28.5 |
| Small-map session with native production | 1,000 | 486,250 | 27.8 |
| Same | 20,000 | 486,253 | 28.3 |
| Full HUMAN01 MissionView | 220 | 1,053,532 | 204.9 |
| Same | 1,000 | 1,053,537 | 192.4 |

The 20k tests assert less than 128 bytes of growth after tick 1,000, and the plain
session test replaces `CampaignSession.prototype.step` with a throwing function
during restore to prove no replay. It then compares 100 future frames exactly.
Production's idle journal stays empty; external-command deduplication is tested
separately with mid-animation paid work. Full-view tests cover 100-tick movement,
attack/audio, reservations, carrier creation, deaths, commander detachment and
delayed outcome continuation. Resource tests cover both factions' deployment,
depletion/removal and cancellation with native source profiles.

## Focused Checks

```sh
node --import tsx --test tools/qa/campaign-session.test.ts tools/qa/campaign-production-session.test.ts tools/qa/resource-session-lifecycle.test.ts tools/qa/mission-checkpoint.test.ts
npm run typecheck
```

Run results: 51 affected-slice tests passed with the two separately measured
20k tests excluded; both 20k tests passed, as did the additional full-view timing
test. Typecheck passed. No browser, agent delegation or repository-wide test
suite was run. Existing legacy samples remain readable; no stored save was removed.