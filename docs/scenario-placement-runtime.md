# Native SCN Initial Placement Allocation

Established on 2026-09-19 by the original DC.EXE instructions, SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

- Probe: [scenario-placement-20260919.py](../tools/research/scenario-placement-20260919.py).
- World state: [campaign-world.ts](../src/engine/campaign-world.ts).
- Shared initial allocator: [campaign-session.ts](../src/engine/campaign-session.ts), `initializeCampaignPlacements`.
- Goldens: [scenario-placement.test.ts](../tools/qa/scenario-placement.test.ts).

## Native Execution Contract

The probe runs every original placement row, in order, from HUMAN01, ALIEN01,
HUMAN02 and ALIEN02. It executes the real scanner at `0x41c453`, registration
routine, entity constructor, and loop tail through the return to `0x41c438`.
No placement row or SCN/TRO file is removed, rewritten or normalized. Calls in
this path are observed, not stubbed. Source type records come from the existing
native type-parser harness. The executable loader is hash-gated.

This is a component execution, not a complete game boot: mode 0, fresh RENAT and
type-37 queues, explicit team races, synthetic empty map planes, and resource
scales 256. The type scanner's CRT input marshalling is inherited from that
harness; the SCN integer scanner itself executes. Every emitted entity includes
its full native 220-byte record for inspection.

## Fourth Field -1

At `0x41c4f1`, fourth field -1 dispatches **before** special entity types. The
call to `0x43fd50` registers a RENAT source; it does not create an entity and does
not consume a slot. This also applies when column three happens to be 40.
The optional sixth field is not an argument to this routine.

The native global count is `0x4796b0`; records begin at `0x4fe06c`, stride 40:

| Offset | Initial registration effect |
| --- | --- |
| +0 byte | Initialized/visited flag set to 0 |
| +4 i32 | Tile x |
| +8 i32 | Tile y |
| +12 i32 | Type |
| +16 i32 | Requested population, from fifth SCN field |
| +20..39 | Ten u16 member slots; registration does not write them |

The native assertions require population <10 and fewer than 25 existing sources.
The runtime supports populations 0..9 and 25 sources; negative populations fail
explicitly. Its fresh table is 1000 zeroed bytes, so unwritten member slots stay
zero. This is not a saved-table restoration contract.

The real `0x43fe6c` population getter is also executed: HUMAN02 totals 14 and
ALIEN02 totals 6. The disassembled later consumer `0x43feac` initially calls
`0x41b634` once per member with owner 9, records returned slots, and marks the
source initialized. Later instructions handle member loss, movement and respawn.
That later consumer is **not executed or integrated here**. Initial registration
must not eagerly allocate those future members or pretend the source is a unit.

`CampaignWorld.placementState` preserves source row identities, x/y/type/count,
and the exact initial `renatBytes`. The original source rows remain unchanged.
This state is distinct from ordinary entities and owner-8 resource records.

## Cursor And High-Water

EDI is the placement cursor; `game+0x7d20` is the high-water count. The scanner
first clears status `+0x2c` at the candidate slot even for a nonentity row.
The integrated initial allocator starts with fresh zeroed entity bytes.

| Branch | Cursor | High-water |
| --- | --- | --- |
| Fourth field -1 | Unchanged | Unchanged; jumps directly to reader |
| Type 40 | Construct owner 8, then +1 | max(previous, cursor) |
| Ordinary, mode 0 or 3, no coordinate capture | Construct, then +1 | max(previous, cursor) |
| Type-37 coordinate capture of an ordinary row | Unchanged; append type to queue | max(previous, cursor) |
| Other mode, disabled team | No entity, but +1 | max(previous, cursor) |

The latter two behaviors are established by synthetic native executions. A
type-37 source itself constructs owner 8, ignores field six and registers its
coordinate when selector 6 is positive or the parser's local gate is zero;
otherwise the disassembled branch skips it without advancing the cursor.
The runtime explicitly rejects type 37 and modes outside 0/3 because it does
not own their queue/gate/participation state. It does not guess their slots.

