# Native ActiveAI Group 3

2026-09-19. [Isolated consumer](../src/engine/legacy-ai-group-three.ts),
[native probe](../tools/research/ai-group-three-20260919.py),
[differential tests](../tools/qa/legacy-ai-group-three.test.ts).

## Boundary

`consumeLegacyAiGroupThree(state, inputs)` completes one group-3 invocation:
`459f24 -> 44bbdc -> 44b920 -> 459f80`. It imports the existing prelude but
is deliberately **not re-exported** from the shared AI module. No pipeline,
campaign, session, view, main, or other group's implementation was changed.

State supplies all 0x6c40 policy bytes, all 800 x 220 entity bytes, native
navigation, force-order byte and RNG cursor. Inputs supply team 0..7, all
256 x 32 native neighbor bytes and the 256 signed RNG dwords. Navigation
dimensions must be 1..256 by 6..256 with complete family/next-family buffers.
The latter table is part of the existing navigation contract; this decision
does not route through it. The original RNG table is an input, not a fixture
lookup keyed by frame or mission.

The consumer stages every write and commits policy, entities and RNG together.
Force-order remains unchanged. It returns exact ordered packets/events,
`rngDraws`, `membersVisited`, prelude result, `completeInvocation: true`,
`groupsCompleted: 1`, `nextGroup: null`, and `admitted: false`. Null means the
last group finished, **not** that the entire policy/scheduler call has run.
The orchestrator still owns the complete policy loop and inter-owner commits.

## Original Behavior

| Native body | Implemented behavior |
| --- | --- |
| `0x459ec0 / 0x459f24` | Count members before cleanup. Empty adds 1000 with dword wrap; nonempty adds zero. |
| `0x44bbdc / 0x44ba48` | Visit bucket 0 even if its enabled byte is zero; unlink state-10 members, preserving source list order. |
| `0x44b920` | Actual five-byte no-op function, not omitted maintenance. |
| `0x459f80` | Complete actor task/mode gate, objective scan, random destination, resource reservoir, threat displacement and emission. |
| `0x411db4` | Increment cursor modulo 256, then read the original signed dword; every draw is represented in event order. |
| `0x40c414 / 0x421648` | Construct a 17-byte single-unit packet through the pre-submission boundary. Types 5 and 13 use mode 2; all other types use mode 7. |
| `0x45a724` | Original assignment bucket selector returns zero. It is checked as policy metadata, not called again by the group decision. |

Actor modes 0/4 decide only at task byte `+0x39 == 1`. Mode 5 at task 1
transitions to 6 without deciding again in that visit. Mode 6 draws once for
the 1/64 gate, then honors feedback `+0xc9`; all visits clear that feedback
byte. Other modes enter the original diagnostic path and are rejected atomically.

The objective branch scans regions 1..255 ascending. It marks the candidate
and its neighbors, then checks their neighbors for hostile signed owners at
region `+4`. It scores hostile `+8/+10`, subtracts hostile `+12/+14`, and
adds one for nonzero `+16`; strict-greater selection preserves ascending ties.
A selected objective sets actor mode 5. Native comparisons preceding the
mode-6 assertion do not branch; the original PTH read uses diagonal `(y,y)`.

Random destinations use signed remainder by width and height-minus-five,
retrying family-zero cells. The resource branch scans **all 800 slots**, not
the registration high-water or a cached unit count: type 40, state neither
0 nor 10. Its reservoir draws once per eligible resource and accepts when
`trunc(256/count) > (random & 255)`. Counts above 256 are not capped.
No-resource fallback preserves actor mode; successful resource selection sets
mode 4. Resource coordinates may have family zero and are then emitted directly.

Resource danger sums **signed owner bytes**, not strength, over the resource
region and every neighbor entry. Own-team and -1 are excluded; hostile team
zero contributes zero. Native self-neighbors and repeated entries are retained,
so signed cancellation must account for their multiplicity. Nonzero danger
draws independent offsets -8..7 and clamps each coordinate to the map. A later
family-zero displacement emits the initially selected resource coordinates;
only a zero-danger region replaces that saved destination.

## Evidence

**169/169 focused tests passed:** 163 original-instruction invocations and six
coverage/rollback/ownership tests. Every invocation compares complete policy
and entity buffers, force-order, RNG cursor, exact packet bytes and interleaved
callback/RNG/packet events. Source and historical cases additionally retain
all four full stage snapshots; tests compare the prelude stage and unchanged
maintenance stage. The oracle embeds the original callback/helper bodies and
all source type records, not only hashes.

