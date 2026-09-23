# Native Mode-3 AI Consumer

## Executable TypeScript Increment

2026-09-19. The [active reducer](../src/engine/legacy-ai-active.ts) is exported
through [legacy-ai](../src/engine/legacy-ai.ts). It implements computed native
state transitions, not snapshot lookup or order replay. **Mode 3 remains
blocked in the mission selector.** No session, view, main or simulation wiring
is changed. The APIs below are the implemented handoff to that next phase.

| Public API | Exact Executed Extent / Return |
| --- | --- |
| `initializeLegacyAiPolicy(state, inputs, ruleTable)` | Original `0x44bd2c` field effects: remembered-slot sentinels, observer team, `0x4571ac` PTH distances and region centers, group/bucket initializers, six callback IDs per group, constants and 18 source rule records. Returns `nextCallback: 0x457568`. |
| `consumeLegacyAiPreparation(state, inputs)` | Original `0x44be69..0x44be8b`: initial assignment only when policy byte 0 is set, clear that marker, then observation. One atomic commit. Returns `nextCallback: 0x457940`; does not silently skip demand/rules. |
| `consumeLegacyAiPolicyPipeline(state, inputs)` / `consumeLegacyAiDemand(state, inputs)` | Preparation through native demand/rules, or demand alone: reassign, recount groups/live queues, evaluate the exact 18-rule table and perform the first-zero action's credit debit/production intent. Returns `nextGroup: 0`, `readyWholeCall: false`; receipt/lifecycle remains pending. See [demand contract and evidence](ai-demand-rule-20260919.md). |
| `consumeLegacyAiAssignment(state, inputs)` | `0x457568`, category mapping, source dependency availability, live-owner/state/link census, quotas, weighted bucket selection with tie breaks, native word-counter wrapping and head insertion. Both initial and subsequent source invocations match. |
| `consumeLegacyAiObservation(state, inputs)` | `0x456ad0`: observer masks, cached actor sightings, live-owner exclusion, relation filtering, native MBULLET scoring/cancellation, conflict flags and nonweapon counts. Includes original `0x41b4a0` free-cell search for zero-family cells. |
| `consumeLegacyAiGroupOne(state, rngTable)` | Complete group-1 invocation, including random retarget, full-member release and bucket creation, in native order `0x4578a0`, `0x44bbec`, `0x4593a8`, `0x463e78`. Atomic policy/entities/force/RNG; returns ordered events, packets, actual RNG draw count, `completeInvocation: true`, `nextGroup: 2`, `admitted: false`. |
| `consumeLegacyAiGroupTwo(state, inputs)` | **One complete group-2 decision/emission invocation**: `0x4578a0`, `0x44bbec`, `0x458b44`, `0x463e78`, including strength, threat, target selection, weighted routing and fallback helpers. Atomic policy/entities/force-order commit, zero RNG draws, ordered callback/packet events, explicit enabled-bucket count, `groupsCompleted: 1`, `completeInvocation: true`, `nextGroup: 3`. Packet receipt remains external. See [group-2 native evidence](ai-group-two-20260919.md). |

The [whole-policy computation](ai-full-policy-20260919.md) supersedes the
former bounded group-one restriction. It composes initialization when needed,
preparation/demand and all four completed group modules in original order,
with explicit actor transport decoding and typed pending-owner packets.
`readyWholeCall: true` means completed source-separated computation, while
runtime receipt/task ownership and mission admission remain blocked. The
original pipeline API above remains intentionally preparation/demand-only.

### Input Contract

`state` contains a complete 0x6c40-byte policy, 800*220 entity bytes, PTH
dimensions/families/65536 next-family bytes and the native force-order byte.
For groups 1 and 2 it additionally contains `rngCursor`. Group 2 also takes the
source team, type/weapon/MBULLET tables and the original 256*32-byte PTH neighbor
table; it never derives adjacency by guessing from region numbers. Initialization consumes the
caller's allocation seed; it does not fill unrelated bytes with invented zeros.
For a source-backed zeroed allocation use `new Uint8Array(0x6c40)`.

`LegacyAiAssignmentInputs` supplies `team`, complete 110*280 source type records,
weapon records (72 bytes each), signed-word MBULLET rows, 100 relation bytes,
eight visibility masks, native dword occupancy cells, complete 0xe30 team
record and 110*52 dependency records. `LegacyAiPolicyInputs` is the observation
subset. Occupancy is the native map+0x804 row data, **not** just terrain flags
or a browser-visible boolean. PTH and occupancy dimensions are checked.
The constructor also takes the 216-byte executable rule table. Callback
pointers are encoded as native numeric identifiers, never called as JS
pointers. The host must provide source-derived tables, occupancy and current
entity ownership; expected output snapshots are test-only.

Runnable verification, without historical world replay:

```sh
node --import tsx --test tools/qa/legacy-ai-active.test.ts
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
   python3 -B tools/research/ai-policy-20260919.py --active-consumer-goldens
```

`DC_AI_ACTIVE_TRACE` can point the test at that second command's JSONL output.
The probe uses source-initialized isolated invocations; it does not replace
the corrected full-SCN natural-world evidence below. Transport submission is
captured/bypassed, not consumed by actors. All policy and entity bytes plus
ordered packets are compared to original before/after buffers. Seven focused
tests include **26 native controls**: same-family friendly negatives, allied
visibility, death/cache clearing, unseen remembered actors, neutral current
owner, zero-family relocation, assignment ownership/state/link negatives and
two nonzero allocation seeds per mission. Invalid native routes and malformed
inputs roll back RNG, force-order and both buffers.

Demand/rule orchestration `0x457940` / `0x4578d0` and the complete rule table
are now implemented with pending-owner production intents; see the linked
demand report for the exact inputs and historical-capture limitation.
All four group computations, including group-one helpers `0x463840`,
`0x464074`, `0x463eec`, are now composed in the separate full-policy API.
Remaining owners: atomic runtime receipt/production commit and subsequent
registered task consumption. Do not call
the bounded group immediately after preparation while ignoring its returned
`nextCallback`, and do not treat `completeInvocation` as mission admission.

## Full SCN Oracle Follow-Up

2026-09-19. This section supersedes the partial-SCN initialization and extra
final-selector evidence below. **TypeScript active mode-3 AI remains blocked.**
Only this report, the native probe and focused AI tests are changed.

`--source-initialization-proof` executes original **0x41b920 through its return**
on a fresh game and selected campaign configuration, with all 180 HUMAN02 /
203 ALIEN02 noncomment SCN lines consumed. The actual TRO compiler and MSG
loader run inside it. File, allocation, prebound GAMESTAT/FIN/dependency assets,
preloaded MAP/PTH/MTG and external clock interfaces are recorded explicitly.
The asset callback at 0x43c388 installs source-parsed type and complete
110*52-byte dependency records; it is not proof of the complete graphics/audio
asset-loading pipeline. The map callback returns the source-backed map with
the already-executed native PTH constructor. City, task, dependency-availability,
relation, occupancy and checksum functions are not replaced by no-ops.

### Exact Initialization

- All eight teams execute the original scanner beyond 0x41c2b0 through
   0x41c31b. Four queue-enabled bytes at side+0x108 are 1; +0x10c flags and
   +0x110 words are zero; four queue words at +0xd9c are -1; +0xe1c is 3.
   Side means game+0xb98+team*0xe30. Full 0xe30-byte team captures are retained.
- Race, money, mode, colour, coordinates and dependencies are parsed from SCN.
   The AISlots line is read by the original loader, not interpreted by the
   harness. Original 0x41bf38 sets side+0xda4[sourceId]. If either base coordinate
   is zero, 0x41c0a7..0x41c0ae additionally enables dependency IDs **14 and 0**.
   Both zero AI coordinates fall back to base coordinates. Tests compare these
   transformations, not just literal source-line equality.
- Original 0x41c3ef..0x41c428 calls **0x444f14 120 times**, 15 slots for each
   of eight teams. Both missions register city slots **0,1,5**, with HP
   **4800,2400,1**. HUMAN types are 16,17,81; ALIEN types are 28,29,81.
   Native positions and all eight occupied footprint cells equal the existing
   browser `projectLegacyColony` projection of the real SCN. Slot 5 has no
   footprint. Original 0x412014, 0x41822c, 0x437bc4, 0x445570 and 0x44ac28 run;
   task 19's initial payload word is **0**.
