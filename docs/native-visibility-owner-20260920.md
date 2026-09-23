# Original Visibility Owner

## Status

Implemented a pure, source-separated **ground visibility caller**, not full original mission admission.
Changes are restricted to [owner](../src/engine/legacy-native-visibility.ts),
[source configuration](../src/engine/source-native-visibility.ts),
[native probe](../tools/qa/native-visibility-native.py), and
[tests](../tools/qa/legacy-native-visibility.test.ts). No host/session/view changes.

The authenticated profiles admit types **0, 2, 8, 10, 16, 17, 28, 29, 41, 69, 73, 81,
84, 86, 89, 91**, with status 1 and zero detection/metadata classes. Ground mobile profiles
require altitude zero; pinned city profiles also admit the original constructor altitude
600. This does not admit aircraft. Fresh original HUMAN02 and ALIEN02 now match with
**every eligible producer selected and no exclusions**. Every SCN actor remains in its
original slot. Optional exclusions remain an explicit bounded experiment contract, not
proof that the original game would skip an actor. Host/session/view admission is unchanged.

## Native Contract

- `0x419a30` tests `game+0x94c & 15`. On zero, `0x419a39` calls `0x4456f0`,
  then `0x419a41` calls `0x44a6d4`. The caller slice ends before `0x439f40`.
- Clear is unsigned `ground & 0x807fffff`. Bits 23..30 are current team sight;
  bit 31 is persistent **local exploration**, not current visibility.
- Compute resets `actor+0xca` for every active slot **through** high-water inclusive.
  Producer filtering uses status, team <=7 and `actor+0xcb` not 1/2.
  `0x454db8` subsequently scans **below** high-water, not inclusive.
- Radius is `(daylight * type[0x10] + (256-daylight) * type[0x14]) >> 8`.
  Source type 0 night/day radii are 4/7; type 8 radii are 7/4; 69 is 8/10 and 73 is 10/8.
- `0x44a6d4` dispatches by `(type+0x60 != 0)*8 | (type+0x6c != 0)*2 |
  interior*4 | local`. It does not dispatch by type ID or read `type+0x64` here.
  The existing configuration field `flight` names the byte at +0x60 for compatibility;
  it is **not an aircraft classifier**: original CITY rows also set it to 1.
- Occluded ground profiles dispatch to `0x4489cc` local or `0x448e44` nonlocal in the interior;
  the corresponding border branches clip tree nodes rather than replacing the metric.
  The implementation follows the actual EXE tree rooted at `0x488fc8`, using child
  order/displacement and depth, not Manhattan, Euclidean, Bresenham, or a generic FOV library.
- Pinned city types 16/17/28/29/81 dispatch to `0x4463e0` local or `0x446844` nonlocal
  in the interior, `0x4476c8`/`0x447b60` at borders. They use the same tree and center,
  but expand children **without testing bit 29**, not a rectangular building footprint.
- Terrain is read with inverted map Y. Bit 29 permits occluded-ground child expansion; bit 30 at depth
  >=2 removes the team sight bit while retaining local exploration. Local producers
  clear bits 10..17 on each visited cell; nonlocal producers do not. Occupancy low 10
  bits and all unrelated flags are preserved. `actor+0x10` temporary team reveal uses
  the original mask logic; that field is never fabricated by the positive fixtures.
- Current local team, local alliance mask, daylight and both reveal override bytes
  are explicit inputs. Reveal overrides must be zero. No clock conversion or fake 20 TPS.
- Both RNG domains are unchanged. The native capture rejects writes outside stack,
  ground, and the exact actor detection byte. Pools, type tables, registry, high-water,
  terrain, air and extra planes are not mutated by these visibility phases.

The source-initialized `type+0x78` metadata class is zero for all 106 rows in this
captured source-world setup. The final metadata pass is retained; positive parity includes
its actual zero-class behavior. Stale ground metadata and nonzero actor detection bytes
are separately tested as labeled controls, without setting sight/exploration bits.
**Nonzero runtime metadata classes are not authenticated or admitted by this configuration.**
Do not interpret the generic final-pass code as evidence for a later nonzero-class world.

