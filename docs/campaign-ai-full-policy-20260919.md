# Reviewed Boundary Follow-Up

The exported transaction now rejects demand/pipeline stages whenever full-policy
configuration is supplied. It cannot bypass shared-pool checks through a partial
stage. `advanceTransportHost` rejects pending native AI ownership before changing
elapsed remainder, including 0/1/15 ms calls. Regression tests preserve the entire
input world on rejection. Native task execution is still unsupported; these
guards close API bypasses, not the remaining owner implementation. Final project
gate passed 2,035 tests with four skips, plus typecheck and build.

# Campaign Full-Policy Receipt Boundary

## Receipt Integrity And Migration

`CampaignAiReceipt.integrity?: string` is the only new receipt field. Every new
committed demand, pipeline, or full-policy receipt contains a lowercase 64-digit
SHA-256 digest. The optional type/checkpoint field exists solely for old snapshots;
the low-level transaction rejects a missing digest, including on an exact retry.
It never seals an arbitrary supplied history. No checkpoint version bump is needed.

Runtime hashing uses synchronous `@noble/hashes` **2.4.0** (`sha2.js` and
`utils.js` exports), compatible with Node 24 and the Vite ES2022 bundle. The lucide
dependency declaration is unchanged. There is no Bun dependency, asynchronous
WebCrypto requirement, custom hash, secret, or signature API.

The digest covers the entire structured receipt except its top-level `integrity`
property, including the full computation, candidate, packets, groups, RNG and
disposition. Canonical bytes are ASCII JSON: object keys sorted recursively by
JavaScript UTF-16 lexical order, array order preserved, JSON primitive encoding,
and every code unit U+007F through U+FFFF escaped as lowercase `\uXXXX`.
Only finite numbers and plain data objects/dense arrays are accepted. Sparse or
extended arrays, undefined, functions, symbols, accessors, hidden properties,
cycles, typed arrays, class instances and proxies are rejected. Descriptor checks
avoid ordinary getter execution; structured cloning rejects proxies. This is a
data-validation boundary, not a sandbox for executing hostile Proxy traps.

Integrity is checked before low-level duplicate detection, session duplicate
returns (including pending hand-off), and source history recomputation. Full-policy
history additionally cross-checks native intent presence, source production
packets, decoded actor orders, ordered group/packet counts, group RNG totals,
candidate bounds, disposition and unchanged computation-only readiness flags.
Matching a digest does not excuse contradictions in those summaries.

`validateCampaignAiSession(...)` now returns a `CampaignAiSessionState` containing
normalized receipts, without mutating its input. It first checks any present
digest, recomputes each complete receipt from the externally expected source
configuration and retained original inputs, and compares both the reconstructed
content and digest. A missing legacy digest is permitted only on this source
recomputation path. The returned seal comes from the reconstructed receipt, never
from trusting the old one. Ledger/buffer validation must also succeed.

`CampaignSession.restore(value, expectedCampaignAi, expectedNativeAiTasks?)` keeps
its existing arguments and adopts that normalized history. Full-policy and native
task whole-caller replay gates remain in place, comparing the normalized state.
The caller's checkpoint remains unchanged; the next checkpoint contains the
digests. This also migrates demand/pipeline receipts and receipts whose paid unit
has already been allocated. Low-level owners with legacy receipts must restore
through the source-aware session path or use the successfully returned normalized
source validation result; retry alone cannot migrate them.

This protects against accidental or inconsistent receipt mutation, **not against
an attacker coherently rewriting data and recomputing its digest**. It does not
authenticate the user or checkpoint and does not change mission admission or
native task ownership. Source recomputation remains necessary on restore.

Focused regressions cover the reviewer's packet/candidate/group/RNG/disposition/
null-intent mutations, matching-digest structural contradictions, sparse/non-JSON
graphs, independent Node SHA-256 parity, recursive key order and ASCII escaping,
legacy migration, source-divergent resealing, and JSON-cloned retries after actual
native FIN allocation for both races.

## Admission

**Original-mission AI must remain blocked.** This source-separated bounded host
now owns the complete `computeLegacyAiFullPolicy` call and atomic native receipts,
not native actor task execution. A targeted receipt leaves
`pending-native-task-hand-off`; the next fixed host step rejects atomically.
`readyWholeCall: true` certifies computation, never mission/runtime readiness.
Original preflight and the mission AI decoder were not changed.

## Full Profile

`CampaignAiConfiguration.fullPolicy` supplies the original counted neighbor graph,
256-entry RNG table, 216-byte rule table, policy allocation address, and explicit
`actorTransport: "deferred" | "synchronous"`. Existing `sources` supply complete
GAMESTAT, WEAPSTAT, DEPEND, City dependencies, MBULLET and PTH definitions.
The session verifies the PTH dimensions/families against its own path source.
`initial.rngCursor` is mandatory for this profile. The team policy pointer decides
whether initialization is required: zero runs native initialization; nonzero must
match the configured allocation. There is no flag to skip initialization.

Requests use `stage: "full-policy"` and the existing stable ID, contiguous sequence,
source ID and observation contract. The full profile rejects demand-only stages.
RNG and force state are committed by the session; a request cannot replace the
owned force value. No receipt, debit, packet or certification callback is accepted
as a public session input.

