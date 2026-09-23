# SARGE Native Income Partner And Range

## Result

**Resolved for the bounded native acquisition and delivery functions. There is no
numeric circular or squared-distance theft radius.** The acquisition region is
the union of two cell rectangles, with half-extents **11 by 22** and **22 by 11**.
Selection uses ordered ground-cell scanning, not nearest actor or lowest slot.
Source `observationDay` is not the acquisition limit. Visibility is required
when acquiring, but neither visibility nor distance is checked again by the
linked idle and settlement consumers.

Only new research files were added. No economy, view, engine, asset, package,
mission, or acceptance-gate changes were made. No source helper was installed:
the existing adapted consumer's carry, selection, and link-lifetime policies
need an explicit integration decision before a source receipt can be wired in.

- Probe: [sarge-partner-range-20260923.py](../tools/research/sarge-partner-range-20260923.py).
- Complete native evidence: [sarge-partner-range-20260923.json](sarge-partner-range-20260923.json).
- Existing consumer: [browser-income-interception.ts](../src/engine/browser-income-interception.ts).
- Earlier settlement contract: [resource-runtime-20260919.md](resource-runtime-20260919.md).

The final run completed in 3.407 seconds: **390 asserted acquisition cases**, two
source-constructed deployment/link chains, eight cadence observations, ten
delivery controls, two dead-collector idle invalidations, and two occupied-link
rejections. Runtime interceptions after source/FIN setup: **zero**.

## Source Identity

| Source | SHA-256 |
| --- | --- |
| DC.EXE | `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b` |
| GAMESTAT/GAMESTAT.TXT | `ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629` |
| ANIM.DAT | `20e9cf988ed833236ca0687601ab32a2adeaae0d885b39a7507321166bdba3d0` |
| Evidence JSON | `b8990a2a38c8e913722570e7600a9b06696286fa2bd7502d754c444e78872246` |

The JSON includes each loaded FIN source hash, exact original GAMESTAT token
rows, and native 280-byte type records. Native day/night fields are `+0x14` and
`+0x10`, respectively. Relevant source bindings:

| Original Type | Sprite | Deployed Type | Deployed Sprite | Day/Night |
| --- | --- | --- | --- | --- |
| 4 | SARG | 77 | SARGSTL | 10/10 in both forms |
| 6 | EXPL | 47 | EDPLY | 6/4 mobile, 8/5 deployed |
| 14 | SLUG | 48 | SDPL | 4/6 mobile, 5/8 deployed |
| 12 | PSYC | 78 | PSYCSTL | 10/10 in both forms |

The real type-4 deployment chain was run against **both** collector families.
Type 12/78 source metadata and branches are recorded, but an independent
12-to-78 deployment chain is not claimed.

## Native Call Path

| Function/Instruction | Role |
| --- | --- |
| `0x416784` | Begin deployment animation and push task 13. |
| `0x4264c8` | Advance real source FIN animation; this fixture reaches state 2 after nine visits. |
| `0x417b0c` | Deployment completion; waits for animation state 2. |
| `0x417d12` | Change source type 4 to 77. |
| `0x417e20 -> 0x417944` | Acquire a collector from current cells and team visibility. |
| `0x417e75` | Store collector slot in SARGE's current idle payload word 0. |
| `0x417e91` | Reject a nonzero collector partner word; no overwrite or second candidate scan. |
| `0x417eb8` | Store SARGE slot in collector's current task-12 payload word 2 (`+4`). |
| `0x4149b4 -> 0x413bc0` | Deployed type-77/78 idle: validate the existing collector pointer. |
| `0x413780` | Collector task 12; delayed resource settlement. |

Task storage is actor-relative, **not always actor+0x46**. For current task cursor
`actor+0x38`, opcode is `actor+0x39+2*cursor`, and payload is
`actor+0x46+2*byte(actor+0x3a+2*cursor)`. Actor base is
`game+0x7d28+220*slot`. Native partner slots are signed 16-bit on these reads;
the tested registered slots are 152..155, within the real 0..799 pool.

## Acquisition ABI And Exact Scan

`0x417944`: `EAX=game`, `EDX=callerCellX`, `EBX=callerCellY`, `ECX=callerTeam`.
Return `EAX=collectorSlot`, or `-1`. The caller derives coordinates with
`u16(actor.xQ8) >> 8` and `u16(actor.yQ8) >> 8`.