## Source Ownership

`createSourceNativeVisibilityConfiguration` requires actual EXE, GAMESTAT, SCN, MAP,
BTS, MTG and PTH bytes. It pins their hashes to original HUMAN02/ALIEN02 and DESERT,
copies bytes before asynchronous hashing, derives radius trees from PE sections and
type fields from source rows, and returns a deeply frozen identity-authenticated object.
An oracle JSON snapshot or cloned/edited configuration is not an accepted source config.
PE uninitialized-data sections are zero, not file-offset-zero data.
The additive readonly `producerProfiles` map binds only the 16 proved type IDs to
`ground-occluded` or `ground-unpruned`, after checking their source dispatch fields.
It is part of the frozen factory identity, not caller-supplied permission or a serialized
trust token. `kind` remains `source-native-visibility-v1`; result scope is now
`source-separated-ground-visibility`.

The native probe executes `0x453421..0x453790` with real MAP bytes and the real BTS key
lookup before full original SCN construction. It supplies only file-read and allocation
boundaries for that loader; there are no visibility algorithm/helper stubs.
Source terrain packing includes background/foreground indices, height/attributes, the
native default bit-29 setting, and zero-height normalization for absent foreground.
SCN construction subsequently changes bit 26 in four HUMAN02 cells. The API consequently
separates immutable loader terrain from current terrain and allows only this bit to differ.
Source height and all other terrain bits must still match. PTH families are authenticated
and retained; visibility does not consult PTH instead of the original terrain algorithm.

The configuration authenticates static sources, **not arbitrary current actor buffers**.
The consuming source-world owner must retain/authenticate the complete original SCN
registry, generations and all subsequent lifecycle mutations. Dynamic actors in the
probe are real `0x41b750` constructors; moving cases use `0x41defc` plus eight actual
registered `0x419248` visits. There are no copied oracle actor seeds in runtime config.

## API And Transaction

`reduceLegacyNativeVisibility(frame)` takes all 800 raw 220-byte actor records, the
800-slot registry, full ground/air/extra/current terrain planes, high-water, native
counter, local team/mask, daylight, reveal flags, combat RNG cursor and CRT seed.
The registry contains each occupied slot's own index or -1, without reindexing.
`producerSlots` and `excludedProducerSlots` are ascending, disjoint and must partition
all native-eligible producers exactly. Missing, duplicate, unsupported selected or
invalid source profiles reject before publication; caller arrays remain untouched.

`phase: "caller"` applies the original counter predicate and orders clear before compute.
`"clear"` and `"compute"` expose actual standalone native phase boundaries for explicit
orchestrators/replay, not implicit timing. Results contain detached planes/raw actors,
ordered writes (including writes of the same value), producer radii, executed phases,
unchanged RNG values and an empty draw list. A rejection has no partial result.
The lower-level `clearLegacyNativeVisibility` is only the separately proved mask operation.

## Original Bounded Evidence

Final trace: `/tmp/dc-visibility-matrix-own31.jsonl`

SHA-256: `66bf4aeab4b08ce1d9e919ee871ea2298aee916bc29e427da8d7bd1cbe66a22c`

28 native cases, 196,473 ordered writes compared, 34 focused tests passed, no skips.
Cases cover both types/races, stationary/moving, daylight 0/128/256, map borders,
real source blockers, multiple registered producers, nonlocal/allied masks, detection
reset, stale ground metadata and counters 0/1/15/16/17/31/32/0xfffffff0/0xffffffff.
Every comparison includes all actor bytes, all ground words, ordered writes and both
unchanged RNG domains. Source terrain/type fields are separately compared to native.

| Native Case | Compute Explored / Team0 Sight | After Clear | Natural Victim Cell |
| --- | --- | --- | --- |
| HUMAN stationary, daylight 0, producer 170 | 149 / 149 | 149 / 0 | slot 171, cell 4677: `0x000000ab -> 0xc00000ab` |
| ALIEN stationary, daylight 0, producer 193 | 49 / 49 | 49 / 0 | slot 194, cell 4677: `0x000000c2 -> 0xc00000c2` |
| HUMAN source occlusion | 104 / 104 | 104 / 0 | Source MAP blocker, no terrain edits |
| ALIEN source occlusion | 46 / 46 | 46 / 0 | Source MAP blocker, no terrain edits |

