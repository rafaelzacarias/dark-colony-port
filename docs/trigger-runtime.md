# Verified TRO Runtime Subset

Audited on 2026-09-18 against the local DC.EXE and HUMAN01/ALIEN01 TRO,
SCN, and briefing TXT files. This is **not a complete mission implementation**.
The existing initial `c>0` reinforcement expansion remains unchanged and is
not validated by this work. Only the owned trigger runtime, its tests, the
audit probe, and this document were changed; no view or simulation integration
was changed.

## Deep-Trace Result: Ready Primitives, Missions Still Blocked

**READY TO INTEGRATE the three standalone primitives documented below.**
**NOT READY to enable either complete mission.**

The previous audit reversed the first two `s` arguments. The original parser
and VM, executed under Unicorn, prove **`s(team, selector[, type])`**:

| Source | Original parser bytecode | Actual table entry |
| --- | --- | --- |
| `s(4,3)` | `07 0400 07 0300 10` | Aggregate selector 3, team 4: victim losses. |
| `s(1,0,82)` | `07 0100 07 0000 07 5200 11` | Per-type selector 0, team 1, type 82: victim losses. |
| `s(0,1,82)` | `07 0000 07 0100 07 5200 11` | Per-type selector 1, team 0, type 82: registered census. |

Therefore HUMAN01 does **not** need an aggregate-selector-4 producer, and
ALIEN01 does **not** require type-82 ownership conversion. These were false
blockers caused by argument reversal, not missing mechanics. This is not a
generic "kills" substitution: victim loss and attacker kill credit are
different original counters. Do not feed attacker kills into either predicate.

The runtime now validates team first and selector second. Statistic keys
remain in literal TRO source order. `bail` writes its reason to `"7,0"`,
not the previously documented `"0,7"`.

## Evidence and Reproduction

DC.EXE SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Addresses below are x86-32 virtual addresses. As established in
[terrain-decoding.md](terrain-decoding.md), code uses `fileOffset = VA - 0x400c00`
and DGROUP uses `fileOffset = VA - 0x402400`. The probe reads PE sections
directly, handles their zero virtual sizes, and excludes uninitialized BSS.
Its disassembly is static evidence. The optional Unicorn probes execute
original x86 fragments against controlled memory, not a running original game.

From the repository root, using the already installed Capstone 5 environment:

```sh
export PYTHONPATH=/private/tmp/dc-re-capstone-20260918
python3 tools/research/trigger-audit.py verify
python3 tools/research/trigger-audit.py imports
python3 tools/research/trigger-audit.py disasm 0x43e4d0 0x43e578
python3 tools/research/trigger-audit.py disasm 0x43d814 0x43d9d0
python3 tools/research/trigger-audit.py disasm 0x43d0c5 0x43d289
python3 tools/research/trigger-audit.py disasm 0x4196f4 0x4197b4
python3 tools/research/trigger-audit.py disasm 0x43e0fe 0x43e349
python3 tools/research/trigger-audit.py mission-evidence
node --import tsx --test tools/qa/trigger-runtime.test.ts

# Optional isolated execution dependency, not an application dependency:
python3 -m pip install --target /private/tmp/dc-trigger-unicorn-20260918 unicorn
export PYTHONPATH="$PYTHONPATH:/private/tmp/dc-trigger-unicorn-20260918"
python3 tools/research/trigger-audit.py stat-probe
python3 tools/research/trigger-audit.py primitive-probe
```

`verify` checks 42 instruction byte anchors, fails on any mismatch, and prints
six source fingerprints. The executable hash is enforced for every command.
On another machine install Capstone 5 into a separate Python environment;
it is a research dependency, not an application dependency.
`refs` prints instruction matches plus raw address occurrences; raw hits are
candidates, not proof of a code reference. Start `disasm` at a known instruction
boundary; embedded jump tables must be read with `words`, not interpreted as code.