Coverage includes modes 0/4/5/6, busy/idle tasks, feedback and RNG gates,
objective ties/threat/exclusion/own/signed owners, random retries, resource
counts 0/1/2/257, inactive/dead resources, signed cancellation, family-zero
destinations, all four coordinate clamps, both opcodes, cursor wrap, force=255,
disabled bucket, accumulator overflow, mixed/all cleanup and 0/1/4/9/49/128/648
linked members. All 27 recorded normal branch landmarks are covered across
the two original maps. ALIEN's traversable cells start at y=11, so its lower-y
clamp is not fabricated; the original HUMAN map proves that branch.

Original `0x457568` assignment controls also create real nonempty memberships:
types 0/8 go to group 3 in the tested zero-census fallback, types 5/13 go to
group 3 directly, 6/14 go to group 0, 1/9 to group 1, and 4/49/50 distribute
across groups 1/2. The existing category mapping is modulo 8 for types below
16, category 7 for 49/50, category 1 for 41/42, and category 8 otherwise.
Types 41/42 alone are excluded by the original assignment census. The group-3
consumer does not reassign or reject a linked member based on that upstream
category policy. Direct controls also visit every type 0..15 and 40/41/42/49/50/109.

The assignment probe asserts non-vacuous membership counts. Its earlier
development capture passed team/policy in reversed registers and produced
empty lists; that capture is **not** assignment evidence. Likewise, the final
signed-cancellation fixture accounts for the source graph's self-neighbor.

### Natural Calls

| Cached original call | Complete group-3 parity |
| --- | --- |
| HUMAN02, team 2, frame 14124 | Ten type-8 members at task 9; no packets; RNG 110 -> 110; every policy/entity byte matches the historical group return. |
| ALIEN02, team 1, frame 1160 | Empty group; accumulator update; no packets; RNG 124 -> 124; every policy/entity byte matches the historical group return. |

The separate unmodified source invocation has ten idle HUMAN members and
emits ten native orders with RNG 2 -> 70. Natural idle/no-order parity is not
used as a substitute for nonempty decision coverage. Historical executable,
PTH neighbor table and complete before/after bodies are checked against the
latest four-group captures, without repeating either long world simulation.
Historical force=0 is inherited from the preceding enabled group consuming
the one-shot byte; these older world traces did not record that byte directly.

Executable SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The imported source fixture also verifies the original SCN/MAP/PTH hashes.
Historical HUMAN SHA-256:
`53245c583dcd87bee5553e6d2e73cb7a1d924706ea28167bc7fdd9f6a8db1466`.
Historical ALIEN SHA-256:
`53c46951c0ffc967d3152d1ce6b167c0317086e23ba3b5fe784df451505f3d59`.

## Ownership And Limits

No ordinary group-3 decision branch is left as an unproved placeholder.
Invalid lists/callbacks, state-0 members, unsupported diagnostic actor modes,
out-of-map native accesses and overlapping buffers fail before commit. For
pathological input, repeated deterministic search states are rejected instead
of hanging like the original. This is not a fixed retry cap on valid searches.

The packet boundary is exactly `0x421725`, before local `0x41defc` receipt or
network sequence tagging/queue submission. Returned packets include native
length, move payload, per-unit mode and stream terminator. They do not pretend
to update transport sequence, receive buffers, queued tasks or production.
Natural group-3 calls here emit no packets and need no receipt writes to match
historical entities. Receiver/transport and subsequent movement/resource
lifecycle remain external owners, as does integrating groups 0..3 with demand
in one full policy call. No mission-wide admission is claimed.

## Reproduction

Generate the isolated oracle, reusing the cached world captures:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
python3 -B tools/research/ai-group-three-20260919.py \
  --natural-trace /tmp/dc-ai-gap-natural-human-20260919-25.jsonl \
  --natural-trace /tmp/dc-ai-gap-natural-alien-20260919-24.jsonl \
  > /tmp/dc-group3-native-20260919-a6.jsonl
DC_AI_GROUP_THREE_TRACE=/tmp/dc-group3-native-20260919-a6.jsonl \
node --import tsx --test tools/qa/legacy-ai-group-three.test.ts
```

Without `DC_AI_GROUP_THREE_TRACE`, tests regenerate isolated controls.
`DC_AI_GROUP_THREE_NATURAL_TRACES` accepts a JSON array of cached natural paths;
missing historical files are not synthesized. `--disassemble` exposes the RNG,
assignment selector and packet-helper instructions.

Final evidence: `/tmp/dc-group3-native-20260919-a6.jsonl`, focused results
`/tmp/dc-group3-test-20260919-a6.log`, strict ES2022 result
`/tmp/dc-group3-types-20260919-a6.log`. No `.ts` import suffixes, full suite,
agents or browser were used. Only the new module, its tests/probe and this
document were added.