- Original FIN timelines, 32-direction banks and construction banks are retained.
   GAMESTAT token **20** is scanned into type+0xdc (argument setup 0x43bc2f);
   its zero is source-backed, not an assumed image default. This differs from
   FIN variant count +0xd8: types 0,8,16,17,28,29,81 have **7,6,5,5,6,7,0**.
- Resource setup runs 0x419d60, 0x4012b4..0x4012e6,
   0x4014c6..0x4014ed and 0x40183b..0x40185f. Original defaults 4 become
   rate/reserve scales **256** before SCN construction. VENT slots retain owner
   8 and source reserves: HUMAN **3500,3500,12000,7000**, ALIEN **9500,3500,5000**.
- Startup 0x40150b..0x401515 and the SCN entry's 0x41b933 call execute the
   original policy setter **0x411da4**, after poisoning the cursor to 197.
   Explicit selected seed **0** becomes cursor 0; controls 0,1,255,256,0x1234
   produce **0,1,255,0,52** through both call sites. This is a selected deterministic
   profile, not a recovered installed-menu seed. CRT seed 1 is separate.
- Pristine goldens contain all **800*220 entity bytes**, all **800 registry
   words**, every registered actor's position/HP and exact source setup calls.
   Registered counts are **21 HUMAN / 44 ALIEN**, including three cities.
   SCN damaged-unit HP overrides remain intact. No actor relocation or HP clamp
   is applied, either at initialization or between ticks.

### Historical Scheduler Evidence

The complete-world path no longer calls an extra final 0x41ab20 or dispatches
actors at a frozen clock. It observes selectors called from **0x41ac71** and
**0x41aca1**, attributes group returns to team/frame, retains full before/after
policy and entity buffers, and observes receipt and later registered task
returns inside normal world ticks. Default bounds now include 64 feedback
ticks: **14160 HUMAN / 1200 ALIEN**. A prefix is not activation acceptance.

The source-only proof and both 64-world prefixes pass. The corrected replay
returns **14160 HUMAN / 1200 ALIEN** worlds with null failures. Old 14096/1136
hashes do not certify this newly initialized world. A development capture with
missing resource scales produced zero VENT reserves; it is rejected, not a
golden. The source comparison caught that omission before acceptance.

| Evidence | HUMAN02 | ALIEN02 |
| --- | --- | --- |
| Target team / first natural four-group frame | 2 / **14124** | 1 / **1160** |
| Selector caller for all four groups | 0x41aca1 | 0x41aca1 |
| Later target actor consumptions | **0** | **7**, all at frame **1161** |
| Target empty-order rejection | **true** | false |
| Complete bounded world history | **true** | **true** |
| Natural scheduler activation | **true** | **true** |
| Target subsequent-world feedback | **false** | **true** |
| TS mission admission | **false** | **false** |

HUMAN target visits at 14124 and 14156 emit three zero-member mode-7 packets
each. The decoder makes no entity writes for those packets. The **81** earlier
actor consumptions belong to other policy history and must not be presented
as target-team feedback. The former extra-selector slot-157 proof does not
reproduce under this corrected setup and natural scheduling. This is a retained
negative result, not an excuse to restore omitted cities or clamp battle HP.

ALIEN's target sends seven actor-bearing mode-7 packets and three empty packets
at 1160. Slots **160,161,162,165,166,167,199** enter the registered dispatcher
in world 1161 with pending=1, run original 0x412014, and return pending=0 with
changed task stacks. Before/after 220-byte records, receipt frame, consumption
frame, selected team and native handler observations are retained. Delayed
orders elsewhere in HUMAN are recorded as `native-task-retained-pending` until
their actual consumption; no dispatcher result is supplied by the harness.

Measured replay counters, not fire-cadence certification:

| Counter | HUMAN02 | ALIEN02 |
| --- | --- | --- |
| Policy RNG / CRT RNG draws | 57047 / 13666 | 1724 / 0 |
| 0x441710 / 0x4121d8 entries | 13661 / 13661 | 0 / 0 |
| Projectile reclaims / final high-water | 13651 / 18 | 0 / 0 |
| Submitted packets, including world traffic | 17676 | 1287 |
| Final source clock | 357 | 149 |

Final entity SHA-256 values are
`8eefcbb58517b6f00a819dbb90c4a99e41945caa45dca19658edbd242c8a513d` (HUMAN)
and `f79c35c48d238c6c977309321e539c87f3d17bd1d955b14ff15937b4dcf16d12` (ALIEN).
Full before/after group buffers are hashed and byte-count checked by the tests.
Final focused verification: **33/33 pass, zero skipped**, including all 15 AI
tests and the colony, scenario-city and placement globs. Log:
`/tmp/dc-ai-gap-focused-globs-final-20260919-31.log`. The strict TypeScript slice
check also passes. The earlier 31/33 development run had two obsolete
assertions. A subsequent report-only indentation error was fixed and the
affected native captures regenerated; neither failed run is acceptance evidence.

Final local captures:

- Source proof: `/tmp/dc-ai-gap-source-proof-20260919-16.jsonl`, SHA-256
   `187020b4b33066743e64447b50b520716dc43d021af32678df56422633ec1bb7`.
- HUMAN world: `/tmp/dc-ai-gap-natural-human-20260919-25.jsonl`, SHA-256
   `53245c583dcd87bee5553e6d2e73cb7a1d924706ea28167bc7fdd9f6a8db1466`.
- ALIEN world: `/tmp/dc-ai-gap-natural-alien-20260919-24.jsonl`, SHA-256
   `53c46951c0ffc967d3152d1ce6b167c0317086e23ba3b5fe784df451505f3d59`.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
   python3 -B tools/research/ai-policy-20260919.py --source-initialization-proof
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
   python3 -B tools/research/ai-policy-20260919.py --world-activation-scan
DC_AI_SOURCE_TRACE=/tmp/dc-ai-gap-source-proof-20260919-16.jsonl \
DC_AI_HUMAN_WORLD_TRACE=/tmp/dc-ai-gap-natural-human-20260919-25.jsonl \
DC_AI_ALIEN_WORLD_TRACE=/tmp/dc-ai-gap-natural-alien-20260919-24.jsonl \
   node --import tsx --test tools/qa/legacy-ai.test.ts \
      tools/qa/legacy-colony*.test.ts tools/qa/scenario-placement*.test.ts \
      tools/qa/scenario-city*.test.ts
