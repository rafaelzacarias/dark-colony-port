# Bounded Original AI Production Transaction

Implemented in [campaign-ai.ts](../src/engine/campaign-ai.ts), with one narrow
`receive-prepaid-unit` action in [campaign-production.ts](../src/engine/campaign-production.ts).
The opt-in receipt owner now integrates with [campaign-session.ts](../src/engine/campaign-session.ts).
No view, main, simulation, rendering or legacy-AI implementation was edited for this integration.
This is an executed finite engine transaction, **not complete campaign AI**.

The new optional `fullPolicy` profile and `stage: "full-policy"` are documented in
[Campaign Full-Policy Receipt Boundary](campaign-ai-full-policy-20260919.md).
That path owns shared-world validation, all four groups, native actor receipts
and complete caller replay. The demand/pipeline behavior described below remains
source-separated; statements about unconnected groups or separate actor pools
apply only to those older stages. Original-mission AI remains blocked on task
consumption even with the full profile.

## API And Commit Boundary

`transactCampaignAiProduction(previous, {id, sequence, stage})` accepts the
current AI buffers/inputs, production owner, transport world and receipt history.
`stage` is `demand` or `pipeline`; it calls the existing original-rule reducer,
not a replacement rule table or caller-supplied callback. The required scope is
`source-separated-bounded`: policy actor/navigation evidence is separate from
the bounded session world, and must not be advertised as a live shared world.

Preflight checks current selected-team credits against both production and
`world.exomoney`, accounting, race/base, City projection/health, restrictions,
all four native queue lengths, FIFO order/source metadata, ready/delay bytes,
active ticket/transport exit ownership, complete active DEPEND catalog coverage,
prerequisite order/terminators, GAMESTAT selectors and the base exit `(0,-3)`.
Unused words following a native prerequisite terminator are not prerequisites.

Policy, assignment links and native credit debits run on a detached candidate.
Each exact pending-owner intent must match its packet, source cost and ordered
credit-before/after chain. The bridge synchronizes the already-debited balance
into production, then receives the prepaid unit. It never calls `reserve` or
dispatches existing UI reservations. The receipt requires its own preceding
`sync-credits` event with the exact cost delta; accounting increases once.
The native team queue/accounting projection and world money publish together.
Failures discard the entire candidate, including policy changes and debit.

IDs are `campaign-ai:${JSON.stringify([sessionId, commandId, sequence, intentIndex])}`;
the debit appends `:credits`, and the queue ticket appends `:0`. Receipt history
requires contiguous sequence numbers and unique command IDs. Exact retries return
`duplicate` without replay, even after allocation; changed stage/sequence/team
under the same ID rejects. The production event journal separately deduplicates
receipt events. Retain both histories with their owning state.

Only source-profile-validated type 0/TRSC and type 8/GRAY can receive mode 10.
Mode 9 returns `unsupported-city` with city/level and the actual blocked intent.
Other mode-10 types return `unsupported-unit`, not a substituted no-op.
A genuinely unaffordable original action may successfully produce no intents.
Demand/pipeline successes return `readyWholeCall: false`, remaining groups 0/1/2/3.
Full-policy successes return `readyWholeCall: true` with no remaining computation
groups, but targeted receipts remain pending native task hand-off.

## Executed Native Protocol

[campaign-ai-native.py](../tools/qa/campaign-ai-native.py) executes the original
SHA-256 `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`,
using the existing full source DEPEND/GAMESTAT initializer, not zero tables.

| Boundary | Executed semantics |
| --- | --- |
| `0x40c13c` / `0x40c168` | City / unit encoders, respectively. |
| Mode 9 | `[7,0,9,city,level,team,0]` selects `0x41c8d4`. The final zero is a stream terminator, not a reservation flag. |
| Mode 10 | `[7,0,10,type,team,count,0]` selects `0x41c7f8`; original AI actions send count 1. |
| `0x421648` | Writes total frame length; external transport packs a four-bit sequence in header byte 1. Executed 0,1,15 -> 1,2,0 wrap. Its local branch executes the real decoder directly, with no second debit. |
| `0x41df68` | Source pointer `game+0x958`, byte count `+0x95c`: consumes normalized **payload-length** words, not transport total-length/sequence headers. Two source records execute in order, then clear the byte count. |
| `0x41defc` | Dispatch table at `0x479380`; consumes callback-advanced cursors. Mode 0 must be the last byte; missing/early terminators, truncated streams, empty streams and mode 28 reject. |
| `0x41c7f8` | Reads three unsigned payload bytes, selects source GAMESTAT queue `type+0xec`, appends after the existing unsigned-word queue length, adds native `0x438090(type) * count` to accounting, leaves credits/ready/delay unchanged. |