`stat-probe` runs parser `0x43c96c`, then the original expression VM at
`0x43cf53`, with distinct table sentinels. The results are 5300 for `s(4,3)`,
2082 for `s(1,0,82)`, and 1182 for `s(0,1,82)`. It does not pre-seed operands
in an assumed argument order. `primitive-probe` executes the complete
`newtype` handler to its next-action boundary and the two original victim-loss
counter updates. It verifies inactive-slot selection, slot 799, no match, and
unchanged team/other entity bytes. This does not emulate complete combat,
removal, reinforcement, rendering, or transport.

| Source | SHA-256 |
| --- | --- |
| HUMAN01.TRO | `f7fb1c67d68eaa4207ec5053ad7289608f43ca6d631a9d0d45ff3f260011a1a0` |
| HUMAN01.SCN | `af82c538181ca182481562dfa75ff1f39038a58445b019cd6a52426b33e968e7` |
| HUMAN01.TXT | `8d79b46ecf33a039b774542bb710c2536a2500907832d9f4231d6b46b111dcae` |
| ALIEN01.TRO | `dca0ca87c01f1e0fae8688f81b6707e11aa5b432576b04f7e4e2b56bd1bb76e0` |
| ALIEN01.SCN | `3a971792a6661c6595ea22a5fa071abe12d03392ab3d8ec40c212328c1298b1e` |
| ALIEN01.TXT | `e05dd7cbe6795aac568c351724fd12e9725d70a3268a3e8b4f1e436b5e8a26be` |

## Dispatch and Lives

Trigger records have stride 16, beginning at `0x4fbc48`:
mode at +0, condition pointer at +4, lives byte at +8, action pointer at +12.

| Evidence | Verified behavior |
| --- | --- |
| `0x43e73e`, `0x43e773` | `norm` stores mode 0; `trip` stores mode 1. |
| `0x43e800` to `0x43e878` | Header flag is parsed as a nonnegative number, then stored as a byte: remaining lives, not a Boolean. |
| `0x43e4d0` to `0x43e529` | Normal pass scans IDs 0 through 127 in increasing order, ignores zero lives and non-normal modes, evaluates condition, runs actions when nonzero, then decrements lives. |
| `0x43e530` to `0x43e572` | Trip pass evaluates only the supplied ID, requires mode 1 and nonzero lives, and decrements after actions. |
| `0x43d9aa` to `0x43d9c2` | `setlifes id expression` evaluates an expression and writes its low byte into that same lives field. |
| `0x415e45` to `0x415e6e` | Spatial caller extracts a nonzero trip ID from the upper six bits of a word in the map object's +0xc04 row plane and passes the moving entity slot as context. |

`trip` is **not** a rising-edge detector for a globally polled condition.
Repeated spatial calls can consume multiple lives. A zero-life trigger can
be rearmed. A self-`setlifes 1 0` followed by the normal post-action decrement
wraps to 255; the interpreter preserves this byte behavior.
The source-to-runtime mapping and local movement ordering are verified below.
The browser scheduler still needs an adapter. Do not synthesize trip events
from `(S==0)` alone.

### MTG to Original Movement

The loader reads width and height bytes, then row-major tag bytes. At
`0x45391f` it shifts each tag left ten and stores the low word. At `0x453995`
through `0x4539a5`, source `(x,y)` maps to runtime `(x,height-1-y)` in the
`+0xc04` row plane. Effective trigger ID is `tag & 63`; ID zero means no call.
Ground and flying occupancy reservations preserve those upper tag bits.

The movement path obtains the next destination from a packed direction
(`0x415c38` through `0x415c82`), checks the appropriate collision grid, and
reserves the destination (`0x415df5`/`0x415e0a` for flying,
`0x415e28` through `0x415e43` for ground). **Only then** it reads the
destination tag and invokes trip dispatch (`0x415e60` through `0x415e6e`).
The path cursor changes at `0x415e8b`/`0x415e92`; the subsequent movement
call is at `0x415ebc`. Thus this is a **successful next-cell reservation**
hook, before the subsequent movement call, not a current-position poll or
physical-arrival callback. An occupied-cell branch bypasses this local
dispatch path. No region-entry edge tracking is present.

