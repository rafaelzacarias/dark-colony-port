# Mission02 Action Audit: newrate

Audited 2026-09-19. **Native action semantics verified; neither mission02 is
accepted.** This research changes no runtime, source TRO, generated data, or
preflight gate. It selects one small unsupported action, not a broad opcode map.

## Fresh Preflight

The probe calls the current [campaignPreflight](../src/game-data.ts#L131) on
both complete source scripts, after asserting deep equality with every generated
block. No blocks or actions are removed, rewritten, given replacement lives, or
executed as placeholder no-ops. The VM-only projection inside existing preflight
is unchanged; its controller pass still checks every world action.

| Mission | Source blocks | Current diagnostics |
| --- | --- | --- |
| HUMAN02 | 20 | TRO 8/16 `newrate`; TRO 17 `ai`; TRO 18 `setarray` |
| ALIEN02 | 12 | TRO 8 requires explicit lives; TRO 0 `ai`; TRO 10 `newrate`; TRO 11 `setarray` |

These match [campaign-progression.md](campaign-progression.md). This probe does
not recertify the document's 2/30 campaign count or any phase acceptance gate.

## Exact Signature

```text
newrate rate tileX tileY
```

Three decimal literals are parsed into unsigned bytes at action offsets +4, +5,
and +6. There is no team argument. The native parser stores the low byte, rather
than range-checking: `256 267 324` becomes `0 11 68`. A future evidence-gated
host decoder can reject out-of-range inputs explicitly; it must not change the
meaning of the in-range mission source. Expressions are not established for
this action. Opcode is **5**, action record stride is 28, and +0x18 links to the
previous action, preserving the native reverse-source action chain.

| Source | Condition, lives | Corresponding five-field SCN row |
| --- | --- | --- |
| [HUMAN02 TRO](../raw_cd/DC/SCENARIO/HUMAN/HUMAN02.TRO), block 8: `newrate 12 11 68` | `(c>550)`, 1 | `11 68 40 0 3500` |
| Same source, block 16: `newrate 12 88 72` | `(c>450)`, 1 | `88 72 40 0 3500` |
| [ALIEN02 TRO](../raw_cd/DC/SCENARIO/ALIEN/ALIEN02.TRO), block 10: `newrate 15 13 51` | `(c>250)`, 1 | `13 51 40 0 5000` |

The rows are read directly from original SCN files, not inferred from generated
JSON. Their zero fourth fields are consistent with dormant resources, but this
audit does **not** trace the SCN loader to prove the fourth/fifth-field assignment
or that a live mission initializes the native rate word to zero.

## Native Effects

1. Scan native entity slots **0 through 799**, stride 220, base
   `game+0x7d28`, in increasing order. Select the first slot with coordinate
   words `u16(+0)>>8 == tileX`, `u16(+4)>>8 == tileY`, type byte `+6 == 40`,
   and status byte `+0x2c != 0`. Ownership, HP, and sub-tile coordinate fractions
   are not selection predicates. Later matching slots remain unchanged.
2. If the **old** word at `+0x32` is zero and the **literal parsed rate** is
   nonzero, invoke sound routine `0x431bf4` with EAX=1, EDX=7, EBX=0, ECX=0,
   and stack argument 0. This occurs before the rate write. It is a non-spatial
   category-1/event-7 request, not a unit spawn or a scripted `msg` action.
3. Read aggregate **`s(1,0)`** from dword `0x495710`, using helper `0x41a538`.
   This is a full dword read, not the expression VM's signed-word truncation.
   The team index is fixed at 1, even for an entity whose owner is 7.
4. Compute and overwrite the selected entity's word at **`+0x32`**:

```text
product = signed32(low32(rate * dword_s_1_0))
rateWord = low16(truncate_toward_zero(product / 256))
```

This is assignment, not accumulation. With a fixture scale of 256 the word is
12 or 15; with scale 128, rate 15 becomes 7. Scale -128 gives word 65529
(signed -7). Product overflow follows x86 signed-32-bit wrap. **256 is a probe
fixture, not a verified mission initializer default.** A targeted direct-address
xref search did not locate that initializer; indexed writes remain possible.

The golden probe compares all 0x50000 game bytes and 0x3900 statistic bytes.
Only the selected rate word changes in game state. Aggregate/per-type
statistics, entity team, HP, other entity fields, and other matching slots remain
unchanged. No immediate credits, census, victim losses, reinforcement, or task
scheduling is performed. Sound routing can separately mutate its variant index
and CRT RNG seed. The action's rate-word consumer, resource yield units, remaining
resource accounting, and later credit cadence are **not verified here**.

The sound predicate uses the source byte, not the scaled result. Consequently
old rate zero plus source rate 15 still requests sound when scale zero yields
rate word zero. Setting source rate zero does not request this sound.

### Missing Target

No eligible target reaches the diagnostic branch at `0x43dbc1`, followed by
logging and assertion code ending in a call to `0x46cb3e` at `0x43dc31`.
It is **not** a verified successful no-op. Negative fixtures stop on entry to
that diagnostic branch and confirm no prior world/statistic mutation; logging,
assertion handling, and recovery after it are not emulated. A host must report
missing target state, not accept and silently discard this action.

## Timing

The rate overwrite is synchronous in the current action dispatch; there is no
timer or delayed job in the handler. Notification precedes the overwrite, and
the next linked action follows it. Thus HUMAN02 block 16's later-written `msg`
executes before `newrate` in the native reversed action chain.

The existing [native clock evidence](trigger-runtime.md#conditions) defines
`c = i16(i32(updateCounter) >> 4)`, not seconds. In the initial nonwrapped range,
the predicates first become true at counters **8816**, **7216**, and **4016**
for HUMAN02 blocks 8/16 and ALIEN02 block 10 respectively. Execution still requires
the normal trigger scan, nonzero lives, and a true condition. These values are
eligibility thresholds, not measured wall-clock timestamps or complete mission
playthrough results. This audit reuses the existing clock/scan evidence; its new
native fixtures execute action dispatch, not the complete trigger scheduler.

## Prerequisite Host State And Blockers

- Preserve native slot order, coordinates, type, nonzero status, and a persistent
  16-bit rate field for type 40. A generic HP/team-only entity is insufficient.
- Supply the initialized full-width aggregate `s(1,0)` and preserve it through
  statistic refreshes. [campaign-session.ts](../src/engine/campaign-session.ts#L176)
  currently seeds aggregate victim losses and per-type victim losses, not this
  scale. Do not invent 256 or treat missing input as zero.
- Decode special source placement records before claiming mission support.
  [campaign-world.ts](../src/engine/campaign-world.ts#L100) currently treats the
  fourth column as a team in 0..7. Original mission02 type-40 rows also contain
  `69 48 40 22 12000` and `4 80 40 25 9500`, which violate that contract.
  Native initialization of their special fields and the downstream rate consumer
  are concrete remaining research requirements, not solved by this action probe.
- Route the zero-to-nonzero sound request through a real initialized audio host.
  Native sound code checks readiness at `0x47963d`, category count at `0x4f98d4`,
  suppression at `0x47963c`, and the category/event record. The active fixture
  provides a one-variant category-1/event-7 record at `0x4cbd17`, application/device
  pointers via `0x4d1994`, and the CRT context pointer at `0x516a94` with seed at
  context+0x0c. It executes native routing and RNG; only the final device callback
  is replaced by a recorder. Sample 37 is synthetic, **not** an identified asset.
- `ai`, expression-bearing `setarray`, and ALIEN02's omitted lives remain rejected.
  Supporting this action alone cannot admit either complete mission, much less
  certify all campaign phases. No acceptance gate was weakened.

## Executable Evidence

Pinned [DC.EXE](../raw_cd/DC/DC.EXE) SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The probe uses the existing PE loader and literal-parser fixture in
[mission-actions.py](../tools/research/mission-actions.py). It rejects a different
executable hash, checks the keyword and opcode-table entry, executes the original
parser, then enters the actual indirect action dispatcher at `0x43d822`.

| Native address | Evidence |
| --- | --- |
| `0x476b0c`, reference `0x43efc1` | `newrate` keyword and comparison branch |
| `0x43efd9` through `0x43f097` | Three byte operands, opcode 5, predecessor link |
| `0x43d7d0` | Opcode-5 table entry points to `0x43daf7` |
| `0x43daf7` through `0x43dbbd` | Slot scan, active/type/coordinate checks, sound condition, rate write |
| `0x43db31` through `0x43db57` | Fixed team 1 / selector 0 read, signed multiply/divide, word assignment |
| `0x41a60d` through `0x41a62c` | Aggregate statistic address computation and dword return |
| `0x431bf4` through `0x431da2` | Sound readiness, suppression, event lookup, device callback, next variant |
| `0x44e223`, `0x45a7a6`, `0x44e22d` | CRT context accessor and native sound-variant RNG |
| `0x43dbc1` through `0x43dc39` | Missing-target diagnostic/assertion branch |

Source fingerprints are emitted by every probe run:

| Source | SHA-256 |
| --- | --- |
| HUMAN02.TRO | `0e5a6593768b4fff717be69609d8ed5eb2aea48d1bab68c30c8d5d621d7e080d` |
| HUMAN02.SCN | `bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab` |
| ALIEN02.TRO | `b219fa5bf2b13ba122271295679d488bb70077556dae20dfa76b00aa9968f50e` |
| ALIEN02.SCN | `d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e` |

## Reproduce

From the repository root, with the project Node dependencies and isolated
Capstone 5 / Unicorn 2 installations available:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/mission02-audit-20260919.py
```

[The golden probe](../tools/research/mission02-audit-20260919.py) has no skip,
filter, or alternate acceptance mode. All **16 native fixtures** and both complete
mission02 preflights run on every invocation. A mismatch exits unsuccessfully.
Fixtures cover all three source operands, first eligible match with inactive and
wrong-type decoys, slots 0/799, duplicate targets, fractional coordinates, team
independence, fractional/negative/zero/overflow scaling, zero-rate deactivation,
activation audio, byte wrap, and missing targets. Golden outputs are constants,
not copied from observed native results.

Observed result: **PASS**, 16/16 native fixtures; 20 HUMAN02 and 12 ALIEN02 source
blocks preserved; four preflight diagnostics per mission. These are bounded
native-fragment and source-audit results. No browser, agents, full suite, runtime
integration, native mission playthrough, downstream economy certification, or
all-phases acceptance is claimed.