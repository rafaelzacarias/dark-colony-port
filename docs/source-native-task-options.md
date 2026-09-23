# Source Native Task Options

## Factory

[createSourceNativeTaskOptions](../src/engine/source-native-task-options.ts) returns an authenticated, recursively frozen `NativeAiTaskConfiguration`, not a readiness flag.

```ts
const configuration = await createSourceNativeTaskOptions({ assets, world });
validateSourceNativeWorld(configuration, world);
const installed = initializeTransportHostNativeAiTasks(world, configuration);
if (!installed.ok) throw new Error(JSON.stringify(installed.diagnostics));
const ownedWorld = installed.value;
```

`world` is the actual fresh initialized transport world. `assets` contains byte arrays for the original executable, GAMESTAT, WEAPSTAT, SCN, MAP, MTG, PTH, and generated TRSC/GRAY/REAP/BARR FIN metadata. See `SourceNativeTaskAssets` for the exact property names. The factory clones inputs before its first asynchronous operation.

The admitted asset bundles are HUMAN01, ALIEN01, HUMAN02, and ALIEN02. Every bundle component, the executable, the statistics tables, and each decoded FIN asset must match a compiled source digest. Callers cannot supply a trusted digest, a replacement type record, a FIN pointer, or an arbitrary profile blob. A different original mission needs an additional verified bundle pin; changing coordinates does not require actor-snapshot pins.

## Source Attestation

- Executable SHA-256: `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
- GAMESTAT columns use the original `0x43bbc5` scanner destinations, including turn speed, movement speed, path class, heading, and idle controls. Weapon range comes from the pinned WEAPSTAT parser. The random table is read from the pinned executable at `0x478e04` through its PE section mapping.
- The factory parses the actual full SCN and verifies the world's source identity, all registered actors, source-row uniqueness, reserved city projection, type definitions, race fields, PTH eligibility, raw protected fields, and registry completeness. It does not replace disabled teams, city rows, or source placements with synthetic entries.
- Each source row must retain its `placement:<row>` identity and exact native slot: 152 plus the number of preceding entity-producing rows. Rows with fourth field -1 are RENAT records and consume no slot. RENAT metadata/bytes, allocation counters, source tails, script flags, source maximum health, counterpart types, reserved city identities and the complete host occupancy planes are checked. Type-37 coordinate-queue worlds remain unsupported. A coherent permutation of raw records, entities, registry, generations and occupancy is rejected, never sorted or repaired. This local allocation check has no runtime import of campaign-session or campaign-world, avoiding a factory/transport initialization cycle.
- SCN race remapping is validated for placed actors. Direct allocation uses the requested source unit definition without applying SCN counterpart remapping again.
- FIN banks are host-normalized **field identities**, not universal virtual addresses: stand is `typeId * 2 + 1`, move is stand plus one. Native tests extract the actual `+0x80` and `+0x7c` addresses and compare all 32 directional timelines before normalizing actor pointers. The original nearest-direction fallback and source duration conversion are retained.
- Type and weapon arrays are projections for the fields consumed by the bounded task owner. They are not complete native combat records. Unowned FIN/combat fields must not be inferred from their zero-filled storage.
- The `nativeactor-source-v2:` identity binds asset hashes, source-column mapping, constructor version, canonical profiles, initial source planes, and a SHA-256 digest of the complete fresh world. That world includes every byte of all 800 raw220 records (including unowned obstacles, city and unused slots), all host records, registry/generations, entity identities, placement metadata and host tables. Authentication additionally checks the complete configuration content, including bindings, generation, key, and expected bytes. JSON configuration clones work in the authenticated process; changed profiles or bindings do not. A new process must rebuild authentication from source assets and the initial world.

### Transport Owner Guard

```ts
import { validateSourceNativeWorld } from "./source-native-task-options";