The probe covers all four source queues, counts 0/1/2/3/255, preserved FIFO
prefixes and the final valid storage position (799 -> 800). Native queue
storage is 800 bytes; the raw receiver does not enforce the adapter's bound.
The bridge retains the production owner's maximum-50 safety limit, including
UI pending reservations. Native accounting is dword arithmetic; this bounded
owner rejects accumulator overflow outside its existing nonnegative signed32
range rather than claiming arbitrary wrapping accumulator imports.

Native decoding can mutate before rejecting a later malformed byte: missing
terminator evidence contains an already-appended troop. Bridge validation and
rollback are deliberate adapter safety, not native rollback reconstruction.
City callback arithmetic is executed (slot 3 HP 2400, level 0, accounting +2000,
credits unchanged), but `0x444f14` initializer and `0x437bc4` refresh are intercepted
in that case. This is **not** proof of city lifecycle ownership.

## Finite Integration Evidence

[campaign-ai.test.ts](../tools/qa/campaign-ai.test.ts) invokes the exported bridge
in four finite scripts: both races, demand alone and preparation/observation/
demand pipeline. Each compares full policy, all 800 actor records, selected-team
bytes and the exact packet with executed original code before receipt.

Fixtures reuse the existing production-session pattern: synthetic open terrain,
base `(50,50)`, empty triggers, actual source catalogs and FIN banks. They use
valid City fields, empty queues, credits 1000, initial accounting 17 and two
explicitly linked harvester census actors in the separate policy evidence world.
They do not reuse the old level-10/census-queue stress fixtures as real producers.
The selected team/race is explicit, not inferred from HUMAN02/ALIEN02 filenames.

Each packet produces credits 650/accounting 367, one applied receipt and one
FIFO ticket. Existing `stepCampaignProductionProducer` advances actual parsed
FIN delays, owns exit sentinel 1022, then allocates exactly slot 152/generation 0
at `(50,47)` and consumes the reservation. The real transport `create` receipt
and production `unit-allocated` identity agree. No manual spawn or fabricated
completion callback is used. Other tests cover active-head receipt without
clock reset, ordered second receipt, retry after completion, missing payment,
stale ownership, malformed packets, pending UI capacity, overflow and rollback.

## Remaining Handoff

### Session API

`CampaignSessionOptions.campaignAi: CampaignAiConfiguration` explicitly enables
one selected team's bounded receipt owner. It requires `production`, scope
`source-separated-bounded`, a nonempty stable `sourceId`, the original executable
SHA-256, exact source tables/navigation, and initial policy/team/observation
buffers. Configuration and snapshots use JSON number arrays, not typed-array
objects. The normal scenario path does not supply this option and remains gated.

`CampaignSessionInput.campaignAiRequest` carries `{id, sequence, stage, sourceId,
observation}`. Observation supplies the separate source entity pool, force order,
population/cap, relations, visibility masks and occupancy. Policy and native
team buffers are session-owned. Callers cannot supply a debit, receipt, packet,
completion flag, replacement source table or shared-world assertion. The source
actor pool and its census are deliberately **not** compared with the session's
transport actor pool or producer census: this is not a shared-world bridge.

```ts
const session = new CampaignSession({ ...sourceOptions, campaignAi: boundedAi });
const frame = session.step({
  clockMilliseconds,
  productionVisits,
  campaignAiRequest: {
    id: "policy-command:0", sequence: 0, stage: "pipeline",
    sourceId: boundedAi.sourceId, observation,
  },
});
const restored = CampaignSession.restore(
  JSON.parse(JSON.stringify(session.checkpoint())), boundedAi,
);
```

