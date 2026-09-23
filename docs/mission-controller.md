# Mission Controller Contract

**Phase 5 remains partial. No phases 1-4 acceptance is asserted here.**
This isolated controller does not enable campaign play, complete a mission,
implement transport flight, or establish visual acceptance. No existing engine,
view, main entry point, or export barrel is changed.

## API

- `createMissionController(blocks, statistics)` snapshots the complete supplied
  blocks, including IDs, mode, initial flag/lives, conditions, action arguments,
  raw action text, and additional cloneable metadata. Statistics must be
  explicitly initialized by the caller; absent counters are not invented.
- `planMissionStep(state, inputs, event, losses?)` is pure. Inputs contain the
  original int32 simulation cycle counter, an independent uint32 millisecond
  clock, and actual `b(team,slot)` structure states. Event is one explicit
  `normal` scan or one `trip` with trigger ID and moving team.
- A plan contains `base`, nullable `next`, `commands`, source-indexed `trace`,
  `fired`, `diagnostics`, and nullable `pendingEvaluation`. `fired` and `trace` describe proposed execution,
  **not committed effects**. A blocked plan has `next: null`; its commands are
  inspection-only. Planning stops after the first blocked block and reports
  every unsupported world action in that block.
- `pendingEvaluation` identifies the next condition and the preceding command IDs
  requiring ordered world feedback. Such a plan has `next: null`, retains its
  proposed commands, and stops **before** evaluating that condition. This is a
  distinct state from unsupported-action diagnostics, not permission to commit
  the prefix. Resumable ordered evaluation is not implemented.
- `commitMissionPlan(current, plan, world, adapter)` rejects stale state identity
  and blocked plans before calling the adapter. It returns a new controller
  state, world, and receipts only when preparation succeeds and every command
  has a valid ordered receipt. Publish the returned state and world together.
  Replace `current` after commit; never submit a committed plan with its old base.
- `decodeMissionWorldAction(action)` exposes evidence-gated command decoding.
- `createMissionStartupAdapter(handlers)` composes explicit synchronous handlers
  in command order. Each receives staged world state and the complete planned
  command, and returns a new world and a disposition, or diagnostics. The factory
  adds the matching command ID to each receipt. Missing handlers fail with
  `missing-input`; there are no default transport, message, economy, or order
  implementations. It snapshots the handler map, not the world. Every supplied
  handler must honor the immutable preparation contract below.
- `missionBailDeadlineExceeded(bail, clock)` implements the original strict
  unsigned comparison, including wraparound. Exact deadline equality is false.
  The orchestrator polls this independently of scans, including when planning
  fails. A later successful bail can overwrite a still-pending bail.

Direct import: `src/engine/mission-controller.ts`.

## VM and Event Ownership

Conditions and victim-loss increments use the existing verified TRO VM helpers.
Each eligible block delegates its VM actions and post-action lives decrement
to `stepTriggerRuntime`, with a private trip-dispatch projection isolating that
block. Conditions have already been evaluated with the real normal/trip
context, so normal `S` still fails rather than receiving a fabricated team.
The original block snapshot is never rewritten. Normal IDs scan numerically;
same-scan rearming, reverse action order, byte lives wrap, signed `c >> 4`,
team-first statistic keys, and delayed/overwritable bail remain VM behavior.

World operations are declarative commands. Their placement relative to VM actions
is recorded in `trace`; adapters execute world commands in order against staged
world state. This is an atomic integration boundary, not a claim that the original
binary rolled back scripts on failure. Receipts alone do not establish that all
conditions were evaluated against the correct world.

After `exomoney`, `newtype`, or synchronous `reinforce2`, a later eligible block
reading `b(...)` or non-loss `s(...)` becomes `pendingEvaluation`. This deliberately
conservative dependency guard permits only literal team-first aggregate loss
reads `s(team,3)` and per-type loss reads `s(team,0,type)` to proceed, together with
clock/team/literal conditions. Dynamic statistic selectors are not exempt.
Dead blocks and unrelated trip blocks do not require evaluation. The guard is
not a general expression dependency analyzer; false-positive suspension is safer
than silently deciding a branch from stale inputs.

Native `exomoney` writes a side field, not the VM statistic tables; `newtype`
changes only the raw type byte. Nevertheless later economy/census/building
snapshots can depend on these effects. Future integration must determine the
original snapshot refresh timing, stage actions in source execution order,
evaluate subsequent conditions and expression actions at the correct point,
and publish the entire transaction together. Do not commit a prefix and restart
the normal scan, or merely patch counters after deciding all branches. Across
committed scans, the caller must also supply correctly timed world-derived
statistics/building slots; command receipts do not refresh them automatically.

