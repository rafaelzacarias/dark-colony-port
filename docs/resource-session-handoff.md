# Bounded Resource Session Handoff

2026-09-19. Opt-in integration is implemented in
[campaign-session.ts](../src/engine/campaign-session.ts), with bounded coverage in
[resource-session-lifecycle.test.ts](../tools/qa/resource-session-lifecycle.test.ts).
This integration changes only those two files and this document. World, main,
view, transport, simulation, audio and assets are unchanged.

## Implemented Contract

`campaignResourceFrame(input)` is pure and returns `TriggerResult` containing
`{ sourceDayNight, resourceFrame }`, or an explicit `invalid-input` diagnostic.
It advances the source clock exactly once, before host dispatch. It never binds
tasks, invents FIN banks, initializes money, or treats trigger cycles as time.

| Input | Actual source / owner |
| --- | --- |
| `sourceDayNight` | Previous committed `SourceDayNight`; checkpoint this state. |
| `rawHeader` | Original SCN `rawHeader`, **fresh initialization only** if no saved clock exists. |
| `teams` | Eight ordered `{index, ai}` records; initial `%AI`, then current native AI-policy state if changed. |
| `aiMultipliers` | Eight signed32 native side `+0x19b8` values; no fallback to 256. |
| `buildingSlots` | Current full32 colony HP map, keys `"0,0"` through `"7,0"`. Not trigger expression's signed16 projection. |
| `localTeam` | Native `game+0x7d1c`, explicitly owned by session/input mode. |
| `cancellationGate` | Native `game+0x948` byte, explicitly supplied each update. |
| `orders` | Optional actual slot/generation/pending-order/order bytes, not desired UI actions. |

`resourceFrame.sides[team]` is exactly `{ aiField: teams[team].ai,
aiMultiplier: aiMultipliers[team], creditGate: buildingSlots[team + ",0"] }`.
Missing HP, missing multipliers, unordered teams, invalid clocks/bytes, and
duplicate order slots fail. Host validation additionally checks order generation
against the actual registered entity. No input or output aliases are mutated.

An existing checkpoint with only `cycleCounter` cannot resume this lifecycle.
Do not restart its source clock from the header. Reject that migration until the
checkpoint owner supplies the true clock. `advanceSourceDayNight` handles source
day/night rollover; `+0x530` is not a monotonic trigger tick.

## Source Evidence

Executable SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The new tests pin the executable, original mission SCN/TRO, GAMESTAT, ANIM.DAT,
and loaded FIN hashes through the existing lifecycle trace.

- `%AI` stores to side `+0xbbc` at `0x41be32`; see
  [scenario team fields](scenario-team-fields.md).
- Side `+0xbd4` is **slot-0 colony HP**, not TEAM enabled, a boolean, or an
  upgrade level. City row source level 1 becomes upgrade level 0. Base X zero
  suppresses HP even when the source level is positive. HP `-1` resolves through
  the native race-independent default-HP lookup; see
  [colony runtime](colony-runtime.md).
- Executed `0x40177e..0x4017ba`: startup object's
  `+0x14c4 + team*4` percentage is shifted left 8 with signed32 wrapping, divided
  by 100 with truncation toward zero, then stored to game
  `+0x19b8 + team*0xe30`. Explicit test percentages
  `[100,125,150,200,0,75,-100,8388608]` produce
  `[256,320,384,512,0,192,-256,-21474836]`. These are **injected probe inputs**,
  not a claim about mission difficulty defaults. The configured percentages
  are not in SCN; missing configuration remains unsupported.
- Executed `0x40d984..0x40d99f`: a serialized mode field becomes the cancellation
  byte by nonzero normalization (`0,1,-1 -> 0,1,1`). Another native function
  explicitly sets it to 1 at `0x43c506`. Thus a permanent default of zero is not
  justified. The tests explicitly select the zero-gate fixture.

| Original source | Initial clock `(phase,length,elapsed,transition)` | AI fields 0..7 | Slot-0 HP 0..7 |
| --- | --- | --- | --- |
| HUMAN02 | `(0,6300,5100,75)` | `0,0,4,3,3,0,0,0` | `4800,0,0,0,0,0,0,0` |
| ALIEN02 | `(1,6750,5700,75)` | `0,4,4,0,0,0,0,0` | `4800,0,0,0,0,0,0,0` |

