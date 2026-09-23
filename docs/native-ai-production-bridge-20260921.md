# Native AI Production Bridge

## Scope

Implementation: [native-ai-production-bridge.ts](../src/engine/native-ai-production-bridge.ts).
Only this new runtime file, its tests, observer, and this document are owned here.
No campaign-session, transport, source-native-policy, scheduler, asset, or package changes.

The bridge owns explicit synchronous **single paid mode10, queue0, type0/8**
boundaries. Static configuration is authenticated from the original EXE,
DEPEND.TXT, GAMESTAT.TXT, and both source-verified producer FIN metadata files.
An optional fresh `createSourceNativeTaskOptions` configuration supplies
authenticated constructor prototypes. Trace snapshots are test inputs, never
runtime configuration or source authentication.

This is not whole-mission admission or a complete registered actor consumer.
The caller owns current raw-world provenance, scheduler sequence, AI heap,
other FIN channels, actor preamble/tasks, transport framing, and atomic commit.

## API

`createNativeAiProductionConfiguration({executable, dependencies, gameStat,
humanProducer, alienProducer, constructors?})` returns a frozen, identity-bound
configuration. Supply actual file bytes, not saved hashes or profiles. A copied
configuration object is rejected. Without `constructors`, a FIN completion
rejects before consuming the FIFO or mutating the caller's world.

All operations take `currentWorld` with the complete `game: Uint8Array(0x471b0)`,
actual `groundCells`, eight **current source census values**, dimensions, and
shared `rngCursor`. They return a detached `world`; inputs remain unchanged on
success and failure. Do not recompute census at allocation: original constructor
registration leaves this cycle's census unchanged. The current population cap
comes from `game+0x528`, not a hardcoded 150 or a UI population value.

| Function | Required boundary | Concrete output |
| --- | --- | --- |
| `computeNativeAiProductionPolicy` | After selector draw, before `44be40`; current policy/entities/team, source policy inputs | Initialization, pipeline, paid receipts, `afterDemand`, groups, packets, candidate policy/force state, current raw world/RNG |
| `receiveNativeAiPaidProduction` | `ai-demand-prepaid-unit`; exact packet, dependency, credits before/after, expected FIFO length/accounting | `41c7f8` completion, FIFO append/accounting, `charged:0`, `allocatedSlot:null` |
| `advanceNativeAiProductionFin` | Owned secondary production FIN before handler; exact producer raw/counter | `4264c8` secondary animation result only |
| `visitNativeAiProduction` | `producer-handler-entry` after caller-owned animation preamble; exact raw220/counter | `414314` idle/wait/block/refund/reserve/allocation result |
| `constructNativeAiProductionActor` | `constructor-41af14`, allocator has already chosen slot and updated high-water | Complete raw220, actual ground/registry writes; no census or RNG change |

Production FIN identities are source-field IDs, not probe pointers:
`unitType*280+0x98` build, `unitType*280+0x80` troop stand,
`producerType*280+0x80` healthy producer stand. The embedding raw-world owner
must use the same field identity convention. Native tests check real descriptor
pointers before mapping these identities; they do not alter non-pointer bytes.

The policy composition copies the existing initialization/preparation/demand
and group0/1/2/3 owners. It consumes the supported production receipt **after
demand and before group0**, updates team bytes visible to all later groups,
then consumes actor packets between groups. It does not call the existing
full-policy function and apply its paid output afterward. At most one supported
buy is admitted; multi-buy demand rejects because its within-action feedback
would require an additional in-action receipt boundary. The existing scheduler
and source-native-policy rejection remain unchanged until their owner integrates
this API. Source policy tables remain the policy owner's responsibility.

## Native Timeline

The actual local bracket is `42163c(1) -> 41ac2c -> 44be40 -> 421725 ->
41defc -> 41c7f8 -> return -> 42163c(0)`.

**A buy does not reserve the exit.** Demand debits credits before emitting;
`41c7f8` appends the unit and adds its source cost to accounting. Credits,
producer raw/tasks, ready/delay, registry, census, ground, and RNG are unchanged.
Debiting again or reserving at this receipt would disagree with native.

Later `414314` decrements delay, checks the actual source exit (base X, Y-3),
clears an occupying actor's `+35` when blocked, and handles cap refund. When
starting production it reserves actual occupancy **1022**, clears ready, and
starts source FIN. The subsequent FIN completion invokes `41b750 -> 41af14`,
registers the actor, replaces occupancy, shifts the raw FIFO including its
native trailing copied byte, and sets ready. No second cost is charged.

