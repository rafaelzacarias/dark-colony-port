# Mission02 Control Actions: Native Contract

Audited 2026-09-19. **Native grammar and bounded state effects proven; neither
mission is admitted.** This follows [mission02-action-audit.md](mission02-action-audit.md).
Only this document and [the new probe](../tools/research/mission02-control-actions-20260919.py)
are changed. No shared parser, controller, session, runtime, generated source,
acceptance gate, or application entry point is modified. No standalone TypeScript
helper is presented as runtime integration.

## Complete Source Evidence

The probe runs the original loader at `0x43fb90`, block parser at `0x43e658`,
decimal parser, expression compiler, and action-link construction on **every byte**
of both original TRO files. Only file open/read/close (`0x406288`, `0x406338`,
`0x40636c`) are replaced with an in-memory file service. Blank lines, CRLF,
conditions, lives, and all actions are retained. Native diagnostics fail the probe.

| Source | Native compilation | SHA-256 |
| --- | --- | --- |
| [HUMAN02.TRO](../raw_cd/DC/SCENARIO/HUMAN/HUMAN02.TRO) | 20 blocks, 42 actions | `0e5a6593768b4fff717be69609d8ed5eb2aea48d1bab68c30c8d5d621d7e080d` |
| [ALIEN02.TRO](../raw_cd/DC/SCENARIO/ALIEN/ALIEN02.TRO) | 12 blocks, 25 actions | `b219fa5bf2b13ba122271295679d488bb70077556dae20dfa76b00aa9968f50e` |
| [HUMAN02.SCN](../raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN) | Initial team AI fields verified | `bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab` |
| [ALIEN02.SCN](../raw_cd/DC/SCENARIO/ALIEN/ALIEN02.SCN) | Initial team AI fields verified | `d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e` |

Byte ranges below are zero-based, half-open, and exclude CRLF; line numbers are
one-based. These are original file offsets, not decoded/generated offsets.

| Source / Block | Line | Byte range | Exact ASCII / hex |
| --- | --- | --- | --- |
| HUMAN02 / 17 | 86 | `[1568,1574)` | `ai 2 3` / `616920322033` |
| HUMAN02 / 18 | 91 | `[1674,1691)` | `setarray 0 (c+45)` / `736574617272617920302028632b343529` |
| ALIEN02 / 0 | 2 | `[17,23)` | `ai 1 3` / `616920312033` |
| ALIEN02 / 8 | 42 | `[726,746)` | `8 norm (s(1,0,86)>2)` / `38206e6f726d20287328312c302c3836293e3229` |
| ALIEN02 / 11 | 53 | `[968,985)` | `setarray 0 (c+45)` / `736574617272617920302028632b343529` |

## `ai team mode`

Opcode **0**, record stride **28**. Native decimal conversion stores the low
16 bits of the first argument at `action+4` and the second at `action+6`.
Dispatch sign-extends **both** words and synchronously assigns:

```text
i32(game + 0x0bbc + i16(teamWord) * 0x0e30) = i16(modeWord)
```

The first argument is the **team whose AI selector changes**, not the new mode,
an opponent, or an alliance direction. The second is that team's AI implementation
selector. This is assignment, not toggle, accumulation, entity conversion, or an
immediate order to every unit. The handler performs no calls, task allocation,
entity writes, statistic updates, or reset of adjacent team state. Full `0x50000`
game-byte and `0x3900` statistic-byte comparisons prove the isolated write.

The action itself does not validate team/mode ranges. Parser truncation and signed
dispatch are not permission to expose unsafe host indexing: the ordinary host
team domain is **0..7**, with mode **0** disabled and native implementation
selectors **1..4**. The consumer subtracts one and indexes the four-entry table at
`0x47936c`; its upper-bound diagnostic is not a general safe negative-value guard.
Extreme-word fixtures establish representation only, not supported AI policies.

These operands are **literals, not expressions**. Native parser-only controls:
`2 (1+2)` stores `(2,0)` and leaves the unconverted input cursor at the space
before `(`; `(1+1) 3` stores `(0,0)` without consuming the expression. A host should
reject such malformed input, not pretend to evaluate it. `65538 65539` stores
`2,3`; `2 -1` stores `02 00 ff ff`, then assigns dword `ff ff ff ff`.

### Initial State And Consumer

The original SCN scalar order is documented in
[scenario-team-fields.md](scenario-team-fields.md). Team-base `game+0xb98+team*0xe30`
plus `0x24` is the same AI field. The native SCN scalar conversion/store at
`0x41be27..0x41be34` is executed by the probe. Its enclosing loader uses the source
value when the field at its context `+0x14a0` is 0 or 3; this is not a claim about
all multiplayer/load modes or a complete SCN-loader emulation.

| Mission | Initial AI values, teams 0..7 | Action transition |
| --- | --- | --- |
| HUMAN02 | `0 0 4 3 3 0 0 0` | team 2: `4 -> 3` |
| ALIEN02 | `0 4 4 0 0 0 0 0` | team 1: `4 -> 3` |