`createCampaignWorld` accepts explicit `placementInitialization` with `firstSlot`,
optional existing `highWater`, and mode 0/3. Resource initialization must agree on
`firstSlot`. Entity slots use the actual cursor, never `firstSlot + sourceRow`.
Both counters are retained separately: the native synthetic case starting at
231 with high-water 250 ends at cursor 234, high-water 250, despite a RENAT row
between entities. The session passes the resulting high-water to the resource
and transport host. That host's existing upper bound of 799 remains an explicit
session restriction; this change does not change its allocator.

## Counterparts And Sixth Field

For fourth-field values 0..7, native code compares team race with type `+4`.
On mismatch, type `+0x114` replaces the requested type unless it is -1. The
counterpart is `rawTail[20]`, verified against all 106 parsed native type records.
Substitution happens once, before special dispatch, and fifth/sixth fields are
not rewritten. Missing required race/counterpart definitions fail explicitly.

The sixth integer defaults to zero on **each** row. Ordinary construction stores
its low byte at entity `+0xcb`; the probe verifies 257 -> 1. Type 40 and type 37
pass zero instead, while RENAT registration ignores the field entirely (tested
with 999). The runtime retains the original tail and writes the correct initial
byte. Ordinary negative HP overrides use the selected type's default HP, as
confirmed with -2 as well as shipped -1 values.

## Golden Results

Counts below exclude reserved colony slots and future RENAT members:

| Complete source | Rows | Entities | RENAT sources | Next slot / high-water |
| --- | ---: | ---: | ---: | ---: |
| HUMAN01 | 33 | 33 | 0 | 185 |
| ALIEN01 | 46 | 46 | 0 | 198 |
| HUMAN02 | 20 | 18 | 2 | 170 |
| ALIEN02 | 43 | 41 | 2 | 193 |

HUMAN01 and ALIEN01 keep every entity-only slot at `152 + sourceRow`.
HUMAN02 resource slots are 166,167,168,169. ALIEN02 resource slots are
190,191,192; the two RENAT rows between the first and second resource do not
consume slots. The resource at (4,80) belongs to ALIEN02, as the original SCN
and complete native stream establish.

Tests pin source SCN hashes and native byte hashes, not just object counts. The
entity projection consists of slot u16, position x/y u16, type/owner bytes, HP
dword, status byte, and byte +0xcb; resources additionally include rate +0x32 and
initial countdown +0x46. Full 40-byte RENAT records are matched exactly. These
are **not** claims of parity for all 220 constructor bytes, animation pointers,
collision planes or subsequent runtime behavior.

## Integration Outcome

All four complete placement streams initialize through the shared allocator.
HUMAN01/ALIEN01 retain their prior session behavior and native slot indices.
ALIEN02 also passes session initialization in the placement-only fixture.
Owner-8 resource rates/reserves and host high-water remain consistent.

HUMAN02 full session initialization still fails explicitly with
`colony team 0 requires five City pairs`: its unchanged `%City` rows contain six
pairs, outside the existing colony projector's supported contract. No pairs are
dropped and the colony module is not edited. The placement fixture supplies no
trigger program; neither mission02's trigger/controller admission nor complete
playability is certified. No trigger/controller/main/game-data/view code changed.

Verified: native complete-stream and synthetic assertions; 40 focused tests
(placement, world, session and resource-host); strict type-check of the two
runtime entry points. No browser, agents or full suite were used.

## Reproduction

Run from `/Users/rafael/Downloads/darkcolony`, keeping each output log unique:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/scenario-placement-20260919.py \
  > /tmp/scenario-placement-native-$(date +%Y%m%d-%H%M%S).log 2>&1
node --import tsx --test --test-isolation=none tools/qa/scenario-placement.test.ts
```