Both mission MTGs are 96 by 84, 8066 bytes including the two-byte header.
`mission-evidence` reproduces these runtime-space bounds and cell counts:

| Mission | Trip ID | Tagged cells | Inclusive runtime bounds `(minX,minY,maxX,maxY)` |
| --- | --- | --- | --- |
| HUMAN01 | 1 | 24 | `(53,14,56,19)` |
| HUMAN01 | 2 | 13 | `(42,63,42,75)` |
| HUMAN01 | 7 | 12 | `(25,57,28,60)` |
| HUMAN01 | 11 | 13 | `(45,8,48,17)` |
| ALIEN01 | 4 | 16 | `(26,61,29,64)` |
| ALIEN01 | 6 | 13 | `(31,32,38,37)` |
| ALIEN01 | 8 | 16 | `(69,48,72,51)` |
| ALIEN01 | 9 | 27 | `(13,47,30,56)` |

Bounds are not masks. HUMAN01 tag 7 is a ring: its center `(26..27,58..59)`
is untagged, including beacon tile `(26,59)`; `(25,59)` is tagged. ALIEN01
defines trip 7 but its source MTG has no tag-7 cells. Do not invent that region.
HUMAN01 MTG SHA-256 is
`8d88fb9419b1d10448eef67e08b430409b917a2d85aee6a21e6b1b825981a55c`;
ALIEN01 is `6d79d94cb5608eb8b96dbac7ce27f346621eb0a378a339c66e95ae14002ea07d`.

### Action Order

Actions execute in **reverse source order**. Parsing initializes the list to
null at `0x43e67b`; each new action stores the previous head in +0x18
(for example `0x43fa0c`), and `0x43fb7d` stores the last action as the trigger's
head. Execution follows +0x18 at `0x43e4be`. There is no final list reversal.
Thus HUMAN01 trigger 7 executes `setlifes 4 1` before its other actions.
`bail` neither stops its action list nor terminates the normal scan immediately.

## Conditions

The expression VM uses a signed 16-bit stack. Numeric literals, fetched
statistics, and `c` are truncated to words; comparisons are signed. `&&` and
`||` compile to eager bitwise AND/OR, not JavaScript short-circuit operators.
Their parser level is shared and right-associative (`0x43c638`); the actual
mission comparisons yield 0/1, but `2&&1` yields 0.

| Operand | Computation and evidence |
| --- | --- |
| `c` | Opcode 8 at `0x43cbbf`; `i16(i32(game+0x52c) >> 4)` at `0x43d570`. Counter initialized to zero at `0x41bca9`, incremented once in the update at `0x4198ac`/`0x4198bd`. Normal scan called at `0x419aaa`. No wall-clock conversion inferred. |
| `S` | Opcode 1 at `0x43cbb2`; reads triggering entity byte +7 at `0x43d1e0`, using entity base `game+0x7d28`, stride 220. This is the same team field used in statistic updates. Normal evaluation passes entity slot -1 and this operand asserts if used there. |
| `s(team,stat)` | Opcode 16 at `0x43cd32`; `0x43d238` pops the second argument into selector AL, `0x43d242` the first into team EDX, then calls `0x41a538`. Reads `u32(0x4956e0 + 48*team + 4*stat)`, then truncates to signed word. Aggregate selectors 0..11, teams 0..7. |
| `s(team,stat,type)` | Opcode 17 at `0x43cd7a`; `0x43d260` pops type into EBX, selector into AL, team into EDX and calls `0x41a630`. Reads `u32(0x495860 + 1760*team + 16*type + 4*stat)`, then truncates to signed word. Per-type selectors 0..3. |
| `b(team,slot)` | Opcode 14 at `0x43ccae`; `0x43d209` reads low word of `game + 0xe30*team + 0xbd4 + 4*slot`. This is a reserved structure-slot state, not a unit-type census. Removal clears its dword at `0x416392`, indexed by entity-slot quotient/remainder on division by 15. |

