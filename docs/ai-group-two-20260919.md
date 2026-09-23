# Native ActiveAI Group 2

2026-09-19. [Runtime](../src/engine/legacy-ai-active.ts),
[exports](../src/engine/legacy-ai.ts),
[native probe](../tools/research/ai-group-two-20260919.py),
[differential tests](../tools/qa/legacy-ai-group-two.test.ts).

## Implemented Boundary

`consumeLegacyAiGroupTwo(state, inputs)` executes one complete group-2
decision/emission invocation, not a whole mode-3 scheduler call. It runs native
callback order `4578a0 -> 44bbec -> 458b44 -> 463e78`. Returns
`completeInvocation: true`, `groupsCompleted: 1`, `enabledBuckets`, ordered
callback/packet `events`, native `packets`, `rngDraws: 0`, `nextGroup: 3` and
`admitted: false`. The latter describes mission admission, not an unimplemented
ordinary group-2 path. No RNG table, random approximation or cached frame lookup
is used. Policy, all 800 entity records and force-order commit atomically;
RNG cursor and source inputs remain unchanged on success and failure.

Inputs are complete policy/entity buffers, native navigation and force-order/RNG
state, team 0..7, 110 type records, weapon records, signed MBULLET matrix and
the native 256 records of 32 neighbor bytes (count followed by ordered neighbors).
Zero through 16 enabled buckets are supported. Invalid linked lists, aliased
buffers, invalid route cursors/regions, missing matrix data and native diagnostic
paths such as unreachable weighted routes are rejected without partial commit.

| Callback | Computed behavior |
| --- | --- |
| `0x458680` | Count only members with entity `+0xcc == 1`, map actual types to nine categories, score category type records 0..8 with native signed multiply/divide. |
| `0x45817c` | Traverse next-family or explicit route, union immediate neighbors and one further ring, sum hostile region strength once per region. Signed owner byte -1 and own team are excluded; native zero/unreachable sentinel retained. |
| `0x458814` | Scan regions ascending, apply rank/flags/nonweapon priority, power/threat quotient, strict-greater replacement and exclusion mask. |
| `0x457cc0` | Weighted route search using native reverse neighbor visitation and linked-frontier insertion/tie order; word-wrapped neighbor threat/cost/distance fields. No generic graph library substitution. |
| `0x4584ec` | Fallback destination by lowest temporary count, then directed candidate-to-current hop count, preserving ascending ties. |
| `0x463840` | Copy route through destination only, preserve remaining bytes, set cursor 0/1 and target. |
| `0x458b44` | State 2/3 target search; 2-only fallback; state-0 threat/target maintenance; state-1 nine-category quota test using enabled-bucket count. |
| `0x463e78` | Existing shared order consumer: actor state, route cursor, force byte, Stop and mode-2/7 packets in original order. |

Original quirks are preserved: exclusion/fallback initialization uses bucket
indices, subsequent chosen-target updates use region indices; the state-0
conflict test reads the bucket-indexed region record. The strength helper scores
category representatives rather than individual weapon definitions. The apparent
`0x4585c8` call inside the group decision is bypassed by the original unconditional
nine-iteration loop; it is not an omitted reachable consumer branch.

## Differential Evidence

54 full native invocations plus six coverage/rollback/ownership tests: **60/60**.
Every case compares all 0x6c40 policy bytes, all 176000 entity bytes, force byte,
RNG cursor, exact packet bytes, helper-entry/packet event ordering, group count
and enabled-bucket count. Includes both source maps, all four decision states,
real retargeting, accepted/rejected weighted routes, rank ties and blocking,
priority flags, own/signed enemy owners, quota thresholds, state-10 unlinking,
forced orders, RNG cursor 255, empty groups and all 16 buckets. Late order failure
rolls back earlier cleanup/decision writes. Disjoint views into one allocation
preserve guards and all source buffers.

The native probe executes original instructions; only packet submission is
intercepted at `0x421725`. No decision, scoring, routing or order-construction
helper is replaced. A bounded 80-million-instruction ceiling covers the full
16-bucket decision scan. Baselines enter from original `0x44be40` after its
assignment, observation, demand and preceding groups, with unmodified group-2
inputs. Controls explicitly vary those inputs and are not natural-history claims.