```

`sourceInitializationComplete`, `completeWorldHistory`, natural scheduler
activation and subsequent feedback are separate evidence fields. Complete
world history means only the requested bounded execution with its explicit
external interfaces; it does not certify installed settings, original-game
reference parity, fire cadence, or TypeScript implementation. `admitted`
remains false. The historical `runtimeCoreInterceptions: []` output is not an
automatic interception detector; the recorded external boundaries and executed
original calls delimit this proof. No browser, agents, full suite, or
application-gate interruption.

## Earlier Evidence

Updated 2026-09-19. **Accumulator, member cleanup, and the shared group-1/2
order dispatcher are implemented and native-differential tested. Complete
active mission-2 policy remains BLOCKED.**
This continuation changes the [native probe](../tools/research/ai-policy-20260919.py),
this report and the [focused tests](../tools/qa/legacy-ai.test.ts).
The existing [bounded consumer](../src/engine/legacy-ai.ts) is unchanged.
Original relation constructors and SCN population execute and pass adversarial
goldens. **The missing `game+0x950` session and clock gateway are now resolved**
by original local client/server constructors, ready handshake and packet pumps.
The former **55 HUMAN / 36 ALIEN** source-path-family stops are resolved by
the original PTH loader, not altered families or relocated actors. Bounded
native runs now reach **14096 HUMAN / 1136 ALIEN** world returns and all four
target policy groups. **Mission admission, complete-world acceptance and
fire-cadence certification remain false/unproven.** See the path-constructor
evidence below; the earlier short-prefix report is retained as history.
No shared main/view/session/controller/world/simulation edits, generated assets,
agents, browser, or full suite. This extends
[the selector-only audit](mission02-control-actions-20260919.md).

## Group-1/2 Order Consumer

`consumeLegacyAiGroupOrders(state, group)` now executes the decisions of
`0x463e78` and its per-bucket helper `0x463a58` for group 1 or 2. This is a
field consumer, not an active-callback placeholder: it mutates the complete
native policy/entity buffers, consumes the global reissue byte, and returns
ordered native packet bytes. It consumes **zero RNG draws**. It does not
execute group decision callbacks `0x4593a8` / `0x458b44`, submit packets, advance
entity tasks, or admit mode 3.

`LegacyAiOrderState` requires the copied `0x6c40` policy, `800*220` entities,
`forceOrder` byte from `0x489510`, and `LegacyAiNavigation`: dimensions, original
PTH cell-family bytes, and its 65536-byte next-family table. Call this **after**
the same group's prelude and decision callback; do not run all preludes first.
The decision callback's policy output is an input, not a reconstructed default.
Commit buffers, returned packets, and the reissue byte together in a host
transaction. Packet receipt/consumption remains the host's unimplemented
contract, so this result always has `admitted: false`.

| Field | Recovered consumer |
| --- | --- |
| Bucket `+0x1e95` | Visit enabled buckets 0..15 in order. The first enabled bucket consumes and clears the global reissue byte, even if empty; disabled buckets do not. |
| Bucket `+0x1e9c/+0x1ea0` | Current region / final route region, read as native dwords. |
| Bucket `+0x1ea6/+0x1ea8` | Signed word route cursor / 256 route bytes. Advance cursor unless the selected byte equals the final region; then store the selected region as current. |
| Entity `+0xcc` | Zero becomes 2. A nearby member changes 2 to 1; outstanding movement uses mode 7 for value 2, mode 2 otherwise. |
| Entity `+0xcd/+0xce/+0xcf` | Last tile X/Y and stationary counter. Same tile increments below 60; tile change records coordinates and resets counter. Values already above 60 are not clamped. |
| Entity `+0x11` | Assigned region. Changed before an individual or batch coordinate packet; unchanged assignment suppresses that member's duplicate order. |

Distance is the exact `0x44b640` PTH traversal: missing endpoint or a zero hop
returns 255, equal nonzero endpoints return zero, otherwise count next hops
with the original 256-hop cap. It is not distance in tiles. Types 1/9 with
distance **less than 3** and stationary counter **greater than 3** emit opcode
13 and reset that counter. Other members beyond **3** hops, or under reissue,
receive mode-2/7 orders if their assignment changed. Such a member holds route
advancement only when its counter is below 60 and its `+0xcc` is not 2.
Without that hold, advance the route and emit the native batch mode-7 packet,
including a zero-member packet when nothing needs reassignment.

The consumer stages all writes, validates callback identity, buffer sizes and
non-overlap, list links, nonzero member state, map bounds, regions and accessed
route cursors, then commits. Corrupt input fails atomically. These checks are
host safety, not substituted native policy decisions. State 10 is not newly
filtered here: the preceding cleanup callback owns its removal.

`--decision-goldens` executes source constructors, city/PTH/occupancy setup,
native scheduler initialization, assignment, observation, demand/rules and
group callbacks. It captures complete before/after state at **both** decision
and order boundaries through group 2. Transport submission at `0x421725` is
explicitly bypassed to let subsequent native callbacks run; this is not an
order-consumption golden or reconstructed activation history.

Source results for the new TS callback:

- HUMAN02 groups 1/2 emit respectively one and two zero-member packets.
- ALIEN02 group 1 emits mode-7 packets for slots **161,160**, then an empty
   packet. Group 2 emits **166,162**, empty, **167,165**, empty. All destinations
   are Q8 `(256,18688)`, from native policy region 26, not a hardcoded TS target.
- Every policy/entity byte and packet matches original x86, with unchanged
   RNG cursor. In these snapshots the preceding native group-2 decision writes
   bytes `policy+0x449c/+0x45c8` from 2 to 3; that callback is still **native-only**.
- Ten explicitly labeled controls on copied source state cover reissue,
   mode-2 hold/saturation, near arrival, near forced reissue, types 1/9 opcode
   13, a real PTH-derived route step, all-disabled buckets, and 61 repeated
   calls. These are branch controls, not activation-world claims. Near-type
   controls alter the source member's type and position explicitly; no idle
   actor is inserted and no AI decision callback is stubbed.

## Bounded Activation Continuation

The two former stops are resolved. HUMAN02's missing movement bank at update
52 and ALIEN02's missing MSG entry at caller `0x44d95f` are no longer the
boundary. **The limited replay is not complete mission admission.**

`--activation-scan` compiles every original TRO byte and predecessor link,
scans at counters divisible by eight (including zero), executes the native
counter increment and registered-entity loop between scans, and runs native
AI scheduling. Configured limits are **14096 updates HUMAN02 / 1136 ALIEN02**, five million
instructions per world slice and fifty million per policy call. Five million
was insufficient for the finite 256-region scoring loops; no scoring callback
was replaced. `--mission HUMAN` / `--mission ALIEN` isolates a run. The former
HUMAN02 result at 14096 is **superseded**, not reproduced after correcting the
native fresh-game projectile initialization.

| Mission | Limited replay at the bound | Acceptance |
| --- | --- | --- |
| HUMAN02 | Scans complete through 2896; entity update **2901** reaches the original projectile allocator capacity diagnostic. Team 2 remains mode **4**, with no completed policy groups. | **Not activation evidence.** This limited loop omits projectile updates/reclamation. Do not restore incorrect zero sentinels to reproduce the old 14096 result. |
| ALIEN02 | Original earlier messages, commander creation, carrier tasks and abduction execute before `ai 1 3`. Explicit target selector call returns through all four groups. Ten packets are decoded, seven actor-bearing. | Conditional native evidence only. Slots **160,161,162,165,166,167,193** subsequently consume pending mode-7 orders in the native task dispatcher. |

When activation is reached, the final selector call is explicitly `0x41ab20(eax=game, edx=targetTeam)` at
the activation snapshot, **not** a claim that the round-robin scheduler chose
that team on that frame. `groupCompletions` verifies each unchanged callback
table and all four return sites per group, and records full policy/entity
before/after hashes and changed-byte counts. Native call order is table indices
**0,3,1,2**, not all six stored pointers. Empty groups are reported, never
replaced with no-op implementations or counted as actor-order proof.

`0x41defc` packet decoding calls real `0x41ce54` and writes pending orders.
`taskConsumptionProbe` then makes one real `0x419248(eax=game, edx=slot)` visit
per affected actor at the **frozen activation clock**. For all seven ALIEN02
actors, pending changes **1 -> 0** and task-stack bytes change. This is a
separate checkpoint follow-through, not an extra historical world update or
proof of later arrival/combat.

### Source Initialization

The construction/resource probes' FIN marshalling is reused before SCN actor
construction. Original 72-byte timelines, descriptor frame pointers/counts and
32-direction banks are copied with their real pointers. Source placements,
VENT resource rows, and TRO reinforcement types determine the loaded profiles.
No animation completion or movement result is supplied by a hook.

- Native `0x43be2a..0x43be59` binds movement at type **+0x7c**. This was the
   missing DROP/SAUC dependency. Both carriers now execute payload task 21.
- Native stand/death/construction binding remains from the construction
   helper; attack-event loading is enabled. Resource deploy binding uses
   `0x43c099..0x43c18c`; native idle/variant binding uses
   `0x43c217..0x43c36d`. All non-null bank pointers through +0xd4 are retained.
- The GAMESTAT header supplies `obj_types` through native `0x43bb62..0x43bb6a`.
   The complete fresh-game reset `0x40bf80`, called by constructor `0x40c0a0`
   at `0x40c102`, now runs before source placements. It initializes all **800
   registry words**, both projectile heads at `+0x468e8/+0x468ea`, and the
   `+0x14` sentinel of **2024 projectile records of 40 bytes** at `+0x32ca8`.
   All sentinels are checked as -1. The former registry-only slice omitted
   those projectile preconditions and left zero as a false valid list index.
- Original MSG bytes pass through `0x44d6f0(eax=allocator, edx=messageState,
   ebx=filename)` and `0x44da88` initialization. Real `0x44d918` preserves queue,
   metadata and timestamp writes; no message action is bypassed.
- Original SLIST and terrain AMB bytes pass through
   `0x431130(eax=0x498f60 interface, edx=terrainBasename)`. Native sound category
   selection and variant writes remain active, including their CRT RNG.

The original pinned carrier FIN hashes remain:

| FIN | SHA-256 |
| --- | --- |
| SAWS | `7c9b19edfd72193b537e97661884912d593ad21763659ad9133b113b8dfadf27` |
| DROP | `66e8da41ff0a47229c1a33db4aae9e7f37307ec943f5bbd860acc832b07fc433` |
| SAUC | `e3378e2f627df2550e899844e8e13e4b65c5e3c10db1d792f1479096a6d58dd7` |

### Explicit Fixture Interfaces

These describe the limited replay, not recovered original user settings. Results log
substituted file/allocator/formatting/FIN-lookup and output boundaries.

| Interface | Actual contract |
| --- | --- |
| Mode/config | `game+0x544 -> 0x850000`, explicit zero-initialized record, outside entity storage. |
| Frame/clock | Harness supplies `game+0x94c` once per entity loop. Native `0x41989e..0x4198c3` increments +0x52c/+0x530. External `0x40b030()` returns counter*1000/16 milliseconds. Day/night rollover and the surrounding world services are not executed. |
| Scheduler | `0x41aa70(eax=game)` initializes allocation/state; `0x41ac2c(eax=game)` runs each frame, retaining mode-4 draws and other teams' active policies. |
| Transport | `0x421630(eax=game)` binds the decoder; `0x42163c(eax=1)` / `(eax=0)` brackets scheduling as in `0x419cbc..0x419cd5`. Packets take the original local decoder path; **no transport epilogue jump** is used. |
| Entity loop | `0x419bb8..0x419c0e`, `[ebp-4]=game`, dispatches actual registered slots. |
| Audio output only | `interface 0x498f60 +8 -> 0x852000`; method +0x80 takes `eax=sample, edx=volume, ebx=pan`, no stack arguments, returns -1 (output unavailable). Logs caller and arguments; does not skip the enclosing sound routine or its RNG. Explicit camera Q8 is (0,0), not a recovered live camera. |
| CRT thread/RNG | `0x516a94 -> 0x854000`, explicit seed **1** through native `0x44e251(eax=seed)`. Every subsequent `0x44e22d` draw executes unchanged; this separate seed is not the policy RNG cursor. |

### Recovered Relations

The old `0x41e830` null-object boundary is resolved in both missions:

1. Fresh SCN setup `0x41b93d..0x41b965` executes its original two calls to
   **`0x41e7a0`**, storing the returned pointers through
   `[game + edx*4 + 0x4719c]`. These are **two eight-byte directed bit tables**,
   not guessed class layouts. The constructor requests eight bytes from
   `0x40bcc0` and clears them itself at `0x41e7b8..0x41e7d1`.
2. The allocator boundary returns **0xa5-poisoned** storage with eight-byte
   guards on each side. Native zeroing, exact allocation sizes, stored pointers
   and unchanged guards are asserted. No zero-filled replacement object is
   passed off as successful construction.
3. Original `0x41bf45..0x41c029` reads each source SCN `TeamAllies` line
   through the existing line-reader interface and parses it with `0x406780`.
   Native `0x41e7d8` sets directed alliance bits. The loader forces self bits
   in both tables, but **does not copy alliances into shared vision**. Its
   original neutral cache writes also execute.
4. Native `0x41e820` requires both directed bits, unlike one-way query
   `0x41e7fc`. Every source alliance pair is checked. The contiguous
   `0x41989e..0x419990` prefix then performs population calculation and all
   **128 relation queries**, producing the actual 8x8 alliance cache at
   `+0x46f34` (row stride 10) and eight masks at `team+0x19c0`.

| Source | Alliance bytes, team order 0..7 | Shared-vision bytes |
| --- | --- | --- |
| HUMAN02 | `13 13 0c 0c 13 20 40 80` | `01 02 04 08 10 20 40 80` |
| ALIEN02 | `01 06 06 08 10 20 40 80` | `01 02 04 08 10 20 40 80` |

The source masks are `0x40000000 >> team`, despite the nontrivial alliances.
Sixteen labeled adversarial controls execute native setters and the same
world prefix in isolated Unicorn copies: unilateral versus reciprocal
alliances, a nontransitive chain, unilateral versus reciprocal shared vision,
revocation of an **existing source** alliance, cleared visibility diagonal,
and removal of previously shared vision. Alliance alone does not share vision;
shared vision alone does not establish alliance. Each case first runs a prior
prefix, so stale cache/mask bits are observable; the vision-revocation case
first establishes reciprocal sharing. Own visibility survives a cleared
diagonal. No result is injected into the relation lookup.

### Native Path Constructor Closure

The missing source-world dependency was **`0x442b7c`**, not an air-class
conversion or a missing family in the original PTH. The existing source-world
initializer and GAMESTAT header census remain in use. Full-world fixtures now
execute the complete native path loader before SCN placement:

- Its allocation boundary supplies the requested **0x238-byte row table**.
   Native code constructs rows inside `map+0x1404` with **162-cell pitch**, a
   one-cell border and **24-byte cells**; it reads the unmodified 65536-byte PTH
   header followed by 8064 family bytes, in original, unflipped Y order.
- `0x442caf..0x442d04` initializes cell `+0=0`, **`+4=-1`**, **`+8=x/+9=y`**,
   `+0x10=0`, `+0x0d=0`, and reads actual family at **`+0x0c`**. Family zero is
   not the cleared cache byte. Border families are 255. Every interior cell's
   coordinates, family and sentinel are checked against source bytes.
- `0x442d1f..0x442e41` builds the family adjacency lists from the original
   header; `0x442a10` clears route caches. No family, passable mask, entity
   coordinate, native assertion, or task result is substituted.

The former failing entities were both **RNAT type 25, owner 9, task 6**:

| Source | Native slot / spawn at frame 8 | Former failing Q8 position / goal | Former origin / destination |
| --- | --- | --- | --- |
| HUMAN02 | 172 / `(43,68)` | `(10884,17284)` / `(12160,17792)` | `(42,67)` / `(47,69)` |
| ALIEN02 | 198 / `(6,54)` | `(1160,13448)` / `(640,14464)` | `(4,52)` / `(2,56)` |

Both former origin cells are family **0 in original PTH**, also 0 under the
tested flipped-Y lookup. Original map-plane dwords there are `0xa0000000` /
`0x30000000`; ground occupancy low ten bits are 172 / 198, and both word
planes are 1023. The native constructor call is `0x41af14` from `0x41b745`.
`0x41b634` calls the original free-cell search `0x41b4a0`, which rejects family
zero for ground actors and checks ground occupancy at map `+0x804`. Air actors
instead check the word plane at `+0xc04`. The probe never relocates an actor.

The source type parser writes **type `+0x60`** at `0x43bd0e`. RNAT is ground
(0); AVII type 24 is air (1). `0x414d4a` reads that field, `0x414f30` gates the
ground-origin assertion, and `0x44492c` dispatches air requests to `0x444628`.
Thus RNAT was not legitimately spawned on a blocked ground cell: the omitted
path-cell state corrupted its subsequent navigation.

Executable controls, isolated from the mission world:

| Control | HUMAN / ALIEN result |
| --- | --- |
| Native constructor + task builder at recorded valid RNAT spawn | Both return; families 231 / 103; original coordinates retained |
| RNAT at the *former failing* zero-family origin, unchanged PTH | Both stop at literal diagnostic return `0x414faf`, before path dispatch |
| Native AVII constructor + task builder at the same zero-family origin | Both return through the real air solver; class 1 |
| Native loader, then clear only cell `+8/+9` in labeled adversarial copies | 49 / 36 complete worlds, then literal `ticker.c:1695` |
| Native loader, then clear only cell `+4` | Both complete the explicit 64-world control bound |
| Native loader, then clear both coordinates and `+4` | 49 / 36 complete worlds, then the same literal assertion |

All constructor/task controls execute zero battle frames and use original
`0x41af14` and `0x414ce4`, without forced skips or successful-return stubs.
They verify the entire original PTH header/family plane remains unchanged.
The omission controls are not admissible mission setups or activation claims.
They retain native row layout and borders, so the combined omission does not
reproduce HUMAN's old 55-return family-only fixture byte for byte. It does
reproduce the causal assertion without changing any source family.

The activation-limit capture records the following actual calls, not inferred
simulation outcomes:

| Measure | HUMAN02 | ALIEN02 |
| --- | --- | --- |
| Completed worlds / native counter | 14096 / 14096 | 1136 / 1136 |
| World entries / returns | 14096 / 14096 | 1136 / 1136 |
| Policy RNG / CRT RNG calls | 55264 / 12157 | 1628 / 0 |
| Packet submissions | 17654 | 1216 |
| Projectile updater `0x44293c` | 14096 | 1136 |
| Each other tracked world service | 882 | 72 |
| Projectile constructor / reload entries | 12152 / 12152 | 0 / 0 |
| Projectile reclaim entries / final high-water | 12137 / 17 | 0 / 0 |
| Final native source clock / policy cursor | 293 / 80 | 85 / 62 |
| Frozen-checkpoint ordered actor visits | 157 | 160,161,162,165,166,167,199 |

The native clock rolls over; it must not be replaced with `initialTime+ticks`.
Both target selectors reach 3 and all four groups return. The explicit final
selector call and subsequent actor visits remain separate from historical world
ticks. HUMAN's complete updater reclaims projectiles and passes the limited
replay's old update-2901 exhaustion; this does not certify firing cadence.
`admitted` and `acceptance.completeWorldHistory` remain **false**. Original
installed settings, omitted outer startup/UI contracts, full mission outcomes
and host runtime integration remain unproven.

Reproduce only the relevant research slices:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
   python3 -B tools/research/ai-policy-20260919.py --path-initialization-proof
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
   python3 -B tools/research/ai-policy-20260919.py --path-cell-controls
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
   python3 -B tools/research/ai-policy-20260919.py --world-activation-scan
```