The step stages player commands, host/resource updates and authoritative income,
then derives the native AI result, receives the already-paid FIFO item, and visits
the actual native producer. Trigger processing follows; any later failure discards
all candidate changes, including policy/entity buffers, money, FIFO, native slot
allocation and the host direction/RNG cursor. Source FIN visits continue across
subsequent steps until the existing transport owner journals the actual creation.
The caller must use that creation's slot/generation, never spawn again.

The session projects current production money, accounting, FIFO, ready and delay
fields into its native team buffer before a new command and after each committed
step. Unused FIFO storage is canonicalized to zero. Income and trigger credit
changes remain authoritative; `productionChoices(snapshot.production, team)`
therefore uses the same canonical balance as the world. Real player `reserve`
pending counts remain separate from AI prepaid FIFO tickets.

IDs/sequences are checked against persistent history, independent of the bounded
debug journal. Exact retries compare the complete original request, even after
100 ticks, creation or restore. Changed observation/stage/source under an existing
ID rejects. A new command uses the next sequence and current source observation;
the session supplies the committed policy and current producer projection.

Direct checkpoints contain `state.campaignAi`; replay-v1 does not admit it.
Restoring an AI-enabled save requires the caller's **exact expected configuration**
as the second argument, including source definitions and initial identity. Restore
recomputes each native demand/pipeline result from saved inputs and the preceding
policy, compares typed `campaign-ai` receipts and source hash, and admits journal
events only by exact receipt/debit keys. It reconciles credits, accounting, player
pending, remaining FIFO tickets and each allocation against its actual creation.
Consumed/refunded tickets cannot be reused. Changed authoritative credit-sync
events are retained for this ledger; no-op per-frame sync events are compacted.
AI evidence/receipt history is retained and grows per accepted command, not per
idle frame. This is a bounded owner, not a general compact policy-history format.

A future active-policy orchestrator must maintain the selected team's complete
source observations, census/cap and actor/navigation ownership before each new
call. Session-owned queue flags/counts and refunds/income are synchronized;
standalone bridge callers must still provide a current native team record. Producer visits remain
explicit owner operations, not a scheduler invented by this bridge. Downstream
consumers must use the allocated slot/generation, never spawn again.

Still required for this session owner: shared-world policy/entity mapping,
scheduled integration of group-decision outputs, nonshared order receipts and
later task consumption, other producer FIN profiles, construction/upgrades and
original scheduling integration. Pure group orchestration owned elsewhere is not
invoked by this session hook; this report does not assess that owner's completion.
Mode 3/full mission AI stays
blocked. See [demand rules](ai-demand-rule-20260919.md) and
[production session](campaign-production-session.md).

## Verification

22 bridge/session tests, 19 existing production-owner tests and six selected
production-session regressions pass (47 total). `npm run typecheck` passes with
the project's ES2022 target and extensionless new runtime imports. Session cases
cover both races/stages against native packets and FIN timing, actual creation,
mid-queue and post-spawn restore, 100-tick retries, two sequential receipts, player
pending/menu credits, late TRO rollback, source/receipt/debit tampering, mode-9
rejection, and authoritative resource income across restore.
No agents, browser or full suite were used.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/campaign-ai-native.py > /tmp/dc-campaign-ai-native.json
DC_CAMPAIGN_AI_TRACE=/tmp/dc-campaign-ai-native.json \
  node --import tsx --test tools/qa/campaign-ai.test.ts
node --import tsx --test tools/qa/campaign-production.test.ts
npm run typecheck
```

The native probe needs the existing demand capture documented in the demand-rule
report; `--demand-trace` overrides its default cached path. Tests accept
`DC_CAMPAIGN_AI_TRACE` and `DC_PRODUCTION_SESSION_TRACE`; absent overrides they
execute the native probes. Final captures/logs from this run:
`/tmp/dc-campaign-ai-native-20260919-19.json`,
`/tmp/dc-campaign-ai-tests-20260919-23.log`,
`/tmp/dc-campaign-ai-production-regression-20260919-22.log`,
`/tmp/dc-campaign-ai-types-20260919-24.log`.

Session integration verification logs:
`/tmp/dc-ai-session-final-focused-20260919-15.log` (41 passing),
`/tmp/dc-ai-session-final-types-20260919-16.log` (project typecheck), and
`/tmp/dc-ai-session-final-regression-20260919-17.log` (six passing).
The existing 20k-idle performance test and full suite were not run.