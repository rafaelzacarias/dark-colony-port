# Complete Native AI Group 0

The isolated, synchronous consumer is
[`consumeLegacyAiGroupZero`](../src/engine/legacy-ai-group-zero.ts).
It completes one group invocation, not a policy tick or an order receipt.
No shared runtime file was changed, including `legacy-ai-active.ts`.

## Pipeline Contract

```ts
import { consumeLegacyAiGroupZero } from "./legacy-ai-group-zero";

const group = consumeLegacyAiGroupZero(state, { groundCells, neighbors });
// group.ready === true; group.nextGroup === 1; group.fullPolicy === false
```

Pass the same state object used by preparation/demand and subsequent group
consumers. The function stages policy/entities, validates canonical member
links, then commits both buffers atomically. It performs no I/O, RNG calls,
callbacks, resource creation, order receipt, movement, deployment, or income.
An exception leaves the input state untouched and publishes no packets.

The returned ordered `events` and `packets` are outputs, not successful order
execution claims. `completeInvocation`, `ready`, and `groupsCompleted: 1`
describe this completed group; `nextGroup: 1` is the next pipeline owner.
`fullPolicy: false` is deliberately independent of group readiness.
`selectedMember`, `selectedResource`, and `selectedRegion` use -1 when absent.
`removedSlots` reports cleanup in canonical traversal order.

## Exact Required Inputs

| Input | Required representation and native source |
| --- | --- |
| `state.policy` | Writable `Uint8Array(0x6c40)` at the post-preparation/demand group-0 boundary. Region records, rank bytes, owner/strength fields, callback pointers, and group-1 fallback target must be actual current policy state. |
| `state.entities` | Writable `Uint8Array(800 * 220)` from game `+0x7d28`, all slots, including current resource actors. No separate resource list or generated source actors. |
| `state.navigation.width/height` | Integer MAP dimensions 1..256. |
| `state.navigation.families` | `Uint8Array(width * height)`, y-major, resolved from the actual row-pointer table at map `+0x1404`, each 24-byte cell's `+12` family byte. |
| `state.navigation.nextFamily` | All 65536 bytes at map `+0x884a8`; index `origin * 256 + target`. |
| `inputs.neighbors` | All 8192 bytes at map `+0x984a8`: 256 records of 32 bytes. Each record starts with an explicit count 0..31, followed by exactly that many family bytes. Unused tail bytes are not edges. Do not derive substitutes from distances. |
| `inputs.groundCells` | `Uint32Array(width * height)` of current native ground words, resolved through map `+0x804` row pointers. Decode little-endian source words; only low ten bits determine vacancy here. |
| `state.rngCursor` | Existing pipeline integer 0..255, preserved. No RNG table is required: native group 0 reads/writes neither table nor cursor. |
| `state.forceOrder` | Existing pipeline byte, preserved and not read by native group 0. |

All buffer spans must be nonoverlapping; disjoint views of one backing buffer
are allowed. Canonical head/tail and entity `+d2/+d4` links are mandatory.
State-0 linked members, invalid predecessors/tails, cycles, unknown callbacks,
invalid dimensions/counts, and out-of-map accessed actors fail closed.
Unreachable next-family routes return native score -1; cyclic routes reject
instead of hanging. The fallback dword at policy `+319c` must be 0..255 when
an unsafe assigned mobile extractor needs it.

No type, weapon, damage, dependency, team-city, alliance, or visibility table
is read by these four native callbacks. Those source tables belong to upstream
preparation/demand. The per-actor owner byte, not a guessed caller team, controls
the route score. Policy allied-observer bytes at `+6c38` are retained but do not
exempt another owner's strength in this callback.

## Native Behavior

Callback order is `4578a0`, `44bbdc`, `44b920`, `4598b0`.
The first two reuse the existing accumulator/cleanup helper; `44b920` is a
literal no-op. Maintenance is inside `4598b0`:

- Every remaining member updates `+cd/+ce/+cf`. Stationary `+cf` increments
  modulo 256, without the other groups' cap at 60. Moving resets it to zero.