HUMAN stationary full-ground hash after compute and recompute:
`082cd4ff752b1d3935d7492128419796a04b1fa9aa03311101d954fcb2d23ffe`.
ALIEN equivalent:
`6b589683670e8517f66a58c2a202b1624dd38a5c0009cfab1739e32a58169083`.
All 28 compute/clear/recompute sequences reproduce their complete compute snapshots.

There are 16 constructor-backed victim cases. Original `0x431da8` returns silently
before exploration, then reaches **`0x431e08`, the call to `0x431bf4`**, after compute
AND after clear. The probe stops before playback; it does not stub the gate, manufacture
visibility, dispatch sound, run a lethal transition or claim CRT initialization.
The historical CRT bootstrap seed-1 proof at `0x469754` is independent of this owner.

The earlier read-only `/tmp/dc-visibility-positive-20260920-r6.log` remains historical
411/411, 411/0 evidence. The fresh capture below independently reproduces those counts
without reducing the producer set. Neither trace is a runtime actor seed.

Focused log: `/tmp/dc-visibility-matrix-tests-own32.log`.
Strict scoped TypeScript/no-unused check: `/tmp/dc-visibility-final-types-own33.log`, exit 0.
Exact summary: `/tmp/dc-visibility-evidence-own34.json`.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/native-visibility-native.py --matrix > /tmp/visibility-native.jsonl
DC_VISIBILITY_MATRIX=/tmp/visibility-native.jsonl \
  node --import tsx --test tools/qa/legacy-native-visibility.test.ts
```

## Full Ground Producer Evidence

The first new fresh HUMAN02 test failed on the unchanged reducer with
`unowned-native-visibility-producer` (`/tmp/dc-vis-ground-first-g03.log`). The new capture
uses original full SCN construction, no additional actors, no producer-loop interception,
no actor-status edits, no forced exploration and no visibility helper stubs. The actual
caller is restarted from its identical initial actor/ground snapshot after standalone
clear/compute/clear/recompute. Each of those five phases records its own before/after
snapshot, ordered writes, calls and complete worker-entry actor/ABI arguments.

| Original World | Registered Active | Eligible / Selected | Excluded / Unsupported Eligible | Types Actually Present Among Producers |
| --- | --- | --- | --- | --- |
| HUMAN02 | 21 | 14 / 14 | 0 / 0 | 8, 16, 17, 81, 84 |
| ALIEN02 | 44 | 41 / 41 | 0 / 0 | 0, 2, 8, 10, 28, 29, 41, 81, 86, 89, 91 |

These are not 31 producers. Fresh HUMAN02 has neither type 1 nor commanders 69/73.
HUMAN slots 153..155 (type 86, +0xcb=1) and neutral team-8 VENT slots 166..169
are natively ineligible, not excluded. ALIEN neutral slots 190..192 are likewise
ineligible; no original eligible aircraft were found in this source setup. Unsupported
air/special classes were not relabeled as ground. Commanders 69/73 have separate real
`0x41b750` constructor-backed cases, retaining all original actors.

| Daylight | HUMAN Explored / Team0 Sight | ALIEN Explored / Team0 Sight |
| --- | --- | --- |
| 0 | 411 / 411 | 452 / 452 |
| 128 | 270 / 270 | 428 / 428 |
| 256 | 214 / 214 | 503 / 503 |

Clear preserves each explored count and removes all team sight; recompute reproduces
the entire previous snapshot. HUMAN daylight-0 full-ground SHA-256 is
`7a478c55d486418c9b0b1fd19c53e84813a49d299c97db0c187ecbb7162a4c5b`;
ALIEN is `3077add669d159575dac41ec49ed97d1a77b1f3d05d3c08a79474f419c988a6e`.

New golden: `/tmp/dc-vis-ground-matrix-g21.jsonl`, SHA-256
`c206618bed6e596b5f7df9af07854dd3d5a4e4374857a7485dfe2d3a1ad8279b`.
**37 native cases, 185 phase comparisons, 1,038,548 ordered phase writes**, of which
311,226 are caller writes. Coverage includes both full original worlds, daylight
0/128/256, counters 0/1/15/16/17/31/32/0xfffffff0/0xffffffff, local/nonlocal/allied
commanders, native commander occlusion, city border workers and stale metadata controls.
All eight admitted worker entry points, their radii, argument stack and entry raw220
records are checked. All 800 actors, registry, all planes, terrain, RNG domains and
unchanged caller inputs are compared per phase.

The additional **labeled high-water control** lowers only the bound to the actual
constructor-created commander slot and seeds stale +0xca bytes. The actor at that
inclusive endpoint must be reset and dispatched; this is a control, not a fresh SCN
startup claim. Fresh-world captures keep original high-water values 170/193 intact.
Nonzero type metadata is still not admitted or claimed by the zero-class final pass.

The old 28-case golden remains byte-for-byte unchanged: same SHA-256 above and
196,473 caller writes. Combined owner tests: **75 pass, zero failures/skips**,
`/tmp/dc-vis-ground-all-owned-g23.log`. Strict/no-unused scoped check:
`/tmp/dc-vis-ground-types-g25.log`, exit 0. Counts/hashes:
`/tmp/dc-vis-ground-evidence-g27.log`.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/native-visibility-native.py --ground-matrix > /tmp/visibility-ground-new.jsonl
DC_VISIBILITY_GROUND_MATRIX=/tmp/visibility-ground-new.jsonl \
DC_VISIBILITY_MATRIX=/tmp/dc-visibility-matrix-own31.jsonl \
  node --import tsx --test tools/qa/legacy-native-visibility.test.ts
```