`--world-prefix-limit 64` explicitly bounds the last command for diagnosis;
without it, the original 14096/1136 limits apply. The focused QA world golden
accepts `DC_AI_WORLD_TRACE` to verify an existing capture without another long
native run. No runtime game code was changed.

Final verification: **14/14 focused AI tests passed, zero skipped**, in
`/tmp/dc-ai-owned-file-final-20260919-r20.log`. The two path-specific tests also
passed independently in `/tmp/dc-ai-path-focused-final-20260919-r19.log`.
Clean default-limit replay:
`/tmp/dc-ai-native-world-clean-20260919-r12.jsonl`, SHA-256
`0c5b65be2fd37dffadf82bdc10408c744a40e1e05fdf37b9efc79f9d5cb002b1`.
Both missions have null failure, return EIP `0x70d000`, zero runtime core
interceptions and unchanged false admission/complete-world acceptance flags.
The clean replay agrees with the earlier long capture's final entity hashes,
ticks, RNG counts and packet counts; interrupted wrappers are not test passes.
The final cell omission controls are in
`/tmp/dc-ai-cell-controls-final-20260919-r15.jsonl`.

```sh
DC_AI_WORLD_TRACE=/tmp/dc-ai-native-world-clean-20260919-r12.jsonl \
   node --import tsx --test tools/qa/legacy-ai.test.ts
```