Victim-loss events need stable IDs for actual combat removals, including a
generation if slots are reused. Identical IDs are consumed once across batches
and committed steps; conflicting reuse is an error. Only the victim's aggregate
selector 3 and per-type selector 0 increment. Attacker credit, transport pickup,
and owner conversion are not loss events. The persisted ID ledger is unbounded
for the mission; retain it across saves, or use a separately designed durable
event cursor before introducing pruning. Failed plans/adapter preparations do
not consume events. Re-submit them when retrying.

The caller owns scheduling: normal scans occur on the verified every-eight-update
gate, not every frame. Trips come from successful destination reservations using
`tripForReservedMtgDestination`, not region polling. Supply the actual cycle
counter; do not convert it to assumed seconds. Building slots come from reserved
structure state, not a building-type count. This controller does not manufacture
placements, census snapshots, trip regions, or initial troops.

## World Adapter Obligations

`MissionWorldAdapter<World>.prepare(world, commands)` must be deterministic,
synchronous, side-effect-free, and all-or-nothing. Stage against immutable or
copied world state; never mutate the argument, launch audio, publish UI messages,
or modify live entities during preparation. Fail with diagnostics when required
world data or behavior is unavailable. Successful receipts certify adapter work,
not independent validation of its implementation. The controller cannot undo
side effects of an adapter that violates this contract.

Command IDs are stable within a controller revision (`revision:trigger:action`).
They are not global IDs: scope any external outbox/deduplication by mission
session too. World data must be current when preparing; replan if event ordering,
building slots, or the world snapshot changes. Retain arrays in command order.

| Command | Verified contract | Receipt |
| --- | --- | --- |
| `reinforce` | One pooled carrier, five ordered type/count groups, asynchronous descent/approach/collision-aware sequential delivery/ascent/release. Type 0 is valid. No troop formation expansion. | `scheduled` |
| `reinforce2` | Synchronously process ordered groups: coordinate FIFO append, or direct collision-aware creation if no FIFO matches. Preserve existing FIFO state and its ownership rules. | `applied` |
| `newtype` | Use `applyTriggerNewtype` with all 800 raw slots and 110 raw movement classes: first coordinate-matching ground slot, including inactive slots; only type byte changes. | `applied` or `verified-no-match` |
| `abduct` | Select commander's full slot from selected side; validate reference; status 0/10 skips, otherwise schedule carrier on carrier side. Later pickup follows current target position; no immediate deletion, ownership change, or loss event. | `scheduled` or `verified-inactive-target` |
| `msg` | Five byte fields: `presentationCode`, `reserved: 0`, `messageId`, `parameter3`, `parameter4`. Insert the loaded text into native-style message queue state; retain the two raw presentation parameters. Missing message text is an error. | `applied` |
| `waypoint` | First coordinate-matching entity among all 800 slots, with no active/type/team filter. Assign 1-8 ordered patrol points at tile centers and order bytes; do not move the entity immediately. | `applied` or `verified-no-match` |
| `exomoney` | Assign unsigned byte `value` as a dword at `game + 0xe30*team + 0x19b4`. Not an additive credit grant, boolean conversion, or direct statistic write. | `applied` |

Pool exhaustion, invalid commander references, or missing collision/queue data
are errors, not dropped commands. Transport completion does not gate bail.
The two reinforcement parser shapes supported are five complete pairs and the
four-pair shortened form verified with ALIEN01; the fifth pair becomes `(0,0)`.
Other shapes, nonliteral bytes, types outside 0..109, and `reinforce`'s special
first-word `(0,0)` payload are rejected. That special payload is not an empty
ordinary delivery. Coordinates remain original runtime tiles without clamping.

Preparation of messages means queue state is applied, not UI/audio publication.
An `applied` waypoint receipt certifies the order writes, not arrival. A
`scheduled` receipt is not valid for `msg`, `waypoint`, `exomoney`, or `reinforce2`.
Transport commands remain semantic scheduling requests; no fixed-delay delivery,
instant pickup, dropped payload, or intent-only mock establishes faithful
transport acceptance. The factory is an integration API, not a live adapter.

## Literal Action Evidence

Audited against the executable SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Addresses are x86-32 virtual addresses. The read-only reproduction is
[../tools/research/mission-actions.py](../tools/research/mission-actions.py),
reusing the existing hash-pinned PE loader and executing original instructions
with Unicorn. Native decimal conversion is `0x46d6b0`.