// After configuration authentication, before any constructor writes:
if (configuration.sourceId.startsWith("nativeactor-source-v2:")) {
	validateSourceNativeWorld(configuration, world);
}
```

Exact API: `validateSourceNativeWorld(configuration: NativeAiTaskConfiguration, world: CampaignWorld): void`. It is synchronous, returns normally on success, throws a `Source native task:` error on failure, and mutates neither argument. The [transport owner](../src/engine/transport-host.ts) now calls it inside the initial handshake's existing error boundary, before raw rewriting or publishing, without an intervening asynchronous operation. No configuration-interface change or public caller-supplied attestation field is needed. The factory retains immutable canonical strings privately by source ID; a second valid world gets a different identity and cannot replace the first world's attestation.

This is an initial-install guard only. Already installed worlds and dynamically extended configurations must not use it as a per-frame check. Extensions keep their existing configuration authentication and allocation checks. The guard accepts structured/JSON configuration clones, but must be called in the process that built the factory configuration. It intentionally binds the complete world, including session metadata, rather than only mobile bindings. Factory authentication alone does not validate the world supplied later to installation. The original slice exported/tested the guard and delegated transport wiring; that historical handoff is now superseded by host installation.

## Installation And Allocation

The shared initial-field writer reproduces `0x41af14` / `0x412014` / `0x42630c`: source heading, stand banks, inactive auxiliary animation modes, initial idle words `[65535, 0, 0]`, origin cells, and sentinels. Installation preserves actual position, HP, type, team, script flag, and host generation/key. It refuses stale expected bytes and non-initial task state. It does not reinterpret an already-running actor as fresh.

Coherent non-default actual HP and nonnegative generation remain supported at the original source identity/slot. Source maximum health and SCN tail metadata must still match; actual HP is not silently replaced with the SCN default. The accepted actual values are bound into the world attestation. Extra synthetic source actors are not admitted.

Supported mobile types remain `0, 8, 69, 73, 2, 3`, in the existing native mobile slot range `152..799`. Original source actors are no longer restricted to an added HUMAN02 actor at slot 170. Other source actors and city footprints remain real obstacles without receiving mobile task ownership.

Only the new source-attested configuration enables native task metadata during ordinary host production allocation, direct `reinforce2`, and FIFO consumption. These paths call the same constructor writer, preserve allocator identity/generation, and update the native low-ten-bit occupancy while preserving other cell bits. Existing reservation synchronization remains supported. Incoming state and published state are alignment-checked; a late unsupported creation or a blocked movement leg does not mutate the input world, consume its reservation/FIFO, or advance its frame.

Legacy `nativeactor-v1:` configurations retain all 24 fixture pins and their allocation restrictions. Unproved external actor updates, flying creation, carrier `reinforce`, and abduction remain rejected with native ownership enabled.

## Evidence

[source-native-task-options-native.py](../tools/qa/source-native-task-options-native.py) executes the original complete HUMAN01 and ALIEN01 `0x41b920` SCN scanner and `0x442b7c` PTH loader. It captures all registered source actors and original collision planes, then allocates six source unit types for two teams at multiple coordinates. Half of the constructor cases supply HP 197 at the `0x41af14` caller-argument boundary; no actor buffer or native instruction is patched. Ordinary allocations retain the original default-HP call. Constructor argument overrides are listed separately in each capture.

Important oracle distinction: the second stack argument to `0x41b750` is an optional slot, not HP. Reinitializing an existing actor is also not a fresh constructor test: the initial idle payload observes its previous HP before the constructor assigns the new HP.

[source-native-task-options.test.ts](../tools/qa/source-native-task-options.test.ts) verifies original source actor raw220 records, native source columns, all 32 FIN directions, complete PTH/ground/air/extra planes, actual team controls/masks, 24 dynamic constructors across the two missions, and installation/allocation on all four source bundles. It also covers immutable authentication, coherent non-default HP/generation, tampered source/world rejection, direct horizontal movement, diagonal rejection, production obstacles, and rollback.

Verified on 2026-09-19: eight focused source tests, four existing host regressions (direct authentication, legacy allocation rejection, exact elapsed-frame count, reservation/spatial consistency), and strict touched-slice TypeScript checking. The source test regenerates native evidence by default; `DC_SOURCE_NATIVE_OPTIONS_TRACE` can select a previously captured JSONL file. No browser, agents, or full suite were used.

P1 follow-up: 11 owned tests pass with regenerated native evidence. Added coverage includes the coherent HUMAN01 155/156 swap, all four bundles' exact row-slot maps, RENAT/counter/identity/occupancy rejection, clone-safe validation, all protected byte offsets plus an unowned tail byte on mobile/obstacle/city/unused records, registry/generation/slot-table changes, and independent attestations for coherent non-default HP worlds. The initial swap regression failed before the allocation fix.

Latest round11 gate: `/tmp/dc-round11-verified-20260920.log` records 2,510 tests,
2,506 passed, zero failed, four skipped; typecheck/build passed (573.75 kB JS,
180.54 kB gzip, over-500-kB warning). This supersedes earlier full-gate results,
not the bounded scope of the historical focused checks above. See
[round11 acceptance](acceptance-round11-20260920.md).

## Remaining Boundary

This removes the fixture-only **configuration/constructor** blocker, not the
original campaign/mission scheduler gate. The separate
[bounded combat host/session](source-native-combat-host.md) now composes
authenticated type-0/weapon-1 profiles through `withSourceNativeCombatTasks`,
including seven reaction banks, positive nonlethal damage and full caller
replay of dynamic bindings. Initial SCN/world attestation is preserved. Source
assets and typed world buffers are privately copied before asynchronous work.
Movement retains its horizontal same-family clear 1..3-cell envelope. General
paths, other combat providers, production/CITY/resources/full-policy shared
scheduling and original mission2 remain gated. The all-phases goal is not met.