### Historical Session Boundary

The following 55/36 report describes the superseded, family-only path fixture.
The session/transport constructor evidence remains applicable.

`--world-activation-scan` now enters **`0x40b3cc(server)`**, then
**`0x41e4f4(game)`**. Native clock packets reach `0x41cb2c` and the complete
**`0x4196f4(game)`**, with a 50-million-instruction receive budget. The harness
does not write `game+0x94c` on this path or splice world services. Original SCN
clock parsing `0x41bc2f..0x41bcd0` supplies
`phase, period, initialTime, transition`: HUMAN `[0,6300,5100,75]`, ALIEN
`[1,6750,5700,75]`. The source clock is separate from the limited replay's
explicit zero-clock fixture.

The original setup now executed is:

1. `0x40c0a0` constructs the game and its **0x2000-byte receive buffer** at
   `game+0x958`, runs `0x40bf80`, and initializes all eight connection indices.
   Its allocator boundary returns storage cleared by original
   `0x40bddc..0x40bdef` from poison, not an invented initialized game object.
2. Configuration constructor body `0x4298e7..0x429a34` and header loader
   `0x429f28..0x42a00b` execute for explicit selected mode **0**, race **0/1**,
   fresh empty save name. Header `[1,0,race,0,0,0,0,0]` is an explicit profile,
   **not recovered installed user settings**. Original `0x40177e..0x4017ba`
   converts the constructor's eight 100-percent multipliers to 256.
3. Common fresh startup `0x40123c` selects factory **`0x40bb6c` (`local.c`)**
   when its session argument is null; campaign selection reaches this common
   startup at `0x4036e2` with host flag 1. The outer UI/window loop is not run.
   The factory and server constructor **`0x40b050`** execute, allocating
   **0x80, 0x10024, 0x24c** bytes through original clearing allocator `0x40644c`.
   Only its CRT malloc boundary supplies poisoned storage; guards survive.
4. Original `0x4013a6..0x401405` calls interface `+0x64` -> **`0x40ba00`**,
   builds the 16-byte client transport and assigns **`game+0x950`**. Native
   fields are interface pointer, sequence bytes 0/0, read queue 1, write queue
   0. Padding remains `a5 a5`. Server method `+0x68` -> `0x40ba9c` reverses
   those queue directions. No pointer filled with guessed defaults is used.
5. `0x401984..0x401a34` executes the original ready transition and emits
   **`07007600000200`**. Server pump `0x40b3cc` consumes it and changes state
   **1 -> 2**; all four queue lengths are initially zero and the ready queue
   drains. Send `+0x5c` -> `0x40b810`, receive `+0x60` -> `0x40b8e4`, available
   `+0x6c` -> `0x40b9e8`, broadcast `+0x74` -> `0x43ace8` remain original.
6. SCN prefix **`0x41b9d3..0x41bab7`** initializes receive sentinel
   `game+0x954=-1`, buffered length, timing history, 66-ms period and other
   client fields. Omitting it produces the real `0x41e14c` diagnostic after
   the first world return; that diagnostic was not suppressed.

Offline behavior is **native in-memory bidirectional delivery**, not network
nondelivery. There is **no OS/network stub**. The external clock starts at zero;
each cycle pumps queued commands at the current time, then advances by the
server's resulting `+0x234` period and pumps/delivers the next clock packet.
The queued native rate change after frame 32 changes 66 to 33 ms. Supplying
66 ms unconditionally, or reading the period before processing that command,
incorrectly requested two ticks. No native clock packet is discarded.

The existing native mode-7 packet/AI-local decoder path is retained unchanged.
The world synchronization send now runs outside that bracket without failing.
The only newly handled runtime output is unconditional broadcast debug logging
at `0x46c996`, return sites **`0x43af42/0x43af68`**. Its arguments are recorded;
all other diagnostics remain fatal. Existing external audio output, clock and
allocation boundaries remain explicit. No AI, task, projectile or relation
function is stubbed to return success.

| Mission | Completed / attempted world frames | Next original boundary |
| --- | --- | --- |
| HUMAN02 | 55 / 56 | Slot 172, type 25, owner 9, task 6; source tile `(42,67)`, destination `(47,69)` |
| ALIEN02 | 36 / 37 | Slot 198, type 25, owner 9, task 6; source tile `(4,52)`, destination `(2,56)` |

Both stop at **`0x414f8f`**, diagnostic call `0x414faa`, return address
**`0x414faf`**, assertion **`state->map->path.paths[ys][xs].family`**,
**`ticker.c:1695`**. Family is **0 both in the current cell and the pinned
source PTH**. The type-25 owner-9 actors first appear through native world
execution at frame 8, not harness actor injection. The missing precondition
is the original placement/navigation lifecycle that permits these actors to
reach task 6 with a valid origin family. The specific omitted initializer or
earlier transition responsible has **not been established**; do not relabel
this as an original-game bug, patch PTH bytes or force a task result.

`nativeAudit` records every complete-world return, full entity hash, actual TRO
scan entries, native RNG calls, HP dword `entity+0x0c` and status changes,
relation cache bytes, visibility masks, projectile construction/reclamation
and reload entries. Source family and complete offending actor/cell bytes are
included at the assertion. At these bounds:

- HUMAN: **185** policy RNG calls, last complete cursor **196**, **75** packet
  submissions, **55** projectile-updater calls. Each of `0x4456f0`,
  `0x44a6d4`, `0x439f40` executes **4** times.
- ALIEN: **52** policy RNG calls, last complete cursor **147**, **38** packet
  submissions, **36** projectile-updater calls. Each other service executes
  **3** times. Both source clocks advance exactly one per completed frame;
  alliance caches and own-team visibility masks remain stable.
