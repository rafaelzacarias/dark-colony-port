# Native Type-40 Resource State

Research and pure helper implemented on 2026-09-19. This follows the gaps in
[mission02-action-audit.md](mission02-action-audit.md), without editing that audit,
runtime hosts, generated data, source scripts, or acceptance gates. Neither full
mission02 is certified by this work.

Implementation: [legacy-resource.ts](../src/engine/legacy-resource.ts).
Native evidence: [resource-init-20260919.py](../tools/research/resource-init-20260919.py).
Golden tests: [legacy-resource.test.ts](../tools/qa/legacy-resource.test.ts).

## Initialized Full-Width Scales

The missing initializer is indirect through configuration globals, not a direct
write of 256 to the aggregate statistic address:

| Native block | Effect |
| --- | --- |
| `0x4012b4..0x4012e6` | EDI=4; configuration dwords `0x494690` and `0x494694` receive 4. |
| `0x4014c6..0x4014ed` | Both dwords shift left six bits, producing 256. |
| `0x40183b..0x40185f` | Copy those dwords through `0x41a2c0`, selector EAX=0, indices EDX=1 and 2. |
| `0x41a3a9` | Aggregate setter writes a dword, not a word. |
| `0x41a61f` | Aggregate getter returns a dword. |

The native probe executes these blocks and the actual setter, asserting 4 -> 256
and `s(1,0)=256`, `s(2,0)=256`. A second copy of 65536 proves no signed-word
truncation. A native `newrate 1` and a parsed SCN rate 1 with that full-width scale
both produce rate word 256.

This proves the initialized configuration path, not that every save, customized
game, or later statistic write must retain 256. The helper requires explicit
`rateScale` and `reserveScale`; absent inputs are errors, not zero or 256.
Do not obtain these values through the expression VM's signed-word projection.

The inspected update block `0x419a5b..0x419b90` writes selectors 10, 11, and 5,
not selector 0. At `0x419b87..0x419b90`, selector 5 is zeroed for each side before
registered entities are visited at `0x419bb8`. Its resource-cycle increments are
therefore a per-update count, not cumulative income. The host must preserve
configuration selector 0 through census/statistic refreshes.

## SCN Parser To Source

`0x41c453..0x41c4a4` runs the original six-destination integer scanner. For the
five-field mission02 rows, the first five destinations are x, y, type, rate,
reserve; the optional sixth destination is initialized to zero. The fourth-field
`-1` branch at `0x41c4f1` precedes type dispatch and is not a negative resource
rate. The helper rejects that sentinel.

