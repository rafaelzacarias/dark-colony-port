# Whole Native AI Policy Computation

## Gate

`computeLegacyAiFullPolicy` in [legacy-ai-policy](../src/engine/legacy-ai-policy.ts)
completes the source-separated `0x44be40` computation. `readyWholeCall: true`
means that initialization, preparation, demand and all four groups completed,
not that a mission may enable mode 3. `admitted: false`, `runtimeReady: false`
and `receipts: "pending-owner"` remain explicit. No preflight, session,
campaign-AI, production, view or main code was changed.

Import executable APIs directly from that module. Only types are re-exported
by [legacy-ai](../src/engine/legacy-ai.ts): a runtime barrel export would form
an ESM cycle with group-three's module-level layout constant.

## Computation Contract

The input includes complete policy/entity/team bytes, native navigation,
occupancy and ground cells, counted region adjacency, type/weapon/MBULLET and
dependency tables, population/cap, the shared 256-entry RNG and cursor, and
the one-shot force-order byte. Initialization is explicit: `needed: true`
requires both the original rule table and the owner's `policyAddress`.
The allocation pointer at team `+0x28` is compared as a real field, not removed
from expected native output. Policy byte zero is an assignment marker, not
an allocation-exists flag.

One private mutable candidate runs initialization when needed, conditional
assignment and observation, demand (including its second assignment), then
groups **0, 1, 2, 3** in original order. Every group sees previous mutations,
including group-zero actor `+0x11` objectives, current policy quotas, shared
RNG cursor and force-order consumption. There is no skipped blocked branch.
The caller's buffers and scalar state remain unchanged, including on late
failure. The returned candidate/team bytes are available for transaction staging.

Group-one now implements original random retarget `0x463840`, release
`0x464074`, and create `0x463eec`. RNG increments before table lookup. The
rank-below-two random scan increments its divisor only on replacement.
Release clears member `+0xcc` and sets `+0xd2=-2`, preserving `+0xd4` and
disabled bucket head/tail; creation preserves unrelated quota storage.
Marks are visited in ascending region order and take the first free bucket
1..15. No space leaves the remaining mark unassigned, as in the executable.

All aggregate group outputs and the combined queue contain typed packet
records with stable sequence, stage, raw bytes and `receipt: "pending-owner"`.
Production records retain exact demand debit, source dependency and mode-9/10
intent. Actor records carry decoded mode-5 orders and mode-7 point/slot lists.
Empty native packets are retained; they are not invented successful receipts.

## Transport Boundary

`actorTransport` must be `deferred` or `synchronous`. Native local transport
at `0x421725` calls `0x41defc` before returning. The explicit
`decodeLegacyAiActorPacket` / `applyLegacyAiActorPacket` APIs reproduce
handlers `0x41ce54` (pending/order `+0x36/+0x37`) and `0x41d3c8`
(point storage `+0xa6/+0xa8`, count `+0xc6`). They do not write actor `+0x11`.
That objective byte is controlled by group decision/emission code, including
group-two's route emission; packet receipt must not be blamed for its changes.

Synchronous computation projects these writes onto the private candidate at
each group boundary. This is equivalent for these AI groups because their
remaining field loops do not read the pending/destination fields written by
these two handlers. The original oracle receives each actor packet immediately;
the aggregate comparison includes both timing profiles and repeated orders.
No arbitrary receipt callback is accepted. Decoder framing and all commands
are validated before any write, so malformed trailing commands roll back.
Production modes are rejected by the actor decoder, not silently ignored.

The production owner must apply real paid mode-9/10 receipts, without another
debit, and own queues, construction/spawn and subsequent lifecycle. The
session/world owner must atomically commit the candidate, team, ordered
receipts, actor identity/generation, shared RNG/force and journal/checkpoint;
the transport/task owner must consume actor pending orders in actual world
visits. In synchronous mode, candidate actor receipt fields are already
projected: adopt that projection once, do not replay them as later orders.
There is no claim that those runtime transactions or subsequent task steps ran.

## Native Evidence

[Group-one probe](../tools/research/ai-group-one-20260919.py) and
[tests](../tools/qa/legacy-ai-group-one.test.ts) compare 22 original invocations:
source, random retarget, full-member release, cleanup, create, ascending marks,
duplicate targets, all 16 buckets, mixed branches, RNG wrap and forced orders.
All policy/entity bytes, force, RNG calls, callback order and packets match.

[Whole-call probe](../tools/research/ai-full-policy-20260919.py) enters original
`0x44be40` through return, not a replay of individually captured groups.
It imports the original **pre-action** `source-pipeline` policy/entity/team
snapshot from the demand oracle, plus its complete source tables and explicit
population/cap. It never substitutes old post-demand natural captures.
Provenance is `source-preaction-reconstructed-bounds`, not historical natural
world parity. Both source missions run source, allocation-needed, mixed and
paid-demand cases with both transport profiles: 16 whole calls. Mixed cases
must execute all three missing helpers and emit from every group; paid cases
must emit actual production packets. Eighteen additional original `0x41defc`
receipts cover 0..8 points, slots 0/799, duplicate slots and Stop.

The oracle explicitly stops mode-9/10 packets at emission as pending owner
receipts; actor packets execute native local receipt in synchronous cases.
Thus every compared policy/entity/team byte is native, with no expected-byte
normalization, but this is **not** an uninterrupted production/lifecycle world
oracle. Historical frames HUMAN 14124 / ALIEN 1160 lack pre-demand inputs and
are not relabeled as whole-call evidence. This remaining runtime boundary is
independent of completed group-one computation.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/research/ai-full-policy-20260919.py --demand-trace /tmp/dc-ai-demand-native-0919-f2.jsonl
node --import tsx --test tools/qa/legacy-ai-policy.test.ts tools/qa/legacy-ai-group-one.test.ts tools/qa/legacy-ai-active.test.ts
```

The tests accept `DC_AI_FULL_POLICY_TRACE` and `DC_AI_GROUP_ONE_TRACE` JSONL
paths. Without those variables they regenerate native evidence; the full-call
probe requires the pre-action demand capture (regenerate it with
[the demand probe](../tools/research/ai-demand-20260919.py)). No browser or full
suite is needed. All new imports and the strict focused typecheck target ES2022.