- **Zero** CRT RNG calls, projectile constructions, projectile reclamations
  or reload calls occur before these stops. Thus there is **no fire-rate or
  pool-reuse evidence on the contiguous path yet**, despite the updater
  running. Earlier limited replay combat evidence is not promoted to this path.

This closes the former session gateway, not the new navigation boundary or
the entire source initializer. `--session-transport` isolates the executable
constructor/ready proof. The bounded world still stops on its first real
missing precondition, with maximums **14096 / 1136** unchanged.

The corrected limited HUMAN replay exposes a separate consequence of skipping
world services: `0x4415d0` advances `game+0x7d24` to **2024**, with candidate
index **2023** in ESI. Comparison `0x4415fb`, branch `0x441600`, then diagnostic
call `0x44161a` (return address `0x44161f`) stop at `0x46c996` on update 2901.
The limited loop never runs `0x44293c`, so it cannot establish projectile
reclamation, damage/loss history or HUMAN activation. This invalidates the
older 14096 checkpoint under the corrected initialization; it is not an
asserted bug in the original game.

`admitted` and `acceptance.completeWorldHistory` stay **false** for every
path. There is no certified evolving world through either target activation,
and no additional TypeScript consumer or mode-3 admission is justified.

### Focused Verification

The focused AI file retains callback and packet goldens, original TRO
compilation, source bank binding, the limited HUMAN projectile diagnostic,
ALIEN four-group/seven-actor conditional evidence, both source relation tables
and all 16 adversarial controls. Only the obsolete first-tick null-transport
assertion is replaced: the new golden requires the original constructor,
ready packet, complete-world hashes/counts, RNG/services and exact retained
source-path blocker. No full suite, agents, browser or window is used.

Final verification for this continuation: **12/12 passed, zero skipped**, exit
0, in `/tmp/dc-ai-session-focused-tests-20260919-r2.log`. The isolated gateway
check also passed in `/tmp/dc-ai-session-gateway-tests-20260919-r1.log`.
Two final captures, `/tmp/dc-ai-session-final-world-20260919-r3.jsonl` and
`/tmp/dc-ai-session-final-world-20260919-r4.jsonl`, are **byte-identical**:
SHA-256 `2a1526a3df94aaed34246bb6e4a59c3fdac8769edbe77d336d406d566f44adc7`.
`/tmp/dc-ai-session-repeatability-20260919-r3.log` records the comparison and
exit 0. These local artifacts are reproducible with the commands below;
interrupted attempts and pre-final HP instrumentation are not final evidence.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
    python3 -B tools/research/ai-policy-20260919.py --activation-scan
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
    python3 -B tools/research/ai-policy-20260919.py --world-service-boundary
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
   python3 -B tools/research/ai-policy-20260919.py --session-transport
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
   python3 -B tools/research/ai-policy-20260919.py --world-activation-scan