First dispatched phase counters are 5101 and 5701, not 1. Both scenarios have
enabled nonlocal teams with zero credit gates. Zero gate still consumes reserve
using that owner's native AI multiplier, but credits neither funds nor income.
Live full32 HP 65536 is a nonzero gate; truncating it to a trigger word is wrong.

## Session Integration

`CampaignSessionOptions.resourceLifecycle?: ResourceHostOptions` enables the
path. Its `animations`, `types` and `bindings` retain the host's typed array
contract. Fresh admission additionally requires:

- `source.rawHeader`: original SCN clock header.
- `source.teams[0..7].money`: all eight original signed32 `%Money` values.
- `resourceInitialIncome`: eight explicit signed32 native income values.
- Existing explicit `resourceScales` and valid bindings for every live source.

No native universal zero-income initialization has been proved here. Explicit
zero incomes are allowed as a caller-owned fixture, matching the native probe;
omitted, incomplete or out-of-range incomes fail admission. Nonzero incomes are
preserved, including signed32 settlement wrapping. Fresh money and income are
installed before lifecycle configuration and copied into controller statistics.
Without `resourceLifecycle`, the existing unsupported extraction path remains.

Every enabled `step` requires `resourceFrameSource`, typed as
`Omit<CampaignResourceFrameInput, "sourceDayNight" | "rawHeader" | "buildingSlots">`.
Supply actual AI records, eight configured multipliers, local team, cancellation
gate and any actual slot/generation order bytes. Initial AI may come from SCN;
once changed, supply the AI owner's live records. There are no defaults for
these fields, and passing a resource frame without lifecycle opt-in fails.

After staged unit updates and synchronization, the session refreshes full32
colony HP before calling `campaignResourceFrame`. It advances the saved source
clock once, dispatches the host frame, then copies host statistics to the
controller before feedback and trigger scanning. Income and per-update selector-5
pulses therefore survive feedback. Clock, funds, task state, requests, controller,
journal and replay history publish only when the entire update succeeds.

### Checkpoints

The existing schema-1 replay checkpoint keeps normalized map dimensions, JSON
byte-plane arrays, typed `ResourceHostOptions` arrays, optional `rawHeader`,
initial income and the complete successful input history. The replay input
whitelist now includes `resourceFrameSource`. The checkpoint also saves
`sourceDayNight`; `CampaignSession.restore` requires it for enabled resources
and verifies every clock field against the replayed result. A missing or
mismatched clock fails rather than silently restarting a resumed clock from SCN.
Replaying configuration plus inputs reconstructs funds, income, native task
stacks and journal; it does not import a partial live-world snapshot. Failed
inputs never enter that history. Old non-resource replay checkpoints still work.

### Synchronization Ownership

Optional base TRSC/GRAY production now consumes actual post-resource
`world.exomoney` through a checked full32 economy synchronization operation;
pending UI reservations and committed cost accounting are retained. See
[production session](campaign-production-session.md) for its independent opt-in,
native FIN clock, exact inputs and replay checks. Existing resource options,
frame-source inputs and checkpoint clock checks remain unchanged.

`synchronizeRawAndHost` checks generation, then guards `record.resourceTask`
before any entity-to-host assignments. Type, team, HP and source rate/countdown
must agree; host-published type changes and canonical task payloads remain
authoritative. Released and retained dead records remain resource-owned.
`applyUnitBatch` rejects updates to these records before mutation, including
position changes, combat death and premature task-10 completion. Arbitrary
trigger `newtype` changes fail transactionally. These guards do not implement
combat interruption or ownership transfer.

### Task Admission Boundary

Pass original FIN-derived `animations` (all 32 direction timelines) and types
directly to `configureCampaignResourceLifecycle`, with a real initial binding
for every live source. `bindings` require actual constructor/resume direction,
bank/frame/delay/mode, order bytes and the three idle payload words. Do not derive
these from trigger count, sprite names, or a universal direction zero. See the
[native lifecycle evidence](resource-lifecycle-20260919.md).

Use `bindCampaignResourceTask(world, binding)` for an incoming extractor only
after the task owner has actually completed its preceding work. Generation and
real ground occupancy must match. A positive source visited earlier in native
slot order can deploy that idle extractor during the same update. Do not bind
all mobile units as fake idle tasks: a zero-rate source or an unready source
leaves mobile idle dispatch unsupported, and the host rejects the update.