Native selector `0x41ab20` chooses mode-4 descriptor `0x47b34c`, task list
`0x47b33c`; after the real action write it chooses mode-3 descriptor `0x47b328`,
task list `0x47b318`. Both team fixtures reach the original indirect callback
instruction `0x41abca` with the expected game/team arguments and changed task list.
The probe stops **before** that callback, not after emulating an entire AI policy.
Mode 4's first weight callback (`0x44d6e0`) returns zero; its paired action
(`0x44d6e8`) returns immediately. Mode 3 selects a different implementation;
labels such as "aggressive", "attack player", or "difficulty 3" are not proven.

Consequently a real host must preserve the initialized selector and route future
AI work through the selected implementation. Merely storing `mode=3` in an unused
object, returning changed helper state, or accepting the action with no consumer
does **not** implement the action's gameplay effect.

## `setarray index expression`

Opcode **6**, stride **28**. The index is a decimal literal stored as a word at
`action+4`. The expression is compiled at load time; its bytecode pointer is
stored at `action+8`. Dispatch zero-extends the index, evaluates the compiled
expression through `0x43cf2c` with the current game and triggering-team context
**-1**, then calls the real statistic writer at `0x41a3b8`:

```text
selector = 2; team = 0; index = u16(action+4)
value = signed result of the native 16-bit expression VM
i32(0x495868 + 16 * index) = value
observable read: s(0,2,index)
```

The writer requires **0 <= index < 800** and stores the sign-extended result in a
**32-bit** cell. `800` and `65535` reach diagnostic `0x41a49d` before any host write;
the probe stops at that boundary and does not emulate diagnostic recovery.
Literal `65536` wraps to index 0. This is a synchronous overwrite, not a queued
timer, byte assignment, relative increment, or replacement of the entire table.

Storage is the existing per-type statistic table, whose team stride is 1760 and
index stride is 16. It is **not a separate 800-cell allocation**: index 110 aliases
`s(1,2,0)`, and index 799 aliases `s(7,2,29)`. The mission scripts use index 0.
The native reset `0x419d60..0x419d8a` clears aggregate bytes `[0x4956e0,0x495860)`
and per-type bytes `[0x495860,0x498f60)`. The probe executes it against sentinels
and reads zero through the original VM. A direct reset call is pinned at
`0x401779`; a whole native startup/save-load execution is not claimed.

### Expression Goldens

Bytecode includes the `16` expression terminator; all numbers below are hex bytes.

| Expression | Native bytecode | Golden result |
| --- | --- | --- |
| `(c+45)` | `08 07 2d 00 0b 16` | counters `0`, `1600`, `524272`, `0xfffffff0` yield `45`, `145`, `-32724`, `44` |
| `32768` | `07 00 80 16` | `-32768`, stored dword `00 80 ff ff` |
| `65535` | `07 ff ff 16` | `-1`, stored dword `ff ff ff ff` |
| `(s(0,2,0)+1)` | `07 00 00 07 02 00 07 00 00 11 07 01 00 0b 16` | initialized cell 123 yields 124 |

The `(c+45)` fixture is parsed with counter **14400**, then the **same compiled
action** is dispatched at each listed counter. Thus 945 is not captured at parse
time. Each result is checked by exact host-memory comparison and original-VM
readback. `c = i16(i32(game.updateCounter) >> 4)`; addition wraps to signed 16 bits.
This proves the mission's expression, not every possible native expression opcode.

## Omitted Lives Is Zero

ALIEN02 block 8 is parsed as written, **not repaired to one life**. Native header
code always invokes decimal conversion at `0x43e808`, stores the low byte at
`0x43e878`, and passes the remaining cursor to the expression compiler. When the
next token is `(`, conversion returns zero without consuming the condition.
This is permissive decimal-conversion behavior, not an inferred optional-one rule.

All of these compile to the same condition bytes:
`07 01 00 07 00 00 07 56 00 11 07 02 00 06 16`.

| Header | Initial lives |
| --- | --- |
| `8 norm (s(1,0,86)>2)` | 0 |
| `8 norm 0 (s(1,0,86)>2)` | 0 |
| `8 norm 1 (s(1,0,86)>2)` | 1 |
| `8 norm 256 (s(1,0,86)>2)` | 0, low-byte truncation |

Trigger records are 16 bytes at `0x4fbc48 + 16*id`: mode dword `+0 = 0` for
`norm`, compiled condition pointer `+4`, lives byte `+8`, action-head pointer
`+12`. Bytes `+9..+11` are not initialized by this header path. Complete-script
loading first clears lives and condition pointers for IDs 0..127; it does not
initialize every byte of every record. The final action head points to the last
source action, not the first.

The normal scan checks lives **before evaluating the condition**. A native scan
fixture seeds `s(1,0,86)=3`, supplies the real compiled condition, and confirms
zero expression/action calls with lives zero. No complete ALIEN02 action arms
block 8. It is initially disabled, not infinitely repeatable or implicitly armed.

## Evaluation Order And Timing

Every native action stores its predecessor at `+0x18`; the probe verifies the
entire reversed chain for all 67 source actions.