`0x417957` loads the literal **11**; the following scan doubles it to **22**.
For `band=0..11`, then `offset=-22..22`, inspect cells in this exact order:

```text
(callerX - band,   callerY + offset)
(callerX + band,   callerY + offset)
(callerX + offset, callerY - band)
(callerX + offset, callerY + band)
```

Out-of-map cells are skipped. Duplicate cells are visited; do not replace the
order with radial distance sorting. For a consistent single-cell occupancy
map, the geometric envelope is:

```text
abs(dx) <= 22 && abs(dy) <= 22 && min(abs(dx), abs(dy)) <= 11
```

This includes `(11,22)` and `(22,11)` but excludes `(12,12)`, `(12,22)`, and
axis distance 23. Thus no Euclidean squared-radius predicate can reproduce it.
The source SARGE day/night values happen to be 10/10; changing both fields on
types 4 and 77 to 0, 1, or 99 leaves the `(22,11)` acquisition positive when
the required ground visibility is present. Do not use `observationDay + 1` as
a derivation: the selector uses its own executable literal.

At each scanned cell, native eligibility is:

1. Read `groundWord & 0x3ff`; skip 1022 and 1023.
2. Resolve that slot's actual actor. Its team must differ from caller team.
3. Its current type must be **47 or 48**, not mobile 6/14, VENT 40, or thief 77/78.
4. Its status byte `+0x2c` must be nonzero. Acquisition itself does **not** exclude 10.
5. Read the ground word at the target actor's own floored Q8 position. Require
   `word & dword(game + callerTeam*0xe30 + 0x19c0) != 0`.
6. If target type field `+0x68 != 0`, require target `+0xca & (1 << callerTeam)`.
   Source types 47/48 have `+0x68 == 0`; the extra branch was tested using an
   explicitly labelled non-source field control.
7. Return immediately on the first eligible target.

No alliance table or HP value is consulted here. An allied different-team
collector is accepted. All eight caller teams and target teams were exercised;
shared-mask cases use the explicitly supplied native mask, not a hardcoded
`1 << team` interpretation. The conditional reveal byte uses that separate bit
convention only when `type+0x68` is nonzero.

The first target can be farther away and have a larger slot: `(0,-22)` is
selected before `(1,0)`, whether the far target occupies slot 153 or 155.

The primitive trusts its occupancy pointer; it does not check that the scanned
cell and actor position agree. An adapter must provide a consistent current
ground map, not manufacture an occupancy word from a desired candidate list.

## Current-Frame Evidence

Each JSON collector entry exports `currentFramePartnerEvidence`. These are
native observations, **not preauthenticated browser runtime receipts**:

| Field | Observed Value |
| --- | --- |
| Boundary | After `0x417b0c`, selector, and reciprocal write |
| Native phase counter | 0 (controlled acquisition boundary, not browser tick 0) |
| Interceptor | Slot 154, team 0, original type 4, current type 77, status 1 |
| Interceptor Q8 position | `(16512,16512)`, cell `(64,64)` |
| Collector | Slot 153, team 1, original type 6 or 14, current type 47 or 48 |
| Collector Q8 position | `(16768,16512)`, cell `(65,64)` |
| Resource | Slot 152, type 40, team 8, same cell as collector |
| Caller native visibility mask | `0x40000000` |
| Collector ground word | `0x40000099` (slot 153 plus visibility bit) |
| SARGE idle payload word 0 | 153 |
| Collector task 12 words | `[152,1,154]` |

Both exact raw220 actor records and source rows accompany these values. Native
slots do not encode the adapter's generation/key/simulation ID: the adapter must
bind those to its current authoritative actor identities, never infer or reuse
them from this fixture.

For an explicit adapted `rangeEvidence` producer, the minimum handoff is:

1. Bind `tick` to the **current snapshot tick**, separately carrying any native
   phase counter. Reject stale receipt/snapshot pairs before applying effects.
2. Bind source hashes/type rows, original and current types, slot/key/generation,
   team, status, and exact Q8 positions for both actors. A sprite label alone is
   insufficient proof that a simulation unit came from source type 4 or 6/14.
3. At deployment completion, use the full current ground map and native team
   visibility mask to perform the above ordered scan. There is no radius option.
