# Native Resource Lifecycle And Bounded Host

Executed 2026-09-19. This closes the missing **VENT FIN death-variant input** and
implements a bounded resource lifecycle in the existing transport host. It is
not complete Phase 3 or HUMAN02/ALIEN02 acceptance.

- Probe: [resource-lifecycle-20260919.py](../tools/research/resource-lifecycle-20260919.py).
- Native/host comparisons: [resource-lifecycle.test.ts](../tools/qa/resource-lifecycle.test.ts).
- Runtime: [transport-host.ts](../src/engine/transport-host.ts) and
  [legacy-resource.ts](../src/engine/legacy-resource.ts).
- Integration API and exact ownership boundary:
  [resource-host-integration.md](resource-host-integration.md#resource-lifecycle-api).

## Evidence Boundary

The probe uses the existing construction source fixture/FIN marshaller. It loads
original GAMESTAT records, source FIN timeline records and native conversion
`0x425b21..0x425b6f`; it executes native bank binders and additionally the
deployment binding block `0x43c099..0x43c18c`. Formatting and name lookup are
asset-loading adapters only. **No animation, task, settlement, cancellation,
collision or removal call is intercepted during lifecycle execution.** Every
case asserts an empty `runtimeInterceptions` list.

Real constructors initialize neutral source slot 152 and one human/alien mobile
extractor slot 153 on the same tile. Actual registered-slot dispatch
`0x419bb8..0x419c0e` advances animation and dispatches tasks in source slot order.
The original phase increment block `0x41989e..0x4198c3` runs before each visit;
selector 5 is cleared before the update as established by the resource audit.
Audio remains inactive through native readiness gates, but sound-call arguments
are observed without replacing the sound function. Map/side/mode buffers are
explicit isolated fixture inputs, not a full loaded mission. All source files
remain unchanged, and the JSON includes fingerprints of GAMESTAT, ANIM.DAT,
both original mission02 SCN/TRO pairs, executable and loaded FIN assets.

Pinned executable SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

| Core FIN | SHA-256 |
| --- | --- |
| VENT.FIN | `9f43206aba24f71a4a0cb7df841e09ebde2a243dc20310cd34644fed2c3ea84a` |
| EXPL.FIN | `6cd02d2153bf692155aaf31d73015eb7de89902ecccdc9a079af5a8a6ed2812c` |
| SLUG.FIN | `f1b813f0607aab425b57011f19f16110d8c5b33179691d08dd4b9558afb87d6b` |

## VENT Removal Resolved

Original VENT binding produces type +0xe8 = **1**. No invented death animation
is necessary: native fallback `0x43c07d..0x43c099` binds +0xac to the real
VENTSTAND bank. Task 10's random modulo therefore has divisor one, not zero.
Type +0x100 is zero, so the removal counter increments on each task visit.

Task 10 initializes `[0,0]`, selects its actual FIN animation on the first visit,
and reaches `[150,0]` on the 150th visit. Only then does it set status zero and
registered-slot 65535. Animation completion does **not** determine unregister
time. This supersedes the zero-divisor boundary in the earlier
[resource runtime report](resource-runtime-20260919.md#exact-remaining-native-inputs)
without changing that historical fragment probe.

## Executed Goldens

Normal fixtures: reserve 100, rate 22, extractor HP 800, credits 1000, owner gate
1, AI field 0, initial phase counter 0. Each visit below includes native animation
before task dispatch.

| Milestone | Human | Alien |
| --- | --- | --- |
| Deploy 6 ->47 / 14 ->48, push task 12 `[152,1,0]` | 1 | 1 |
| Deployment animation complete; task word 1 becomes zero | 39 | 27 |
| Payout visits | 16,32,48,64 | 16,32,48,64 |
| Deplete, source status 10, clear MAP resource flag | 65 | 65 |
| Extractor mobile/idle handoff, HP 530 | 68 | 72 |
| Source status 0 / unregister | 215 | 215 |

Both finish at reserve 12, credits 1088, income 88. Selector 5 is one on payout
updates and zero on subsequent non-payout updates, not cumulative income.
The immediate initial activation uses signed countdown 65535 ->65534. Since
activation returns nonzero, native idle redispatch sees the now-deployed occupant
and sets the source countdown to 50 **in the same visit**.

Additional complete native cases:

- Queue order 13 through native order dispatcher at visit 20: task 12 cancels,
  task 13 is the sole stack entry, pending flag clears and order becomes 255.
  Mobile handoff is visit 23 human /27 alien. HP remains 800, reserve 78, credits
  1022, source flag remains set. This differs from depletion retraction's
  idle-plus-task-13 stack and 270 HP cost.
- HP 270 at depletion: both source and extractor enter task 10 and unregister at
  visit 215. Extractor HP stays 270; its ground ID becomes 1023 immediately.
  Resource removal is not a combat-loss event.
- Credits and income start at signed32 max, phase starts at 0xffffffff: original
  increment wraps counter to zero and task 12 pays on that very first update.
  Money/income wrap signed32, **not saturate**; after four payouts their bits are
  2147483735 (signed -2147483561). Final source unregister is visit 200.
- Alien AI multiplier 512, reserve 23, gate zero, initial phase 0xffffffff:
  first payout consumes 44 to reserve -21 while credits/income remain unchanged;
  depletion is visit 2 and unregister visit 152. The depletion precheck uses the
  unscaled signed rate, and it runs before the phase mask.
- Nonlocal owner with gate zero and HP270: deployment sound is absent but native
  collision cleanup still requests event 3/ecx=1. Reserve still depletes.

## Animation And Sound

FIN runtime delay bytes are direction dependent. The native fixtures initialize
human direction 160 and alien 128; fixing both to zero gives a wrong human
deployed stand delay. The report exports all 32 bank direction timelines and
the actual direction byte on every snapshot. The older construction snapshot's
human-readable bank state label identifies a representative direction only;
use `animations[].directions` plus the snapshot direction for exact timing.

Resetting the same bank and mode preserves frame/delay. Changing bank or mode
starts frame/delay zero. The first update advances past frame zero before loading
its next delay; one-shot completion is `sum(delays[1:])+1`, not `sum(delays)`.
The host models frame/delay byte arithmetic and loop/once/hold modes explicitly.

Observed source unit-sound call `0x431da8` (EAX=game throughout):

| Event | EDX | EBX | ECX | Stack +4,+8 | Gate |
| --- | --- | --- | --- | --- | --- |
| Deploy | 6 or 14 | 5 | 1 | xQ8,yQ8 | owner == localTeam |
| Queued cancellation | 47 or 48 | 5 | 1 | xQ8,yQ8 | owner == localTeam |
| Depletion retraction | 47 or 48 | 5 | 0 | xQ8,yQ8 | owner == localTeam |
| Low-HP collision cleanup | 47 or 48 | 3 | 1 | xQ8,yQ8 | no owner-local test |

This does not replace `newrate`'s separate old-word-zero/nonzero-literal
`category:1,event:7,ebx:0,ecx:0,stackArgument:0,spatial:false` request. That event
must still be emitted when rate scaling yields zero. Existing host tests cover
exactly-once command identity and that zero-scaled-rate case.

## Host Scope And Verification

The existing host step now actually consumes source idle, extraction, retraction
and resource removal; the arithmetic and animation helpers are not unused
exports. Native byte task metadata/payloads and serializable bank identities
survive checkpoint round-trips. Commit returned funds/statistics and consume
requests only after successful transactional publication.

The host deliberately rejects unowned general mobile idle/wait scheduling,
arbitrary pending-order reset, unsupported animation/removal profiles and combat
interruption. Released mobile tasks require the orchestrator's task owner.
Low-HP cleanup requires the proved single ground cell. Native partner arithmetic
reuses the earlier executed partner goldens; new host tests verify same-owner
write ordering, lost odd remainder, valid invalidation and unknown-type failure.
These partner tests are not a newly proved partner deployment lifecycle.

Reproduce with unique logs from the absolute repository directory:

```sh
cd /Users/rafael/Downloads/darkcolony
export PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918
trace=/tmp/dc-resource-lifecycle-$(date +%Y%m%d-%H%M%S).json
python3 tools/research/resource-lifecycle-20260919.py > "$trace"
DC_RESOURCE_LIFECYCLE_TRACE="$trace" node --import tsx --test --test-concurrency=1 \
  tools/qa/resource-lifecycle.test.ts tools/qa/legacy-resource.test.ts \
  tools/qa/resource-host-integration.test.ts tools/qa/transport-host.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --noUnusedLocals \
  --noUnusedParameters --skipLibCheck --target ES2022 --module ESNext \
  --moduleResolution bundler --allowImportingTsExtensions --types node \
  src/engine/transport-host.ts src/engine/legacy-resource.ts \
  tools/qa/resource-lifecycle.test.ts
```

The lifecycle test runs the native probe itself when the trace environment
variable is absent. Nine complete native cases and all **40 focused tests**
passed, including 14 new lifecycle/provenance tests. Strict touched-slice
typechecking and editor diagnostics passed. Both resource documents' 13 local
links were validated. No browser, agents, full suite, manual raw source changes
or orchestrator-file edits were used.