- Types 6/14 clear the objective when the updated unsigned counter exceeds
  10. Otherwise, nonzero assigned objectives run native route scoring.
- A nonzero score, including -1, emits a fallback order to representative
  coordinates of policy `+319c`, then clears the objective. Types 47/48 and
  other types retain their objective; they still update the stationary fields.
- Select the last zero-objective member in linked order, irrespective of type.
  Exclude all remaining members' assigned family bytes, including zero.
- Scan all 800 source entities ascending. Require type 40, nonzero unsigned
  rate word `+32`, state other than 0/10, and ground low bits equal to 1023.
  Read family from its actual path cell. Use unsigned rank `region*18+13`,
  initial best 256, strictly better ranks only, and zero route score.
  Equal ranks keep the earlier resource slot.
- Write the chosen family to the selected member's `+11` and emit the resource
  actor's exact fixed-point coordinate words, including fractional bytes.

`45817c` marks the route and its counted neighbors, copies that complete mask,
then adds neighbors of marked regions 1..255. It sums each final region once,
using unsigned word `+10` when signed owner byte `+8` is neither -1 nor the
acting member's owner. It does not use Euclidean distance, alliance tables,
synthetic success callbacks, or threat-radius approximations. The isolated-node
native golden discriminates full mask copying from a misleading single-`movsd`
reading of the disassembly.

Every packet is exactly 17 bytes before transport sequencing:

```text
11 00 07 01 01 00 XX XX YY YY SS SS 05 SS SS 02 00
```

The fallback uses representative coordinate bytes shifted by eight; resource
selection uses the source actor's coordinate words. Multiple fallback packets
precede the one possible new resource order in canonical member order. This
does not consume packets or mutate entity destination/task state.

## Verification

The [native probe](../tools/research/ai-group-zero-20260919.py) executes original
callbacks, route scoring, and packet construction. It intercepts only transport
submission at `421725` and resumes its epilogue at `421767`; it never replaces
a decision or unit-order executor. Executable SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The existing source fixture pins both missions' SCN/MAP/PTH hashes. The probe
exports pointer-resolved family cells and the native counted graph.

The [focused tests](../tools/qa/legacy-ai-group-zero.test.ts) compare every policy
and entity byte, exact ordered packets/helper entries, RNG cursor, force byte,
and zero native RNG-memory accesses. Controls cover selection, all source
rejection predicates, unsigned ranks/ties, slots 0/799, same/missing/zero-family
routes, two-ring masks and duplicate edges, graph counts/tails, own/other/signed
owners, mobile/deployed maintenance, counter 9/10/254/255, moving reset,
fallback plus reassignment, linked cleanup, and atomic rejection.

Original action captures HUMAN02/team 2/frame 14124 and ALIEN02/team 1/frame
1160 compare full before/after policy/entities with the historical snapshots.
Both have empty canonical group-0 lists: they prove real action-boundary no-op
parity, not native extractor availability. Historical dynamic ground is not
claimed: these empty invocations do not read it. Nonempty cases are explicitly
controlled native fixtures with original resource rows, not whole-world replay.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/research/ai-group-zero-20260919.py \
  --natural-trace /tmp/dc-ai-gap-natural-human-20260919-25.jsonl \
  --natural-trace /tmp/dc-ai-gap-natural-alien-20260919-24.jsonl \
  > /tmp/dc-group0-native.jsonl
DC_AI_GROUP_ZERO_TRACE=/tmp/dc-group0-native.jsonl \
  node --import tsx --test tools/qa/legacy-ai-group-zero.test.ts
node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 \
  --module ESNext --moduleResolution bundler --lib ES2022,DOM \
  src/engine/legacy-ai-group-zero.ts tools/qa/legacy-ai-group-zero.test.ts
```

Without a cached trace, the tests regenerate the controlled native oracle.
Optional `DC_AI_GROUP_ZERO_NATURAL_TRACES` is a JSON array of historical capture
paths to add when regenerating. Runtime imports are extensionless. No browser,
agents, full-suite run, shared policy admission, or production/resource host
integration is part of this change.