| Action | Parser entry after keyword match | Opcode / handler | Proven details |
| --- | --- | --- | --- |
| `msg` | `0x43fa3c` | 11 / `0x43d877` | Five sequential decimal-to-byte stores at action+4..8. Second byte must be zero. Message ID must be 0..29 with a non-null loaded text pointer. Calls `0x44d918`. |
| `waypoint` | `0x43f339` | 10 / `0x43e08d` | X/Y/count bytes, assertion `0 < count <= 8`, then count interleaved X/Y byte pairs. First coordinate match wins, including inactive slots; no match skips. |
| `exomoney` | `0x43f642` | 12 / `0x43d900` | Two decimal-to-byte stores; zero-extended value assigned to the selected side dword. No arithmetic addition and no statistic-table write. |

Message helper `0x44d918` queues text, current millisecond timestamp, parameter3,
parameter4, presentationCode, and initial value 31 in the respective arrays at
message-state offsets `0x78`, `0xf8`, `0xb8`, `0x138`, `0x178`, `0x1b8`.
It maintains up to 16 entries; parameter4 value 255 has special selection logic.
The probe executes the real queue insertion with only `0x40b030` (clock)
intercepted. Full-queue rollover, presentation, parameter timing units, and
audio behavior are not certified by this probe. The command intentionally
retains raw parameters rather than inventing their UI meaning.

Waypoint helper `0x43d764` writes `(tileX*256+128, tileY*256+128)` word pairs
at entity+`0xa6+4*index`, bytes `+0x36=1`, `+0x37=9`, and count at `+0xc6`.
The probe checks the entire 800-slot byte array for exact changes for 1, 2,
and 8 points, first inactive match, and no match. It does not execute patrol
movement/pathfinding. Exomoney probes cover zero, nonboolean 37, and 255,
verify the complete side region and unchanged statistic tables.

The native parsers narrow to bytes (`exomoney 4 256` becomes `(4,0)`, probed).
The controller deliberately accepts only exact-arity integer byte literals,
valid teams 0..7, valid message IDs, and exact waypoint pair counts. It rejects
overflow, negatives, fractions, expressions, missing/extra arguments, and
nonzero reserved message fields rather than reproducing unsafe native parsing.
No generic raw-command escape hatch, silent success, or fallback is provided.

## Startup And Remaining Work

At cycle 16 (`c >> 4 == 1`), with explicit statistics and building-slot inputs,
the unchanged HUMAN01 startup block 8 plans eight commands:
`msg`, `exomoney` for teams 4/3/2/0/1, `reinforce`, `waypoint`.
ALIEN01 block 1 plans `msg`, `reinforce2`, `reinforce`. Both have zero diagnostics
and no pending evaluation. Later first-mission conditions read unaffected loss
counters, so they can be evaluated without economy/census feedback.

HUMAN01 trip 7 can now propose rearming victory; both missions' victory scripts
can propose commands and bail. None of those facts proves committed world effects
or campaign completion. A production carrier, FIFO, collision, message/economy/
order adapter and ordered world-dependent evaluation are **not** included.
Unknown or malformed actions still block the entire transaction, with their
original source indexes retained.

Evidence: [trigger-runtime.md](trigger-runtime.md) for VM, counters and newtype;
[transport-decoding.md](transport-decoding.md) for parsers, transport, FIFO,
abduction, scan cadence, and deadline. Relevant addresses include reinforcement
parsers `0x43eb5c`/`0x43ec73`, carrier constructor `0x418f4c`, abduct handler
`0x43e1b1`, reinforce2 handler `0x43e349`, newtype handler `0x43e0fe`, and bail
expiry comparison `0x4011f1`.

## Verification

```sh
PYTHONPATH=/private/tmp/dc-re-capstone-20260918:/private/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/mission-actions.py
node --import tsx --test tools/qa/mission-controller.test.ts tools/qa/trigger-runtime.test.ts
npm run typecheck
```

Tests read actual HUMAN01/ALIEN01 TRO fixtures without replacing their actions.
They prove startup thresholds and complete proposed command sequences,
supplied structure predicates, ALIEN01's committed commander-loss
failure at cycle zero, and strict victory thresholds from injected victim-loss
events. HUMAN01's victory test uses an **explicitly injected rearmed checkpoint**;
trip 7 separately proves proposed rearming. These are script predicate tests, not successful
campaign walkthroughs. Synthetic scripts separately prove VM sequencing,
transaction rejection, per-command receipt requirements, pending-evaluation
commit refusal, trip lives, and delayed bail. The startup factory test stages
message/economy fixture changes and rejects HUMAN01 at the absent transport
handler, preserving the original world and controller state. Accounting-only
receipt fixtures test validation, not faithful adapter behavior.
The transport test adapter records an intent only; it does not claim pickup or
delivery. No browser, original-game playback, or full campaign acceptance is
claimed by these tests.