node --import tsx --test tools/qa/legacy-ai.test.ts
```

Previous verification: `/tmp/dc-ai-relations-final-tests-20260919-r7.log` records
12 passing tests for the prior boundary. Native intermediate evidence includes
`/tmp/dc-ai-relations-verify-20260919-r3.log`,
`/tmp/dc-ai-world-contiguous-20260919-r2.log`, and
`/tmp/dc-ai-relations-bounded-native-20260919-r6.jsonl`.
Earlier terminal-shared runs were interrupted and are not passing evidence;
the final test worker used its own process group, with no browser or agents.
Historical TS decision goldens remain separate from activation history.

## New Callback Closure

`consumeLegacyAiGroupPrelude(policyBytes, entityBytes, group)` is an actual
in-place consumer of native state, not a callback placeholder. It implements
the first **two** callbacks of one group, in their original order. Inputs must
be the complete `0x6c40`-byte policy and `800*220`-byte entity buffer, with valid
initialized lists and recognized callback pointers. The result names the next
callback still required; it is **not** a completed AI tick or an admission token.

| Native field | Exact semantics |
| --- | --- |
| `policy + group*0x12fc + 0x1e8c` | Unsigned accumulator bits; groups 0..2 reset to zero at `0x4578a0`. |
| Same accumulator, group 3 | `0x459f24` counts the list via `0x459ec0` **before cleanup**. Empty adds 1000 modulo `2^32`; nonempty adds `idiv(0,count)=0`. The source numerator table at `0x4563e0` is `[40,30,20,0]`. |
| `policy + group*0x12fc + bucket*300 + 0x1e95` | Nonzero enables a bucket for groups 1/2; `0x44bbec` visits buckets 0..15 ascending. Groups 0/3 always visit bucket 0 through `0x44bbdc`, regardless of this byte. |
| Same bucket `+0x1faa/+0x1fac` | Signed 16-bit list head/tail; `-1` is empty. |
| `entity +0xd2/+0xd4` | Signed next/previous links, not interchangeable. `-1` terminates; `-2` denotes unassigned/removed. |
| `entity +0x2c` | State 0 causes the native diagnostic; state 10 is removed; other states remain. No type, owner, health, or visibility filter is invented. |

Native unlink `0x44b928` updates the next member's previous link or the tail,
then the previous member's next link or the head, then sets both removed links
to `-2`. It does **not** decrement a guessed count or clear the entity's other
fields. The TS consumer validates all selected lists before writes, rejecting
cycles, out-of-range slots, inconsistent backlinks/tails, state 0, unexpected
callback pointers and overlapping buffers. This atomic failure is a host safety
contract, not a claim about native recovery after an assertion failure.

Twenty-four native cases cover all four callback pairs, empty/single/multiple
lists, head/interior/tail removal, consecutive removals, buckets 0/3/15 and
accumulator overflow. Tests compare SHA-256 of **every policy and entity byte**
against native execution, so unrelated writes are detected. Both callbacks
consume no RNG. The host must interleave these with each group's remaining
decision/order callbacks, not run all four preludes ahead of the decisions.

`consumeLegacyAiInactiveSelector(mode, rngCursor)` supports only the established
inactive cases: mode 0 skips without a draw; mode 4 emits no action but returns
the cursor advanced once modulo 256. The host must commit that global cursor.
Mode 3 returns `kind: "blocked"` without consuming a tick or changing RNG;
its required action is `0x44be40`, never silently unused. Other modes throw.

The native scheduler was executed for **all 256 cursor values in both modes 3
and 4**. Mode 4 still calls the RNG despite weight zero. `0x411db4` increments
`0x479204` first, then reads `table[(oldCursor+1)&255]` at `0x478e04`. Mode 3
always selects its weight-1 action, but the draw must not be optimized away.
No generalized JS weighted selector or altered x87 comparison is introduced.

## Source-Only Native Orders

`--source-continuation` now executes original SCN constructors **inside the same
map fixture**, including all source rows and their real slot allocation, rather
than copying entities from a separate empty-map probe. It runs the city scanner
on all eight teams' actual nine-row sections, native type/weapon scalar
initialization, native MBULLET percentage-to-Q8 conversion, own-team observation
mask initialization, original PTH graph construction, MAP attribute bits, MTG
air-plane tags and constructor occupancy writes. Additional inputs are hash-pinned.

The missing damage table at `0x4f98d0` previously faulted group 2 at `0x45877c`.
Loading original WEAPSTAT/MBULLET closes that native dependency: its weapon index
comes from type `+0x18`, weapon records are `0x4f0200 + id*72`, and damage-matrix
row pointers come from `0x4f98d0`. No substitute score is returned.

| Source-only snapshot | Actual native progression | First actor-bearing packet |
| --- | --- | --- |
| HUMAN02 team 2 | Assignment `0x457568`, observation `0x456ad0`, demand `0x457940`, rule scanner `0x4578d0`, all four groups; type-8 slots 156..165 linked natively | `110007010100003b0015a50005a5000700`: slot 165, destination Q8 `(15104,5376)` / tile `(59,21)`, mode 7 |
| ALIEN02 team 1 | Same assignment/observation/demand/rule stages, then group 1's order boundary; original type-86 slot 161 | `11000701010000010049a10005a1000700`: slot 161, destination Q8 `(256,18688)` / tile `(1,73)`, mode 7 |

HUMAN02 first emits **three zero-unit packets**, each
`0b00070100000034003e00`. They are retained in the trace, not called unit orders.
For those only, the probe jumps to the original transport epilogue; it stops at
`0x421725` on the first actor-bearing packet. Neither packet submission nor
feedback is simulated. ALIEN02 stops before groups 2/3 because it emits earlier.

These are conditional **source-initialization goldens**, not real activation
goldens. The fixture does not reconstruct preceding ticks, production dependency
tables, constructed colony entities/footprints, evolving queues/funds, alliance
visibility propagation, or sight history. The native rules execute against that
incomplete state; this proves the path ran, **not** production-rule fidelity.
Native constructor links are preserved; actors are not replaced with idle units
or an invented extractor. Actual conditions were not forced true in a trigger scan.

## Exact Activation Boundary

`--activation-boundary` compiles **every original byte**, block, action and native
predecessor link: HUMAN02 20 blocks/42 actions, ALIEN02 12 blocks/25 actions.
It then directly invokes the unchanged activation action chain on the source
snapshot. This isolates the dependency; it does not execute earlier triggers or
claim that activation conditions became true.

| Mission | Condition and native action order | Verified stop |
| --- | --- | --- |
| HUMAN02 block 17 | `((c>880)&&(s(0,10)==0))`; `ai 2 3`, then `reinforce 2 47 6 8 10 10 7 0 0 0 0 0 0` | AI becomes 3, then real `0x418f4c` carrier constructor: team 2, tile `(47,6)`, types `[8,10,0,0,0]`, counts `[10,7,0,0,0]`. No synchronous creation of those 17 units is assumed. |
| ALIEN02 block 0 | `(c>70)`; `abduct 1 1`, then `reinforce 1 11 54 0 2 0 0 0 0 0 0 0 0`, then `ai 1 3` | Stop at abduction handler `0x43e1b1` before reading a manufactured commander. Required signed commander slot is `game+0x1934+1*0xe30 = game+0x2764`. Selector remains 4. |

ALIEN02's commander comes from earlier block 1's exact
`reinforce2 1 30 27 69 1 0 0 0 0 0 0 0 0`, not from a SCN row. The same block's
messages, waypoints and player reinforcement cannot be deleted to make that
history pass. Its full native compilation also preserves block 8's omitted lives
as **zero**, not an invented active trigger.

**Necessary host, still missing for a complete active tick:** replay the complete
trigger stream and updates to the actual activation instant, including commander
slot/removal state, pooled carrier reservations and task-21 delivery, global RNG
cursor, ground occupancy and visibility history. Then provide the persistent
`game+team*0xe30+0xbc0` policy, entity assignment/task bytes, initialized production
dependency table `0x4e6d70`, funds `+0xbac`, city work at `+0xca8/+0xcb0`, and native
order enqueue/consume feedback. The consumers close accumulator, cleanup and
shared group-1/2 order decisions only. Neither mission, mode 3, nor "all phases"
is accepted.

## Minimal Verified Contract

1. The actual `ai` handler at `0x43d840` changes the team's selector, not its
   orders or policy allocation. The probe executes that handler with the already
   established literal action-record layout, then calls the future consumer.
2. `0x41ab20` selects descriptor `0x47b328`, whose task list at `0x47b318` is
   exactly `(weight=0x44bc5c, action=0x44be40), (0,0)`. The weight returns **1**,
   without inspecting entities, sight, enemies, or difficulty. Mode 4 selects
   `(0x44d6e0,0x44d6e8)`; its zero weight prevents its empty action from running.
3. `0x41abca` calls the weight; `0x41ac21` calls the selected action. The
   scheduler tests `weight > random * (totalWeight + weight) / 32767` using x87.
   `0x411db4` advances the cursor at `0x479204` modulo 256 and reads the table at
   `0x478e04`. All shipped values are in **668..32434**, so the sole weight-1
   task wins for every shipped table entry. This is not a random attack selector.
4. Action `0x44be40` reads `game + team*0xe30 + 0xbc0`. A null pointer invokes
   `0x44bd2c`, allocating **0x6c40** bytes and storing that pointer persistently.
   It does not rebuild policy state on every tick or on every `ai` assignment.
5. The action performs first-use assignment `0x457568` if policy byte `+0` is
   nonzero, clears that byte, refreshes observations through `0x456ad0`, then
   calls `0x457940` for assignment/demand/rule processing. It subsequently visits
   groups **0,1,2,3**, invoking offsets **+0x3168, +0x3174, +0x316c, +0x3170**
   in that order, with group stride **0x12fc**. The group-0 final callback can
   produce the resource-coordinate packet proven below.

The outer gate `0x41ac2c` checks `game+0x94c & 3`. When that field equals 4 it
visits all eight nonzero selectors; otherwise the eligible path advances the
cursor in `*(game+0xb94)+4` and considers one team. This is a code-path finding,
not an established wall-clock tick frequency.

**Integration implication:** storing mode 3 without running its consumer is
insufficient. Replacing it with a generic "aggressive" or sight-radius algorithm
is also unsupported. The bounded resource callback alone is not the whole policy.

## Actual Policy Tables

The probe runs the real initializer, rather than installing substitute callbacks.
Columns are policy-relative offsets plus `group*0x12fc`:

| Group | +3168 | +316c | +3170 | +3174 | +3178 | +317c |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 4578a0 | 44b920 | 4598b0 | 44bbdc | 459d98 | 459e40 |
| 1 | 4578a0 | 4593a8 | 463e78 | 44bbec | 44b6a4 | 459660 |
| 2 | 4578a0 | 458b44 | 463e78 | 44bbec | 44b6a4 | 458f3c |
| 3 | 459f24 | 44b920 | 459f80 | 44bbdc | 44b6a4 | 45a724 |

Initializers: group 0 `0x459e48`, group 1 `0x459860`, group 2 `0x45913c`,
group 3 `0x45a72c`. Policy dwords `+0x6c14..+0x6c30` are
`192,1,1,2,4,2,4,2`; owner-indexed byte `+0x6c38+team` is set to 1.

`0x45687c` copies 18 twelve-byte rules from **0x48903c** to policy **+0x6a94**.
`0x4578d0` scans these in order, invoking the paired action of the first predicate
that returns zero. These are not the outer scheduler's weights. Exact rule triples:

```text
predicate action parameter
4564c8 456550 8
45642c 456448 1
4564c8 456550 0
456664 4566ac 5
4564c8 456550 1
4564c8 456550 3
456664 4566ac 10
45642c 456448 2
456664 4566ac 15
4564c8 456550 4
4564c8 456550 2
456664 4566ac 20
4564c8 456550 7
4564c8 456550 6
456664 4566ac 30
4564c8 456550 5
456664 4566ac 200
456868 456874 0
```

All callback values and the complete copied rule bytes are asserted. The
resource-only fixtures below do not execute these rules; the source-continuation
probe above records executed predicates/actions but lacks the production host.
Their parameters must not be relabeled as attack ranges or invented priorities.

## Source City And Path Initialization

Native `0x4571ac` first uses team fields `+0xbc4/+0xbc8`; if either is zero it
falls back to `+0xbcc/+0xbd0`. The original SCN rows give the activated teams:

| Mission / team | First coordinate row (fallback) | Second row | Initial selector |
| --- | --- | --- | --- |
| HUMAN02 / 2 | 56,61 | 0,0 | 4 |
| ALIEN02 / 1 | 7,70 | 0,0 | 4 |

These fields follow [the native SCN order](scenario-team-fields.md); comments
are trailing labels. `0x41b4a0` resolves an eligible nearby cell using nonzero
PTH family and ground occupancy low ten bits equal to `0x3ff`. Thus occupied
city coordinates can change the anchor even when the SCN is unchanged.

The probe supplies actual MAP dimensions and every original PTH byte. It marshals
PTH cell families into native 24-byte cells at `map+0x1404`, copies the 65536-byte
next-family table to `map+0x884a8`, and executes the original distinct-next-hop
list builder `0x442e2b..0x442e41` (`ESI=map+0x1404`, `EDI=1`). It then enters
the real scheduler/action/initializer, replacing only allocator `0x40bcc0` with
an asserted-size zeroed allocation, and stops at first assignment `0x457568`.

`0x4571ac` computes region ranks through the next-hop graph and representative
cells from region coordinate averages plus a native search. Region-relative
state uses stride 18: coordinates at `policy+18*family+2/+3`, rank byte at `+13`.
This rank is city-derived, not Euclidean distance from the acting unit.

Ground cells are deliberately initialized to empty `0x3ff` in these fixtures.
This is **not** the fully populated mission collision grid. See
[navigation-decoding.md](navigation-decoding.md) for the separate native grids.

## Conditional Objective And Order

The whole native group-0 callback **0x4598b0** executes, including its real route
predicate **0x45817c** and packet builder **0x40c414**. One synthetic idle extractor
is linked at `policy+0x1faa`, slot **200**, at the SCN fallback coordinate, with
type 14 for HUMAN02/team 2 or type 6 for ALIEN02/team 1. Entity `+0xd2=-1`
terminates its linked list. Original resource rows are marshalled into slots
300 onward in source order; their positions, type 40, owner 8, live state 1,
and rate word follow [the established resource layout](resource-runtime-20260919.md).
No reserve or income behavior is needed or claimed here.

For the idle/unassigned case, the native predicate chain is:

- Traverse group members through signed entity `+0xd2`; select the **last**
  member whose objective byte `+0x11` is zero. Collect assigned region bytes
  from all group members to exclude duplicate region objectives.
- Scan all 800 entity slots ascending. Require type **40**, nonzero rate word
  **+0x32**, state **+0x2c not 0 or 10**, and tile ground low ten bits **0x3ff**.
- Read its family from the actual path cell. Exclude already-assigned families.
  Require its unsigned city-rank byte to be strictly less than the current best
  (initially 256). Equal ranks retain the earlier entity slot.
- Require `0x45817c(game, policy, actorFamily, candidateFamily, owner, 0) == 0`.
  Missing source family/route returns **-1**. Otherwise the native function
  assembles region masks from next-hop links and derived lists, then sums
  region word `+10` where signed owner byte `+8` is neither -1 nor the owner.
  This is not merely reachability, alliance checking, or a visibility-radius test.
- Store the chosen family in actor `+0x11`. Submit one unit and one coordinate
  pair to `0x40c414`, with per-unit command byte **2**. Target coordinates are
  the resource's fixed-point words, not its region representative coordinates.

The callback's earlier maintenance branch for type 6/14 can redirect a previously
assigned extractor to a region representative or clear its objective; it also
updates stationary counter `+0xcf`. The fixture starts unassigned, so that
assigned-objective maintenance behavior is **not** covered by the goldens.

### Packet Goldens

Observed immediately after `0x421648` writes the length header, at `0x421725`:

| Fixture | Chosen tile | Family / city rank | Exact packet hex |
| --- | --- | --- | --- |
| HUMAN02 baseline | 69,48 | 70 / 6 | `11000701010080458030c80005c8000200` |
| HUMAN02 preferred occupied | 53,27 | 160 / 11 | `1100070101008035801bc80005c8000200` |
| ALIEN02 baseline | 4,80 | 226 / 4 | `11000701010080048050c80005c8000200` |
| ALIEN02 preferred occupied | 65,54 | 80 / 21 | `11000701010080418036c80005c8000200` |

The 17 bytes contain length `11 00`, command `07`, one coordinate pair, unit
count `01 00`, two little-endian fixed-point coordinates, slot `c8 00`, command
`05`, slot `c8 00`, mode `02`, and terminator `00`. These are **pre-transport**
packets: sequence stamping, queue submission, command consumption, movement,
deployment, and income are not executed. The capture hook returns through the
native transport epilogue, not through a fake successful unit-order executor.

Each mission additionally rejects all candidates for six independent controls:
all rates zero, dead state 0, rotting state 10, occupied target cells, positive
route-region score, and missing route. Route-score controls execute the real
predicate and assert positive returns; missing-route controls assert `0xffffffff`.
The baseline has zero region scores, not observations reconstructed from a live
mission. Original zero-rate sites are retained, not filtered from source input.

## Exact Remaining Dependencies

**A faithful mission-2 tick objective plus executed order remains unproven.**
The sources contain no explicit type-6/14 unit row for these activated teams;
the synthetic extractor is a conditional policy test, not evidence that the
mission creates one at activation. Required closure:

1. **Activation-time world and entity lifecycle.** Establish actual slots,
   counterpart conversion, tasks and linked-list sentinels from scenario loading,
   reinforcement/abduction and preceding ticks. `0x457568` scans slots 120..799,
   filters owner and live state, requires signed entity `+0xd2 == -2` for
   unassigned units, maps types through `0x4563f0`, and links through `0x44bc68`.
   Seeding every unit as idle/unassigned would manufacture the policy's inputs.
2. **Observation/region state.** Run or reproduce `0x456ad0` using the real
   populated map, team masks at `game+team*0xe30+0x19c0`, entity `+0xca`, and
   initialized 280-byte type definitions at `0x4f1880` (including `+0x68`).
   It scans live entities and maintains the `policy+0x1202` observation cache
   and 18-byte region records. Zero scores are only this fixture's control.
3. **Group demand and production rules.** Close `0x457940`, its call back into
   assignment, callbacks `+0x3178`, city queues at team `+0xca8/+0xcb0`, rule
   scanner `0x4578d0`, and the native rule pairs above. This needs live city
   availability, counts, funding and queued work, not just two SCN coordinates.
4. **Other group decisions.** Group 2's `0x458b44` plus shared `0x463e78` is now
   consumed through the packet boundary, including both recorded natural
   invocations. Group 1 remains bounded: retarget/release/create branches are
   not implemented. Group 0 still needs complete resource assignment/order
   maintenance; group 3's `0x459f80` objective/order logic is unowned. Existing
   accumulator/cleanup consumers do not substitute for those decisions.
5. **Order feedback.** After packet construction, `0x421725` selects replay
   handling or sequence stamping and virtual transport call `0x421764`
   (`[vtable+0x5c]`). Prove enqueue/consume timing and the entity-task effect of
   command 7 plus command 5/modes 2 and 7 against real path/occupancy state. Captured
   bytes alone do not certify movement or a subsequent AI tick.

The bounded consumers above export verified accumulator/list and shared group
order semantics. They do not fill missing inputs with defaults or implement a
complete policy. Neither mission is admitted by this research.

## Provenance And Reproduction

Pinned [DC.EXE](../raw_cd/DC/DC.EXE) SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The probe rejects changed executable/source bytes. Source hashes, in SCN/MAP/PTH
order, are asserted as follows:

```text
HUMAN02
bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab
ea7377f73ad1d02974d8b2c04d929d3805f591a12b870254a8d466b65685f3c5
623c4e65f710527bc27f02f99644eb13828a3f4aaf533a1fd4f4accc8d3ba2df
ALIEN02
d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e
d5ab938493b41614ef12f2640b152970e5aad8668a15e4709d6db3df80c18bae
1e6633ca04693915fb2187d06fa16f4a52c973c5eb6617e73afd7797a0850155
```

With existing Capstone 5 / Unicorn 2 installations, from the repository root:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/research/ai-policy-20260919.py
```