The **entire 800 x 220 observation buffer** must equal current world `entityBytes`
at AI entry, after that frame's host/resource work. Active slots must have actual
world/host identities with matching generation, registry, type, team, position,
status and health. A source fixture containing extra policy actors cannot be
grafted onto an unrelated live world. Tests construct the originally referenced
harvesters at slots 152/153 and their recorded positions using normal placement
and host constructors; every policy byte then comes from that world.

Dynamic observations remain explicit caller inputs. For a resource frame, its
observation must describe the state after resource advancement; the tests obtain
this deterministically with a session fork, without modifying the real session.
This is not an original mission scheduler or a shared global game RNG admission.

## Atomic Ownership

The existing `transactCampaignAiProduction` function, called by `stepCampaignAi`
and `CampaignSession.step`, now branches into the full native caller. It stages
initialization, preparation, demand and groups 0/1/2/3 in order. Native computation
is preserved in the receipt: all groups/events, complete candidate policy/entities,
native team bytes, RNG cursor/draw count, force state and ordered packets.

Mode 10 uses the existing prepaid FIFO path with no second debit, no UI dispatch
and no synthetic spawn. Source FIN producer visits own completion and actual
slot/generation allocation. Unsupported mode 9 returns `unsupported-city` and
discards the complete candidate, including RNG, initialization and actor receipts.

`receiveTransportHostAiPolicy` validates every packet target against the actual
host and world identities. Deferred packets run `applyLegacyAiActorPacket` on
the shared candidate; synchronous candidates already contain those exact native
receiver writes. Mode 5 writes `+0x36/+0x37`; mode 7 writes ordered waypoints at
`+0xa6/+0xa8` and count `+0xc6`. The receiver does not write AI order field `+0x11`.
Resource task pending-order fields are updated alongside the raw bytes, preventing
their normal projection from erasing a receipt. Active native movement remains
an explicit rejected boundary, not a substituted movement command.

Packets with zero recipients are valid native emissions but do not create a
pending hand-off. Targeted packets mark their actual `HostSlot`. Both fixed-step
and elapsed-time host entry points reject before ticking while any such hand-off
is unowned. The receipt frame's producer/trigger work still runs transactionally;
a late failure rolls back everything. Raw synchronization is tested not to erase
the receipt. Ordinary placement and production constructors now initialize native
AI membership sentinels `+0xd2/+0xd4 = -2`, verified with the original constructor.

## Journal And Restore

Frame output includes `campaignAiReceipt`. Durable AI history stores the native
computation and receipt disposition. Team credits/accounting/FIFO/flags are
projected from production; full-profile entity buffers track the actual world,
including later spawns. Exact retries never rerun computation, draw RNG, debit,
enqueue or allocate twice. A retry while hand-off is pending is a receipt-only
operation and cannot carry unrelated state-changing inputs or advance the clock.

Full-profile snapshots additionally retain `campaignAiInputs` for every committed
session frame. Restore requires the externally supplied exact configuration,
recomputes each native result, reconciles the production ledger, and then replays
the complete caller history from constructors and compares the entire state.
This checks receipt raw bytes, pending task records, identities, resources,
producer completion, RNG and triggers together. It deliberately costs history
space and replay time; it is not a compact production campaign checkpoint format.
Direct `commandResource`/`resumeResourceIdle` mutations are rejected in this
profile because they are outside that journal. Journaled step inputs remain the
owned transaction boundary.

## Missing Task Owner

Enabling original missions requires a native dispatcher that accepts these exact
queued orders/waypoints on the same identities and executes the corresponding
idle/wait, cancellation, route/path reservation, movement, harvesting and combat
tasks with source FIN/auxiliary state, collision, timing and shared RNG ownership.
It must journal the transition from pending receipt into the native task stack,
consume pending fields only at the native accepting task boundary, and restore
and resume that state without skipping or duplicating work. Clearing the marker,
assigning a view/simulation destination, or setting a completion flag is not proof
of task consumption. Original scheduling and unsupported production/construction
paths also remain outside this bounded profile.

## Verification

- 12 new focused tests in `tools/qa/campaign-ai-full-policy.test.ts`, no bypass flags.
- `campaign-ai-full-policy-native.py` executes original `0x44be40` and `0x41defc`
  on identical constructor-backed session inputs for both races and both transport
  timings. Complete policy/entity/team bytes, initialization, packet order, RNG
  and force match; actual received world bytes and accounting/FIFO also match.
- Native FIN completion and one real slot-154 spawn, exact retry after restore and
  spawn, source mismatch, mode-9 rollback, late failure and checkpoint tampering.
- Full32 starting funds 100000 and income statistic 70000, live resource income,
  player pending reservation and one native AI debit through nested restoration.
- 74 existing AI, original whole-call/actor receiver, and production-session tests
  pass, including all 32 source FIN directions and full32 accounting projections.
- Strict ES2022 typecheck passes with extensionless runtime imports. No agents,
  browser or full-suite run; no legacy AI, render, view, main or game-data edits.