Before special dispatch, values 0..7 in column four pass through a race/counterpart
check. Shipped type 40 is `VENT`, race -1, counterpart -1 in
[GAMESTAT.TXT](../raw_cd/DC/GAMESTAT/GAMESTAT.TXT#L200); no counterpart is substituted.
The probe supplies those two metadata fields and executes the scanner, special
branch, constructor, task initialization, animation setup routine, and tile write.
It does not replace any call in this path with a stub.

At `0x41c510`, type 40 selects the special branch. It scales the **fifth** field
using `s(2,0)` (`0x41c519..0x41c538`), passes owner **8** and the scaled reserve to
constructor `0x41af14`, sets tile bit `0x04000000` (`0x41c58f`), then scales the
**fourth** field using `s(1,0)` and assigns word `+0x32` (`0x41c594..0x41c5b7`).
Rates 22 and 25 are not invalid team identifiers.

For both scales the arithmetic is:

```text
scaled = truncTowardZero(signed32(low32(value * scale)) / 256)
rateWord = low16(scaledRate)
reserve = scaledReserve < 0 ? typeDefinitionReserve : scaledReserve
```

The reserve fallback is the constructor branch at `0x41b339..0x41b349`, reading
type record `+0x44`; the original VENT row supplies 300. `typeReserve` is explicit
in the helper, never an invented fallback. A synthetic 789 fixture proves the
native fallback reads the supplied type field. SCN rates are parsed full integers;
`newrate` operands are bytes. These are different input contracts.

| Native source field | Initialized value |
| --- | --- |
| `+0`, `+4` u16 | `tile*256+128` |
| `+6` byte | 40 |
| `+7` byte | 8, not fourth SCN field |
| `+0x2c` byte | 1 |
| `+0x0c` i32 | Reserve, sharing the ordinary entity HP field |
| `+0x32` u16 | Scaled rate bits; extraction reads these as signed i16 |
| Idle task opcode / first payload word | 1 / 65535 (`0xffff`) |

Constructor task reset calls `0x412654`, which pushes idle task 1 and stores
`0xffff` in its first word. On a fresh task stack this word is entity `+0x46`.
Use the actual task payload pointer for later visits, not that offset universally.
The initializer helper returns this as `countdownWord`.

All seven original resource rows are exercised, not just dormant action targets:

| Mission | x,y | Rate | Reserve |
| --- | --- | --- | --- |
| HUMAN02 | 88,72 | 0 | 3500 |
| HUMAN02 | 11,68 | 0 | 3500 |
| HUMAN02 | 69,48 | 22 | 12000 |
| HUMAN02 | 53,27 | 15 | 7000 |
| HUMAN02 | 4,80 | 25 | 9500 |
| ALIEN02 | 65,54 | 12 | 3500 |
| ALIEN02 | 13,51 | 0 | 5000 |

Slot order remains native order, base `game+0x7d28`, stride 220, 800 slots.
The probe uses slot 152 as an isolated fixture; it does not assign all real
sources that slot. No placements or trigger blocks are removed or rewritten.

## Source Visit And Activation

Idle dispatch tests the selected type weapon entry against -1 at `0x414962`.
The nonweapon type-40 branch calls `0x413490` at `0x414981`, passing the idle
payload pointer. `advanceLegacyResourceCountdown` models one visit of that
consumer after the host has checked coordinates and resolved ground occupancy.

- Zero rate: reset source animation in mode 2 and return without changing the
  countdown. No extraction task is started.
- Resolve the tile's ground entry low ten bits. 1023 and 1022 mean no occupant.
  Occupant type 6 or 14 is eligible; ownership/status are not extra predicates
  in this consumer. Do not add team restrictions here.
- Source animation state 2 with no occupant or an eligible occupant: clear source
  direction byte `+9`, reset source animation in mode 0, reset countdown to 50.
- Other ineligible occupants: reset countdown to 50 without that animation reset.
- Eligible occupant and countdown zero: return unchanged.
- Otherwise decrement the word, then compare the result as signed i16. Positive
  means wait; nonpositive means activate. Thus initial 65535 becomes 65534 and
  activates immediately if an eligible occupant is already present. It is not
  an initial 50-visit wait.

Activation copies occupant direction to the source, starts the occupant's
deployment animation in mode 1, resets the source animation in mode 2, requests
the owner-local deployment sound, changes type 6 -> 47 or 14 -> 48, and pushes
task **12** with three payload words `[sourceSlot, 1, 0]`
(`0x4136a1..0x413776`). A host must apply these effects when the helper returns
`activate`; the pure function does not render, play audio, or allocate tasks.

## Extraction And Depletion

Task 12 handler is `0x413780`. Before settlement it handles pending-order 13
when `game+0x948==0` by task reset/return (`0x4137cf..0x4137ec`). Animation state 2
clears task word `+2` and resets extractor animation (`0x4137f3..0x413821`).
The settlement helper's entry contract is **after** these two host operations.

`0x413826..0x413839` sign-extends source rate word and tests
`signed32(reserve - signedRate) > 0`. Failure enters depletion immediately,
**before** the cadence mask. There is no partial final payout. A reserve of 22
at rate 22 remains 22 and starts depletion even on counter 15.

On the positive branch, `0x4139d7` requires `game+0x530 & 15 == 0`. Counter zero
qualifies. This is the native phase counter, not trigger clock `c` or elapsed
seconds. It increments at `0x4198b2`, can reset at the day/night boundary
`0x4199af`, and is consumed later by entity visits. The existing
[counter audit](inspire-runtime.md#recharge-and-duration) establishes that reset.
No fixed-seconds approximation is used.

At a qualifying visit:

1. Start with signed rate. If extractor owner's side `+0xbbc` is nonzero, multiply
   by side `+0x19b8`, wrap signed32, and truncate /256. That is both the initial
   payout and reserve depletion amount. The precheck does not use this multiplier.
2. Task word `+4` is an optional partner slot, zero meaning none. Active status
   other than 0/10 and type 77/78 halves payout, truncating toward zero. Each side
   can receive that half, with any odd remainder lost. Depletion is not halved.
3. A nonqualifying partner of type 4/12/77/78 clears the partner word and retains
   full payout. Another type enters diagnostic branch `0x413a9d`, with assertion
   call `0x413b05`; the helper throws, never discards it as an accepted no-op.
4. Partner side `+0xbd4 != 0` gates partner credits and aggregate selector 1.
   Extractor side `+0xbd4 != 0` gates owner credits, selector 1, and selector 5 +1.
   Credit destination is `side+0xbac`. Do not infer a generic alliance predicate.
5. Subtract the full scaled extraction amount from source reserve with signed32
   wrap regardless of either credit gate. AI scaling can overshoot below zero.

The helper returns deltas. Apply partner writes before owner writes, with 32-bit
wrapping, including when they address the same team. Income delta updates selector
1; owner cycle delta updates selector 5. Do not overwrite team totals with deltas.

### Native Depletion Return

The native probe executes the first complete depletion return with reserve/rate
22, counter 15, extractor HP 300, no pending order, and a marked source tile:

- `0x413847` calls `0x416308`: source becomes status **10**, task stack is reset,
  task 10 is pushed with two zero payload words. It is not immediately status 0.
- Extractor tasks reset at `0x413851`; the source tile flag is asserted, then
  cleared at `0x41392d`. Missing flag reaches diagnostic `0x413886` and assertion
  `0x4138f3`, not a successful cleanup.
- Push extractor task 13 with first word 50 (`0x413928..0x413940`).
- HP greater than 270 loses 270, resets animation, and returns. Fixture HP is 30,
  source reserve remains 22, tile flag is zero, credits remain 1000.
- HP <=270 instead calls extractor removal `0x416308`, then `0x434d48`
  (`0x41395b..0x41396a`). This alternate cleanup is disassembled, not a completed
  native fixture here; do not claim this document certifies its collision effects.

`extractLegacyResource` returns `deplete` without performing those world effects.
Integration must consume it as the above lifecycle, not zero the reserve and
leave the extractor active.

## Integration Diff Contract

These are required future edits, **not applied in this task**:

1. SCN/world adapter: recognize the special type-40 record before generic team
   validation; retain original source ordering and slot identity. Route all five
   fields to `initializeLegacyResource` with real scales and type-definition
   reserve. Validate against actual map width/height before calling; the helper
   checks only the 0..255 coordinate representation and 0..799 slot range.
2. Session/statistics host: run the evidenced configuration initialization, persist
   full dword `s(1,0)`/`s(2,0)`, and preserve them during census refresh. Preserve
   source rate/reserve/countdown, animation state/direction, ground occupancy,
   neutral owner 8, nonzero status, task stack and source/partner slot references.
   Retain the independent per-side AI multiplier, credit gate, funds and statistics.
3. Action host: use the existing first-active-type40 native slot search from the
   action audit. Pass the parsed byte and live full-width scale to
   `changeLegacyResourceRate`; route its zero-old-rate/nonzero-literal sound request
   **before** writing the word. Missing targets still fail at native `0x43dbc1`.
4. Task host: invoke countdown only on the source's native idle visit; resolve
   ground occupancy and apply animation/type/task/sound effects. Invoke settlement
   only for a live extraction task after cancellation/animation checks, with the
   real `+0x530` phase counter. Do not install a wall-clock income interval.
5. Lifecycle host: consume depletion using the explicit source/extractor transitions
   above, retaining removal-task and collision bookkeeping. Do not classify this
   as combat death statistics without separate evidence.
6. Acceptance: keep every HUMAN02/ALIEN02 trigger block and existing blockers.
   This helper does not implement `ai`, expression-bearing `setarray`, omitted
   lives, mission loading, or a complete campaign execution path.

### Exact Remaining Native Inputs

There is no unresolved arithmetic branch in the implemented helper. Full native
mission execution remains outside this fragment fixture. Its next concrete inputs
are not guessed:

- Full idle dispatch requires initialized type/owner weapon selection data. At
  `0x414962`, `[type*280 + selectedWeapon*4 + 0x4f1898]` must be the actual -1
  entry for the `0x414970` type-40 path; zero-filled metadata instead branches to
  `0x414a87`. Supply the loaded VENT weapon metadata, not a skipped branch.
- Subsequent source removal task 10 executes `idiv ebx` at `0x4164d8`, where EBX
  comes from type record `+0xe8`. The fragment's uninitialized animation profile
  has zero there. Next input is the actual VENT death-variant count and animation
  pointers from native asset initialization, then its animation updates. The
  task eventually sets status 0 / registered-slot -1 at `0x416532..0x416536`.
- The HP<=270 path's next entry is `0x434d48`, with EAX=game, EDX=extractor slot
  after native removal. It needs that extractor's real map/collision and registered
  entity state. No successful final cleanup is asserted for that branch here.

## Reproduce And Evidence Limits

Pinned DC.EXE SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The probe reuses the existing hash-checking PE loader and emits fingerprints for
all four original SCN/TRO files. It needs the existing isolated Capstone/Unicorn
installations, no new dependencies:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/resource-init-20260919.py
node --import tsx --test tools/qa/legacy-resource.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 \
  --module ESNext --moduleResolution bundler --types node \
  src/engine/legacy-resource.ts tools/qa/legacy-resource.test.ts
```

Observed: native **PASS** (initializer/full-width checks, all seven source rows,
fractional scaling and fallback, eight countdown fixtures, thirteen settlement
fixtures, full first depletion return); **5/5** focused TypeScript tests; scoped
typecheck passed. Tests compare all 20 HUMAN02 and 12 ALIEN02 parsed blocks with
their complete generated arrays. No source block filters or replacement no-ops.

The native fixture installs flat 32-bit GDT descriptors: without them, the CRT
scanner's ES load exposes Unicorn's 16-bit stack wrap and `pop ebp` at `0x45606f`
reads `0xdf80` despite ESP=`0x70df80`. Correcting segments lets the real scanner
run; it is not a parser stub. Memory is synthetic, rendering/animation payload
pointers are empty, and no native movie/audio playback or full scheduler loop
is certified. Native code calls within the parser, countdown, settlement, and
first depletion-return fixtures are not hooked out. The reused newrate fixture
retains its documented device-boundary recorder.

No agents, browser, full suite, shared-document edits, or runtime integration were
used. Disassembly/search modes of the probe are investigation tools; the default
invocation runs all native goldens and fails on a mismatch.