The default probe retains two action-to-consumer checks and 16 resource fixtures.
Additional focused reproduction:

```sh
node --import tsx --test tools/qa/legacy-ai.test.ts
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
   python3 -B tools/research/ai-policy-20260919.py --source-continuation
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
   python3 -B tools/research/ai-policy-20260919.py --activation-boundary
```

Prior prelude-only result: **7 tests passed**, including 24 complete-buffer native callback
goldens, 512 scheduler invocations, malformed-state guards, two source-order
traces and two activation-boundary traces. `--callback-goldens` emits JSON for
independent comparison; optional `DC_AI_NATIVE_TRACE` supplies that callback
trace only, while source/activation tests still execute native probes. The
current ten-test result and added decision/early-scan goldens are recorded above.

Additional source SHA-256 pins:

```text
GAMESTAT.TXT ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629
WEAPSTAT.TXT 391e5603108b73cff4a5d2135ae751a0c8aebb934e6f3d6e5e09c5e807e520d0
MBULLET.TXT 2244665ec4fc4f344b4ad32ec47e209c79a1a240d48f8f43a6035ceab0ae1d22
Both mission-2 MTGs 615e95f568d1c83d750f63255b12de32db470a45017f4fe5fa02ed1336f0cc49
HUMAN02.TRO 0e5a6593768b4fff717be69609d8ed5eb2aea48d1bab68c30c8d5d621d7e080d
ALIEN02.TRO b219fa5bf2b13ba122271295679d488bb70077556dae20dfa76b00aa9968f50e
```
The two intentional service boundaries are allocation and pre-transport capture;
policy, graph initialization, predicates and packet serialization execute original
x86. SCN/PTH marshalling is explicit fixture construction, not a full native load.
`--disassemble ADDRESS LENGTH` exposes hash-pinned instruction evidence locally.