`c>0` first holds at counter 16. `c>10` first holds at 176. `c>1200`
first holds at 19216. Signed-word wrap is real; do not use unbounded seconds.

### Statistic Meanings and Limits

The two `s` arities are different namespaces; selector numbers do not have
the same meaning in both tables.

- Per-type selector 0 increments for the victim's team and type on the
  loss/removal path at `0x441b17` to `0x441b40`. Selector 3 is updated on
  the attacking team's path at `0x441acd` to `0x441ae0`.
- Per-type selector 1 is **not kills**. At `0x4196f4` each team's 110 type
  counters is cleared. Entity slots 152..799 are scanned; a slot contributes
  when its signed registry entry at `game+0x468ec+2*slot` is not -1 and its
  team byte is below 8 (`0x419797` to `0x4197b0`). The type byte selects the
  counter incremented at `0x41974f`. Do not substitute a generic HP>0 filter.
- Aggregate selector 3 increments by one for the victim team at `0x441b19`
  through `0x441b29`; per-type selector 0 increments by one for the same
  victim team/type at `0x441b32` through `0x441b40`. These follow the
  nonpositive-remaining-HP branch (`0x441a7d`), removal `0x416308`, and
  collision cleanup `0x434d48`. The removal helper writes status 10 at
  `0x416343`, not a new owner. The helper API exposes only the two counter
  writes, not those removal side effects.
- Aggregate selector 2 is attacker kill credit: the branch at `0x441a85`
  through `0x441aa4` skips it when attacker and victim teams match. The victim
  counters still increment on that path. A team-0 kill tally, a live enemy
  census, or an ownership-transfer event is not the objective input.
- Native setter `0x41a2c0` takes selector in AL, team in EDX, value in EBX;
  native incrementer `0x419d8c` takes the same register order. This native
  calling convention is not TRO source argument order. Aggregate selector 4
  is outside these mission predicates; its wider meaning is not claimed here.
- The actual per-type allocation is `0x3700` bytes (`0x419d76`), matching
  8 teams * 110 types * 4 selectors * 4 bytes. Some helper assertions allow
  type <800 despite that layout. This runtime conservatively supports 0..109.
- `b` is implemented only for mission-used slots 0..4. Other slots are not
  claimed unsupported by the original, only outside this runtime's scope.

## Requested Actions

### bail: Implemented State Changes

Parser assigns opcode 3 at `0x43f9e1`, with two byte arguments. Execution
at `0x43d96c` sets `game+0x471a9=1`, stores `clock+10000` in +0x471ac,
and uses `0x41a2c0` to write:

```text
aggregate statistic [stat=0, team=0] = argument 1
aggregate statistic [stat=0, team=7] = argument 2
```

The timer helper `0x40b030` calls IAT `0x470590`, resolved by the PE import
table to `WINMM!timeGetTime`: uint32 milliseconds. The main loop tests the
pending flag/deadline at `0x4011f1` to `0x401216`; it exits only after the
deadline, using unsigned subtraction with wrap handling. The pure runtime
records the pending result and deadline but does not run a clock or UI exit.
Subsequent `bail` operations can overwrite it during the delay.

Source missions associate first argument 0 with their success branch and 1
with failure branches; second arguments distinguish reasons. Keep the raw
codes: the complete result-screen/campaign transition is not implemented.

### newtype: Ready Primitive, Unsupported World Adapter