`resource-task-released` is a handoff, not permission to silently run general
mobile idle. Before the following campaign update, the real mobile owner must
take ownership; otherwise block the session. Host-only resource stepping can
continue removing sources while released mobile tasks are excluded, but that is
not full mission simulation. Unknown tasks, mobile wait, combat interruption,
and arbitrary queued orders remain unsupported. Host checkpoints must reconnect
canonical task words through `transportHostState`; JSON cannot retain stack-array
alias identity. Session replay rebuilds that identity from actual inputs.

## Source Sound Resolution

The existing nonspatial `source-sound` request's **category 1/event 7** means
SLIST **row ID 1, group XTR**, not SOUND2 ID 7 or SLIST row 7.

The native SLIST parser compares the group against the string at `0x475bf4`
(`0x43132f..0x431342`) and sets event index 7. The executed parser stores the
actual original `1 XTR 183 -1` row in
`0x4cbc54 + 1*104 + 7*13`, count 1, initial variant index 0. Executing
`0x431bf4..0x431d77` with EAX=1, EDX=7, EBX=0, ECX=0 and stack argument 0
selects **sound 183** before the device callback. Original SOUND2 maps it to
**`SOUND/ERUPT.WAV`**, parameters `[1,1,0,0]`.

This test executes the real parser and lookup; readiness/device pointers are
isolated fixture inputs, and the device callback is not executed. Audio code is
unchanged. The audio owner may resolve that original asset and consume the
committed request exactly once by command identity. Do not spatialize it or
substitute deployment sound. A nonzero newrate literal still emits the request
when rate scaling produces zero; existing host command tests cover that rule.

## Verification And Limits

Eleven focused tests pass. Original HUMAN02 resource slots 167..170 and ALIEN02
slots 190,193,194 retain team 8, exact coordinates, reserve and rate. Each row is
isolated; the added same-tile extractor, open terrain fixture, constructor
direction/task snapshot, and explicit configuration/income state are synthetic
and identified as such. Original FIN profiles are loaded through the existing
native probe, not invented timelines. Positive-rate rows run 48 updates through
deployment and payouts at the original phase; zero-rate rows explicitly fail
general mobile idle. AI owners with actual zero HP gates still consume reserve.
The staging test proves settlement publication and unchanged source state on a
stale-generation failure. A JSON host checkpoint is exercised mid-deployment.

The original eleven tests above remain **bounded direct host tests**. The new
fourteen session tests exercise every resource row in HUMAN02 and ALIEN02 with
original clock, AI, money, coordinates, reserve and rate. Each row is isolated
and remapped to source slot 152; a synthetic same-tile extractor occupies 153.
Open terrain, empty mission triggers, configured multipliers, gate/local-team
inputs and zero initial incomes are explicitly synthetic. All three initial
idle words, constructor direction and FIN timelines come from the native trace.

Session coverage includes per-update credit/income/pulses, zero HP AI gates,
same-update colony death, full32 HP 65536, live AI/multiplier/local-team inputs,
phase rollover, income wrapping, pending cancellation, ownership guards and
rollback after host dispatch or trigger failure. Both factions JSON-checkpoint
mid-deployment and replay the next 100 updates with exact state and journal.

The native low-HP cases additionally use the probe's synthetic tile `(5,5)`,
rate 22, reserve 100, extractor HP 270 and elapsed clock zero. Every update is
compared to executed native task/animation/settlement data through source removal
visit 150; income starts at the probe's explicit zero and funds retain SCN money
with native deltas. A JSON replay mid-removal checks canonical task words. The
cancelled healthy extractor publishes release, then the next session update is
explicitly blocked for missing general mobile ownership. No callbacks or fake
idle dispatch bypass that boundary. This is bounded opt-in session coverage,
not universal mission admission or a complete HUMAN02/ALIEN02 playthrough.

```sh
node --import tsx --test tools/qa/campaign-resource-frame.test.ts
node --import tsx --test tools/qa/resource-session-lifecycle.test.ts tools/qa/campaign-session.test.ts
npm run typecheck
```

The test runs native probes with the existing Capstone/Unicorn directories
`/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918`. Set
`DC_RESOURCE_LIFECYCLE_TRACE` to a matching existing native JSON trace to reuse
FIN evidence. No agents, browser, full suite, or raw source modifications.