The healthy primary stand reset is owned here at handler entry. Damaged primary
animation branches are rejected. Constructor reuse is rejected; fresh allocation
preserves the initialized slot's byte `+8`. The existing source constructor
helper supplies all remaining bytes. Native comparisons verify both type0 and8.

## Original ALIEN Evidence

[Observer](../tools/qa/native-ai-production-bridge-native.py) runs all 1200
original ALIEN02 world cycles with the full SCN, original terrain, source
initial funds, census/cap, and original AI/actor handlers. It inherits the
explicit setup-loader/platform boundaries documented in
[the scheduler report](native-shared-scheduler-20260921.md).

- Natural full policies at **1160 and1192** match complete policy, all800 raw
  actors, whole team, packet order, force state, and shared RNG.
- There are **zero paid mode10 receipts through1200**. Team1 has zero credits
  and no colony. These policies emit actor orders, not paid unit production.
- Slot **207**, type0/team1 at tile11,54, is constructed at1200 through
  **`41b634 -> 41af14`, return `41b745`**, not production's `41b750`.
  It appears during an earlier actor visit and is visited later in the same
  live registry loop. Calling this production completion or an AI-phase spawn
  is unsupported by the actual capture.
- The isolated funded control uses the actual ALIEN player producer slot1,
  type29, base13,69 and actual exit13,66. Original funds are below350; the control
  explicitly supplies1000 and stages the350 prepaid debit. Original `41defc`
  and `414314` then execute without receiver/constructor/FIN substitutions.
  All **38** start/advance/handler boundaries match, ending in real type8 slot
  **208** registration, with unchanged census and shared RNG. This is a
  funded source-producer control, **not natural AI demand or source startup**.

## Checkpoints And Guards

`checkpointNativeAiProduction(configuration, externalInitialWorld, inputs)`
replays JSON-safe paid-receipt, secondary-FIN, and producer inputs and returns
a JSON-safe source-ID/initial/history/current checkpoint. `restoreNativeAiProduction`
requires a freshly authenticated configuration and the independently supplied
same initial boundary, replays every input, and compares the entire result.
Tests restore immediately before and after allocation with fresh providers;
changed raw bytes, duplicate receipts, lost reservation, and exhausted
high-water reject. This is **production-slice replay**, not scheduler/session
checkpoint support across intervening AI, combat, income, or transport phases.

Other closed paths: mode9/CITY (even first science has no raw-world join here),
units other than0/8, other queues, free/zero/multiple-count receipts, reused
slots, high-water exhaustion, destroyed/damaged producers, lost reservations,
and noncanonical production FIN identities. Cap rejection follows native:
refund and FIFO removal on the producer visit, not refusal of a prepaid receipt.
The conservative queue envelope is at most799 existing entries for producer
visits and at most798 before an admitted append.

## Focused Verification

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/native-ai-production-bridge-native.py > /tmp/dc-production-native.json
DC_NATIVE_AI_PRODUCTION_TRACE=/tmp/dc-production-native.json \
  node --import tsx --test tools/qa/native-ai-production-bridge.test.ts \
  tools/qa/native-ai-production-bridge-native.test.ts
```

No browser, agents, full suite, new assets, or packages. Missing acceptance:
**a naturally funded ALIEN AI demand -> paid receipt -> producer -> spawn
golden**, full raw first-science construction, synchronous scheduler installation,
and shared whole-world checkpoint replay. The1200 prefix cannot establish the
first item: it contains no paid AI buy. Do not inject funds/factories/restrictions
into that prefix and label the result original gameplay.

Verified evidence for this change:

- Native capture: `/tmp/dc-production-bridge-native-20260921-b10.log`, SHA-256
  `6705505c307434f3237ce29c5228508868bb10bbea101b87ed043b3e5f7e3e76`.
- Five focused tests pass in `/tmp/dc-production-bridge-final-20260921-b16.log`.
- Strict/noUnused ES2022 + ES2023,DOM slice passes in
  `/tmp/dc-production-bridge-types-20260921-b15.log`; editor diagnostics clean.
- No Git metadata is present in this workspace; Git status/diff verification
  was unavailable. Only the five new bridge/probe/test/document files were edited.