Opcode 16, compiled at `0x43f0d1`. Handler `0x43e0fe` to `0x43e189` scans
entity slots 0..799 in slot order. It matches the high bytes of the entity's
unsigned x/y words (+0 and +4) against the first two action bytes. For each
match it tests `u8(0x4f18e0 + 280*oldType) == 0`. On the first eligible
match it writes the third argument to entity byte +6 and stops. It does not
test active status, allocate an entity, change team, or reset HP in this handler.
No eligible match means no write.

The gate is the movement-class byte at definition base `0x4f1880 + 280*type`
offset `0x60`. The same byte at `0x415c9d`/`0x415cdc` selects ground
(`+0x804`) versus flying (`+0xc04`) collision. Zero selects ground.
Do not replace this with active status, HP, ownership, or a generic type filter.

HUMAN01 places type 95 on team 1 at `(54,17)` and `(26,59)`.
GAMESTAT names 95 "DEACTIVATED DROP BECON" and 84 "DROP BECON".
Trip 1 and trip 7, conditioned on moving team 0, invoke the respective
`newtype ... 84`. **Activation changes type 95 to 84, not team 1 to team 0.**
Because actions run backwards, the beacon rewrite is last in each block;
trip 7 rearms normal trigger 4 first, before message/reinforcement/newtype.

`applyTriggerNewtype` reproduces only this byte mutation on a full raw slot
snapshot and supplied raw movement-class bytes. The original-x86 probe confirms
the mutation and lack of ownership/HP/status changes. Rendering a changed type,
supplying the correct type-definition data, and executing the other actions in
the block are still adapter obligations. `stepTriggerRuntime` deliberately
continues to report `newtype` as `unsupported-action` without that world adapter.

### abduct: Partial Trace, Unsupported

Opcode 19, parsed at `0x43ef3b`. Handler `0x43e1b1` to `0x43e344` validates
both arguments as team-range bytes, reads the signed entity-slot word at
`game + 0xe30*arg1 + 0x1934`, and skips when that entity's status byte +0x2c
is 0 or 10. Otherwise it derives tile coordinates from that entity, encodes
its slot into a selection buffer, and calls `0x418f4c` with arg2 as the team
parameter. That same function is used by a reinforcement opcode; its entry
reserves a transport slot from eight team entries (`0x418f75` to `0x418ff2`).

Transport selection payload, entity removal/transfer timing, absence of the
selected entity, and the complete downstream transport state machine are
**not verified**. Neither instant deletion nor a no-op is an acceptable
implementation. Both `abduct 0 0` and `abduct 1 1` remain explicit failures
when their blocks would execute in this runtime.

## Mission Findings

HUMAN01 has IDs `0,1,2,4,5,7,8,9,11`:

- ID 0: normal, one life, `c>1200`, `bail 1 2`.
- IDs 1,2,7,11: trip, one life, triggering team must be 0. ID 7 rearms ID 4.
- ID 4: normal, initially zero lives, `s(4,3)>2`. Reverse action order is
  `bail 0 1`, message, then `abduct 0 0`. Its predicate is not initially armed.
  It counts losses on team 4, not selector 4 on team 3.
- ID 5: normal failure when all five `b(1,slot)` values are zero; result `(1,4)`.
- ID 8: one-time initialization only after `c>0`, with unsupported world actions.
- ID 9: normal failure when any per-type loss counter for team 0 types
  69,70,71,72 equals exactly 1; result `(1,3)`. Do not replace `==1` with `>=1`.

The SCN identifies team 0 as the human player and team 1 as human colony
forces; teams 2..4 are alien forces. The briefing asks for beacon activation,
colony security, and commander survival. Team 4 has exactly three type-8
placements at `(72,53)`, `(74,53)`, `(75,53)`. Their loss updates produce
`"4,3" = 3`; trip 7 must also have armed trigger 4. The counter is cumulative:
if those losses happened earlier, arming can make the next normal pass eligible.

ALIEN01 has IDs `1,2,3,4,6,7,8,9,10`:

