# Trusted Immutable Task Configuration

## Boundary

[Source task options](../src/engine/source-native-task-options.ts) retain a private WeakMap from verified, deeply frozen configurations to their canonical content. Only factory-created configurations or private plain-data copies that pass complete canonical authentication enter it. Mutable external values are never identity-cached. Their copies reject accessors, custom prototypes, toJSON functions, hidden properties, sparse arrays, cycles, typed arrays and shared storage before serialization. JSON and structured-cloned authenticated configurations remain supported.

Dynamic allocation constructs and authenticates a new configuration. It does not mutate an existing configuration or change its cached value. Combat composition snapshots mutable input before asynchronous hashing. Generic trigger transactions still clone their inputs; the session reauthenticates their resulting configuration into private immutable storage before commit.

[Transport host](../src/engine/transport-host.ts) and [campaign session](../src/engine/campaign-session.ts) use an internal clone path that retains only authenticated immutable task configuration references. Actor bytes, planes, cursors, projectile pools, input histories and journals remain independent. Public transport/session snapshots and checkpoints remain detached and mutable. Public restore still validates external providers and completely replays native caller history. Actor identity/raw alignment, occupancy, pool and RNG validation remain on every frame. Legacy v1 authentication is not identity-cached.

## Measurement

Run from the repository root:

```sh
node --import tsx tools/qa/native-immutable-config.perf.ts
```

This uses the unchanged native combat MissionView fixture: first 20 actual advances, real allocation at frame 16 and Attack receipt at frame 17. No restore or browser is involved. Input snapshot reads are measured separately from advance time. Baseline is the preceding read-only profile; the after measurement ran without another test process.

| Measurement | Before | After |
| --- | ---: | ---: |
| Total 20 view advances | 23,524.09 ms | 8,472.65 ms |
| First five advances, mean | 990.62 ms | 277.45 ms |
| Ordinary session fork | about 56 ms | 6.04 ms |
| Ordinary canonical serialization | about 450 ms | 8.07 ms |

Total advance time fell 63.98%, or 2.78x faster. Ordinary task-configuration canonical serializations are zero; 21 smaller canonical calls remain. The complete public snapshot is still 13,162,737 JSON bytes, including a 10,841,240-byte task configuration with 48 profiles.

Remaining ordinary advance cost is dominated by structured clones (217.23 ms mean), including a detached session snapshot (56.40 ms). Frame 16 still costs 2,744.87 ms for allocation, full-content authentication and generic transaction copies. Public input reads add about 110 ms ordinarily and are not included in advance totals. MissionView was not modified. This is not a 60 FPS result.

Final frame-20 snapshot SHA-256:

```text
71476fbd9e115e882a1768f243be76428ee8e3ae4ac71fdfcd500a7728d9edc3
```

## Verification

46 focused tests passed: 18 source task/combat tests, 8 selected legacy native-host guards, 12 transport tests, 7 selected normal-session isolation/replay cases and the unchanged MissionView native integration test. Coverage includes warm-cache nested mutation, rejected forged objects, async source races, mutable authenticated-clone compatibility, parent/fork/sibling isolation, new binding allocation, shared-storage rejection, strict external restore and tamper rollback.

The original mixed-world and MissionView tests retain all 21 original actors plus two allocated troops, a real frame-87 hit (HP 800 to 775), one launch/impact/reclaim, damaged reaction, fresh-provider restore and atomic frame-96 failure. Strict scoped TypeScript compilation passed for all changed code/tests and the benchmark. No agents, browser, full suite, packages or assets were used or changed.