Original executable SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The imported fixture verifies SCN/MAP/PTH hashes for each mission. Historical
comparisons additionally verify executable and native neighbor-table hashes.

### Natural Scheduler Calls

| Source invocation | Exact extent now matched |
| --- | --- |
| HUMAN02, team 2, frame 14124, scheduler `0x41aca1`, update 14123 | Complete group-2 policy/entities at group return, two empty packets to tile (52,62), RNG 110 -> 110. |
| ALIEN02, team 1, frame 1160, scheduler `0x41aca1`, update 1159 | Complete group-2 decision/emission state and seven packets: actors 199,166,162; empty; actors 167,165; empty. All target tile (1,73), mode 7, RNG 124 -> 124. Original decoder receipt then reproduces every historical entity byte. |

The historical ALIEN group-return snapshot includes synchronous packet receipt.
The TypeScript consumer deliberately returns packets without writing receiver
fields `+0x36/+0x37`, destination `+0xa6/+0xa8` or `+0xc6`. The probe separately
executes original `0x41defc` for the exact emitted sequence and verifies full
historical entity equality. This is not a TypeScript receipt implementation.
Historical force-order=0 is justified by the preceding group's enabled bucket
consuming that one-shot byte; the older trace did not capture the byte directly.
Packets also match a contiguous subsequence of that frame/team's original
submission log, which does not label packets by group.

Historical inputs are test-only snapshots, not runtime replay tables:

- HUMAN trace SHA-256 `53245c583dcd87bee5553e6d2e73cb7a1d924706ea28167bc7fdd9f6a8db1466`.
- ALIEN trace SHA-256 `53c46951c0ffc967d3152d1ce6b167c0317086e23ba3b5fe784df451505f3d59`.
- Final local oracle: `/tmp/dc-group2-native-0919-14.jsonl`.
- Final focused results: `/tmp/dc-group2-test-0919-14.log`.

## Pipeline Coverage And Remaining Owners

Initializer, optional initial assignment, observation, demand/reassignment,
native group/queue census and all 18 rule records retain their existing consumers.
`consumeLegacyAiPolicyPipeline` still stops at **nextGroup 0**, with zero groups
executed, because it cannot skip that group's work. This change adds a separately
callable, complete **one-group** consumer at the group-2 boundary, not a shortcut
from demand to group 2.

Remaining blockers to a whole `0x44be40` call:

- Group 0: complete `0x4598b0` resource objective/orders, same-family/rank route
  scoring and assignment maintenance; existing bounded resource goldens alone
  do not close its whole invocation.
- Group 1: decision `0x4593a8` retarget/release/create branches
  (`0x463840`, `0x464074`, `0x463eec`) remain outside its bounded consumer.
  Group-2 use of the retarget helper does not automatically integrate group 1.
- Group 3: `0x459f80` objective/orders; its prelude alone is insufficient.
- Packet receipt/transport, production intent receipt/lifecycle and subsequent
  world movement/combat feedback remain external owners.

Neither complete natural mode-3 invocation is claimed as TypeScript end-to-end
parity. No campaign production/session/view/main, browser, agents or full suite
were used or modified by this increment.

## Reproduction

```sh
node --import tsx --test tools/qa/legacy-ai-group-two.test.ts
```

This regenerates 52 isolated native cases plus six contract tests. To include
the two recorded natural calls, set `DC_AI_GROUP_TWO_NATURAL_TRACES` to a JSON
array of trace paths, or pass repeated `--natural-trace PATH` to the Python probe.
`DC_AI_GROUP_TWO_TRACE` accepts already generated oracle JSONL. Missing historical
inputs are not silently manufactured; the ordinary tests remain self-generating.
The Python probe needs Capstone and Unicorn using the existing local harness
paths. Runtime/new test imports have no `.ts` suffix; strict touched-slice
typechecking passes with target/lib ES2022, module ESNext, resolution bundler.