- ID 1: normal one-time initialization after `c>0`.
- ID 2: normal failure on `s(0,0,73)==1`, result `(1,2)`.
- ID 3: normal success branch on `s(1,0,82)>10`; reverse order is message,
  `abduct 0 0`, then `bail 0 1`.
- IDs 4,6,7,8,9: one-life trip conditions requiring triggering team 0.
- ID 10: normal, one life, `c>10`, then `abduct 1 1`.

ALIEN01's SCN makes team 0 alien and team 1 human; its placements include
exactly eleven type-82 entities on team 1. The briefing requests destruction
of atmosphere contaminators. The success predicate reads cumulative
**team-1 type-82 losses**. Eleven original loss events satisfy `>10`; there is
no conversion requirement in this predicate. Do not use team-0 kill credit,
team-0 registered type-82 count, or "no human buildings remain" instead.
The unchanged-team original loss probe explains ownership without inventing
a transfer mechanic. No claim is made that other missions lack conversion.

## Exact API

All exports are in [../src/engine/trigger-runtime.ts](../src/engine/trigger-runtime.ts).
The block input structurally accepts the existing extractor's `TriggerBlock`,
including `id`, `mode`, `flag`, `condition`, and `actions`; no extractor import
or dependency on the simulation is added to the runtime.

```ts
auditTriggerSupport(blocks: readonly RuntimeTriggerBlock[]): readonly TriggerDiagnostic[]
createTriggerRuntimeState(blocks: readonly RuntimeTriggerBlock[], statistics: Readonly<Record<string, number>>): TriggerResult<TriggerRuntimeState>
evaluateTriggerCondition(condition: string, statistics: Readonly<Record<string, number>>, inputs: TriggerInputs, triggeringTeam?: number): TriggerResult<number>
stepTriggerRuntime(blocks: readonly RuntimeTriggerBlock[], state: TriggerRuntimeState, inputs: TriggerInputs, event: TriggerEvent): TriggerResult<{ readonly state: TriggerRuntimeState; readonly fired: readonly number[] }>
recordTriggerVictimLoss(statistics: Readonly<Record<string, number>>, victimTeam: number, victimType: number): TriggerResult<Readonly<Record<string, number>>>
applyTriggerNewtype(entityBytes: Uint8Array, typeMovementClasses: Uint8Array, tileX: number, tileY: number, newType: number): TriggerResult<{ readonly entityBytes: Uint8Array; readonly changedSlot: number | null }>
tripForReservedMtgDestination(sourceTags: Uint8Array, width: number, height: number, runtimeX: number, runtimeY: number, team: number): TriggerResult<Extract<TriggerEvent, { kind: "trip" }> | null>
```

- `TriggerInputs`: `{ cycleCounter, clockMilliseconds, buildingSlots }`.
  `cycleCounter` is the raw signed 32-bit update counter, not already shifted.
  `clockMilliseconds` is an injected uint32 timeGetTime-compatible clock.
- Statistic keys use **TRO argument order**: `"4,3"`, `"1,0,82"`, `"0,0,73"`.
  This is **team, selector, optional type**, not native helper argument order.
  Building-slot keys are `"team,slot"`, e.g. `"1,0"`. Missing values are errors,
  never implicit zero. Explicitly zero real, initialized counters.
- `TriggerRuntimeState`: `{ lives, statistics, bail }`. `bail` is null or
  `{ resultCode, reasonCode, deadlineMilliseconds }`. State and inputs are
  not mutated; preserve returned state and apply verified external statistic
  updates to a new statistics object before the next call.
- Events: `{ kind: "normal" }` or `{ kind: "trip", triggerId, team }`.
  Unknown trip IDs are reported, not silently treated as successful work.
- Results: `{ ok: true, value }` or `{ ok: false, diagnostics }`.
  Diagnostic codes: `invalid-input`, `unsupported-condition`,
  `unsupported-action`, `missing-input`. Step diagnostics include the trigger
  ID and, when applicable, zero-based **source** action index.