| Block | Execution order relevant here |
| --- | --- |
| HUMAN02 / 17 | `ai 2 3`, then reinforcement |
| ALIEN02 / 0 | `abduct`, then reinforcement, then `ai 1 3` |
| HUMAN02 / 18 | `setlifes 19 1`, `setarray 0 (c+45)`, `msg` |
| ALIEN02 / 11 | `setlifes 12 1`, `setarray 0 (c+45)`, `msg` |

HUMAN02's AI trigger requires `c>880` **and** `s(0,10)==0`; ALIEN02's requires
`c>70`. In the initial nonwrapped range their earliest clock eligibility is
update counter **14096** and **1136**, respectively, subject to trigger scan and
remaining lives. Those are not elapsed seconds or native-playthrough results.

Delayed HUMAN02 / 19 and ALIEN02 / 12 start with zero lives. Their condition is
`c>s(0,2,0)`, not `>=`. If armed at integer clock value `t` without wrap, storing
`t+45` first permits the condition at `t+46`. Signed-word wrap must be retained;
turning this into an unconditional 45-second host timer changes the script.
The complete mission action chains are compiled, not played through in these
fixtures; unrelated reinforcement, abduct, and message effects are not mocked
into successful mission execution.

## Native Instruction Anchors

Pinned [DC.EXE](../raw_cd/DC/DC.EXE) SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
These anchors are asserted by the probe, not just copied disassembly labels.

| Address / range | Exact anchor bytes | Contract |
| --- | --- | --- |
| `0x43e989..0x43ea27` | `0x43e9d1: 66899850c44f00`; `0x43e9f5: 66899052c44f00` | AI literal parser, two words |
| `0x43d840..0x43d85d` | `0x43d852: 899407bc0b0000` | Signed operands, side dword assignment |
| `0x41be27..0x41be34` | `0x41be32: 894724` | Initial SCN AI field |
| `0x41abad` | `8b04856c934700` | Mode-minus-one selects implementation |
| `0x43f500..0x43f588` | `0x43f545: 66899050c44f00`; `0x43f55f: 898254c44f00` | Array literal index / expression pointer; shared compiler tail at `0x43f22f` |
| `0x43dacc..0x43daf6` | `0x43dad6: e851f4ffff` | Evaluate expression at dispatch, then write selector 2 / team 0 |
| `0x41a495`, `0x41a529` | `81fe20030000`; `899060584900` | Index upper bound / dword statistic write |
| `0x43e808`, `0x43e878` | `e8a3ee0200`; `889050bc4f00` | Unconditional lives conversion / byte store |
| `0x43e515` | `80b950bc4f0000` | Lives-zero scan gate |
| `0x401779` | `e8e2850100` | Call to statistic reset |

## Integration Boundary

The focused preflight still reports HUMAN02 blocks 8/16 `newrate`, 17 `ai`,
18 `setarray`; ALIEN02 block 8 missing explicit lives, 0 `ai`, 10 `newrate`,
11 `setarray`. Both generated block arrays are checked for equality with the
complete source parser output. No blocks are filtered or flags substituted.

Required work outside this ownership boundary:

1. Preserve the omitted source token while deriving native initial lives **0**
   in the shared parser/runtime contract. Do not rewrite original TRO or hide the
   block from preflight. See [trigger-runtime.ts](../src/engine/trigger-runtime.ts).
2. Integrate expression-valued actions with the real VM/state pipeline. The
   current expression tokenizer does not support `+`; accepting `setarray` in a
   separate decoder cannot fix that. Preserve dispatch-time evaluation, signed
   word arithmetic, array initialization, aliases, and feedback persistence.
3. Seed and consume per-team AI state from the original SCN in the host. Preserve
   native action direction/order and run the selected AI behavior. The mode-3
   task policy and its host dependencies still require implementation/verification;
   this work proves selection, not a replacement tactical AI.
4. Wire real host mutations through the controller/session, including subsequent
   condition reads and tick feedback. [campaign-session.ts](../src/engine/campaign-session.ts)
   currently seeds victim losses, not this array field. Returning detached state
   from a new helper is insufficient.
5. Resolve the independent `newrate` and source-world prerequisites in
   [mission02-action-audit.md](mission02-action-audit.md), then rerun complete
   mission admission and lifecycle checks. This audit does not waive them.

## Reproduce And Scope

From the repository root, with project Node dependencies (`tsx`), Capstone 5,
and Unicorn 2 installed in the existing isolated locations:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/mission02-control-actions-20260919.py
```

Observed **PASS**: 15 instruction anchors; two complete native TRO compilations;
four header variants and one zero-lives scan; seven AI dispatch fixtures, four
parser-only controls, two SCN-to-AI-selector fixtures; native statistic reset;
seven successful array dispatches with bytecode/readback goldens and two invalid
indices; both complete-source preflight rejections. No skips or fixture filters.
Except the full-compiler file services, native parser/VM/action instructions run
unmodified. Consumer/error probes stop at their stated boundaries.

No agents, browser, full suite, full native mission execution, or runtime
integration was used or claimed.