## Integration Hop

**Handoff to the main host owner, not implemented here:** replace any remaining
hardcoded 0/8 admission with the authenticated profile map, retaining the externally
attested complete source/current world and current type-table checks at +0x10/+0x14,
+0x60/+0x6c and zero +0x78. Do not admit a city by assuming `flight === 0`, infer an
actor profile solely from its ID, or bypass current lifecycle/altitude guards. Account
for the new result scope and additive readonly map in schema/canonical/replay checks;
restore must reacquire the source factory identity. Pure full-source parity is not
permission to broaden combat, AI, production, session or view admission automatically.

1. The source host must supply its already-authenticated full actor/registry/current
   terrain snapshot and the actual game visibility-counter phase, not reconstructed UI fog.
   Pin the source configuration externally again on restore; do not serialize trust.
2. Stage this caller in the same candidate transaction as task/combat/death owners,
   preserving original phase order. Journal counter, phase, local mask/daylight,
   producer partition, inputs and ordered writes. A repeated counter is not automatically
   deduplicated by this stateless pure function; scheduling/history belong to the host.
3. Replace the candidate ground plane and raw detection bytes together. Give the death
   sound owner that exact committed-history ground plane. Its bit-31 test can consume
   the naturally explored victim cell without forced flags or a view-side visibility test.
4. Commit the outer transaction before publishing sound requests. Replay every phase
   with fresh source configuration; never restore exploration from unauthenticated flags.

Still closed: all type IDs outside the exact admitted list, aircraft, special detection,
dying-producer radius decay, nonzero current metadata classes, reveal-all overrides,
terrain mutation beyond the admitted source bit-26 changes, `0x439f40`, whole world-service
scheduling and new host/session/view admission. Precisely unadmitted source IDs (90):
1, 3..7, 9, 11..15, 18..27, 30..40, 42..68, 70..72, 74..80, 82..83, 85, 87..88,
90, 92..105. Neutral team-8 resource actors remain ineligible regardless of type profile.
A complete running mission still needs externally owned current metadata, lifecycle,
shared scheduling and authenticated history. This change does not enable it.
No browser/OS window, agents, full suite, package or asset changes were used.