Supported expression subset: literals 0..65535, `c`, `S`, both `s` arities,
mission `b` slots, parentheses, `==`, `!=`, `<`, `>`, `&&`, `||`.
No `eval`, arithmetic, random variables, unary operators, or guessed symbols.
Supported actions: `bail` with two byte literals, and `setlifes` with a
defined trigger ID plus a byte literal. Original expression-valued `setlifes`
is broader and is intentionally rejected here. Header IDs are restricted to
0..127 and lives to 0..255; parser aliases/truncation outside these bounds
are not emulated. Expression length/depth limits are explicit safety limits.

### Standalone Primitive Contracts

- `recordTriggerVictimLoss`: call exactly once when the verified original
  victim-loss branch is represented by the adapter. Increments `"team,3"` and
  `"team,0,type"` as uint32 values, preserving every other key. Both counters
  must already be initialized, even to zero. Supports teams 0..7 and types
  0..109; no inferred damage, kill attribution, census, or entity removal.
- `applyTriggerNewtype`: exactly `800*220` entity bytes, starting at slot 0,
  and 110 movement-class bytes corresponding to definition offset `0x60`.
  Do not pass a compact active-unit array. X/Y are the high bytes of the
  unsigned words at entity offsets 0 and 4. Only the first matching
  ground-class slot's byte 6 changes. Returns a new snapshot and slot index
  (or null); team, HP, status, and all other bytes are preserved. Target types
  are conservatively limited to 0..109 even though the native write is a byte.
- `tripForReservedMtgDestination`: pass the row-major **source** tag plane,
  without its two-byte MTG header, and the successfully reserved destination
  in **runtime** coordinates. It flips Y exactly once and returns an event or
  null. It performs no collision checks, movement, edge detection, or scheduling.
  Invoke at the original reservation boundary before cursor/movement changes;
  repeated successful reservations can consume repeated lives. Do not invoke
  once per rendered frame, at spawn, for a failed reservation, or automatically
  from standing inside a bounding box.

### Integration Instructions

1. Import directly from the new module; no barrel export was added. Preserve
   the full trigger metadata, not the reduced existing legacy-mission interface.
2. Call `auditTriggerSupport` before enabling a mission. Both real missions
   report unsupported actions today; do not advertise them as implemented.
   Initialization alone does not certify support.
3. Supply verified statistic and building-slot adapters and the legacy cycle
   counter. Selector 1's actual registry filtering differs from a generic
  browser unit list. The two first-mission objectives use the verified victim
  loss producer instead. Preserve raw cycle-counter semantics.
4. Dispatch normal passes and actual spatial trip events separately in a
   deterministic order. Only trip events provide `S`. Do not advance lives
   merely because a condition was inspected.
5. Check `ok` on every call. A failure returns no new state: the entire call
   rolls back provisional actions, lives, and bail writes. This transactional
   fail-closed policy is ours, not original-game behavior. Unsupported actions
   on dormant blocks are still visible through the upfront audit.
6. Add faithful implementations/adapters for `reinforce`, `reinforce2`,
   `waypoint`, `msg`, `exomoney`, `newtype`, and `abduct` before running the
   full missions. Do not filter these actions out to make tests pass.
7. Treat `bail` as a pending result, continue permitted simulation during its
   delay, and integrate the separately verified result/campaign transition.

Verification: 17 focused tests, 42 instruction anchors, original parser/VM
execution for three expressions, original `newtype` execution for three slot
cases, and original victim-counter writes for both mission populations.
Tests include exact real-MTG tag counts and the tag-7 hole, raw-slot mutation,
uint32 loss wrap, unchanged ownership, action order, lives, and bail keys.

Remaining blockers are explicit: complete world-action adapters (particularly
`abduct` and reinforcement/waypoint order), a faithful destination-reservation
hook in the browser simulation, original removal/collision side effects, and
type-dependent rendering/data integration. Neither mission is certified end
to end. No original-game session or full browser mission completion was run.