4. Record the selected cell, its ground word, target-own-cell visibility word,
   acquisition counter/tick, and reciprocal task partner slots. Refuse occupied
   partner words. Persist the committed link with generation-safe identities.
5. At a later delivery tick, revalidate the current partner identity/type/status
   and the committed link. Do not rerun range or visibility to erase a surviving
   native link. Keep acquisition evidence distinct from delivery eligibility.

If a full occupancy/visibility frame is unavailable, the geometric envelope
alone can only be labelled **bounded adapted range**, not native partner
selection. A nearest or lowest-slot fallback must not be represented as this
source function. No caller-authored `withinSourceRange: true` substitutes for
the above observations.

## Delayed Delivery

The native link persists. `0x413bc0` only checks the linked collector's status
is neither 0 nor 10 and its current type is 47/48; otherwise it resets SARGE's
tasks and begins undeployment. It does not scan again or test distance/sight.

At task-12 settlement, `counter & 15 == 0` is the cadence predicate, after the
reserve/depletion precheck. A partner word of zero means none. Otherwise the
stored partner must be status neither 0 nor 10 and current type 77/78. Invalid
known partner types 4/12/77/78 clear the word and retain full payout; unrelated
types reach a diagnostic path, not an accepted no-op.

With rate 25, initial reserve 1000, no AI multiplier, and both credit gates on:

| Counter | Reserve | Team 0 Cumulative Credits | Team 1 Cumulative Credits |
| --- | --- | --- | --- |
| 15 | 1000 | 0 | 0 |
| 16 | 975 | 12 | 12 |
| 17 | 975 | 12 | 12 |
| 32 | 950 | 24 | 24 |

Each half is truncated toward zero. **The odd remainder is lost per native
cycle, not carried.** Full gross extraction still depletes the resource. Native
AI scaling and independent credit gates remain as documented in the earlier
resource settlement contract; this probe's new positive chain does not sweep
those already-established variants.

After linking, controlled loss of visibility or displacement of SARGE to cell
`(2,2)` still passes native idle validation and pays 12/12 at counter 16. Changing
SARGE to the collector team pays 24 to that one team. Changing it to type 4 or
status 10 clears the partner and pays the collector 25. These are isolated
state controls proving which inputs the consumer reads, not legal gameplay
movement/team-change demonstrations.

## Integration Differences

The existing adapted consumer is intentionally left untouched. Its current
`requiresVisibility: false`, hostile-only/lowest-slot selection, carry-half
ledger, and caller-provided per-frame range boolean are not the native behavior
established here. Do not wire only the geometry predicate and claim fidelity.

An integration can choose an explicitly adapted policy, but must name the
differences. Native-equivalent delivery needs persistent partner ownership,
source-typed deployed collectors, scan-order acquisition, acquisition visibility,
and per-cycle truncation without carry. Direct-pointer retention also means a
new current-range failure is not sufficient to remove an existing native link.

## Reproduction And Limits

Use the **existing complete** dependency directory:

```sh
PYTHONPATH=/tmp/dc-research-native-deps-20260923 \
  python3 -B tools/research/sarge-partner-range-20260923.py --probe \
  > /tmp/dc-sarge-partner-new.json
```

The old `/tmp/dc-re-capstone-20260918/capstone` and
`/tmp/dc-trigger-unicorn-20260918/unicorn` directories on this machine retain
libraries/cache but lack Python package entry files. Their presence does not
prove imports work. No packages were installed or fetched.

Inspection modes include `--disassemble 0x417944 0x417b0c` and
`--references 0x417944`. No-argument mode reports executable type-77/78
comparisons and writes. The parent invocation used a 180-second hard SIGKILL
cap; the completed native matrix took under four seconds.

This is a controlled 128x128 source-constructor/FIN fixture, not an SCN-loaded
mission or whole-world scheduler replay. The acquisition matrix deliberately
varies positions, types, teams, masks, status, and labelled source-field controls.
Deployment, task writes, idle checks, and resource payout functions execute
original machine code. FIN loading uses the repository's established setup
helpers; runtime task/selector/payout functions are not replaced. The nine
animation visits are not a proof of nine whole-game ticks or real-time duration.
Source counter boundaries are explicitly supplied; no original day/night clock
or browser tick equivalence is claimed. Asset preservation and full-game
acceptance are not inferred from this bounded proof.