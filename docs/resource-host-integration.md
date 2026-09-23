# Bounded Resource Host Integration

Implemented 2026-09-19 in campaign-world, campaign-session and transport-host.
Evidence: [resource-runtime-20260919.md](resource-runtime-20260919.md) and
[mission02-action-audit.md](mission02-action-audit.md). The bounded lifecycle is
now implemented in transport-host and verified against the new
[native lifecycle report](resource-lifecycle-20260919.md). This does not accept
either complete mission02 or implement audio playback or general mobile tasks.

## Initialization Contract

- `CampaignSessionOptions.resourceScales` is explicitly `"configured-startup"`
  for the evidenced configuration path (4 shifted by 6, then copied into
  `s(1,0)` and `s(2,0)`), or `{ rateScale, reserveScale }` with signed32 values.
  Absence is not a default of 256: source type 40 then fails initialization.
- Direct `createCampaignWorld` callers supply `resourceInitialization` with
  `width`, `height`, `firstSlot` and explicit `scales`. Slots are assigned in
  placement order as `firstSlot + rowIndex`; session uses base 152.
- Only supported type-40 rows take the special path: five fields, or six with
  final field zero. Fourth field is rate, fifth reserve, owner is 8. Fourth-field
  -1, nonzero sixth fields, out-of-map coordinates and unavailable definitions
  fail. Ordinary placements still require a declared team in 0..7.
- `initializeLegacyResource` performs signed32 product wrap, truncation /256,
  rate-word narrowing and negative-reserve fallback using the supplied type-40
  definition's `health` field (native type record +0x44). Reserve is stored in
  the shared health field but is not treated as combat HP.
- Host slots preserve native status 1 even for reserve zero, owner 8, rate word,
  countdown 65535, idle task 1 and its payload. Native bytes include +0x0c,
  +0x32 and fresh idle payload +0x46. This payload offset is not generalized to
  later tasks. `resourceTileFlags` records bit 0x04000000; a source does not
  occupy the host's ground-unit slot. No extra source team or colony is created.
- Full signed32 statistics persist in controller runtime and world snapshots.
  Census refresh copies them without signed16 projection or resetting selector
  0. Neutral sources are excluded from per-team census and combat victim losses.

## Transactional Newrate

`CampaignResourceRateCommand` is `{ kind: "newrate", rate, tileX, tileY }`.
`MissionWorldCommand` now includes that shape, and the controller decodes exactly
three literal bytes in source order: rate, tileX, tileY. Expressions, fractional
values, wrong arity and values outside 0..255 fail explicitly. Call
`createCampaignWorldAdapter().prepare(world, commands)` for side-effect-free
preparation. Its cloned world contains `applied` receipts and durable host command
identities. Publish the returned world only when the containing transaction
commits; consume new requests only after publication. There is no separate
`canCommit` API in the current adapter contract: preparation is the validation
phase, and `commitMissionPlan` is the existing controller commit boundary.

Selection scans raw slots 0..799 in order for coordinates, type 40 and nonzero
status, including status 10. Owner and reserve are not search predicates. The
selected slot must have synchronized, owned resource host state; an unregistered
earlier matching slot is a diagnostic, not permission to change a later one.
Missing targets fail with native diagnostic address 0x43dbc1. Batch failure
publishes no rate, sound, receipt or partial earlier command changes.

Each controller-planned world command now carries an independently cloned,
full-width `statistics` snapshot at its actual reverse-source dispatch point.
VM prefixes are evaluated from the block-entry runtime using the existing VM;
only the final prefix's lives/bail state is published, so self-rearming and the
single end-of-block lives decrement retain their native behavior. Numeric trigger
scan order, original action indices, command IDs and rollback are unchanged.
Preparation installs each command's snapshot before dispatch, never the final
plan statistics for every command. The optional field preserves compatibility
with direct adapter callers, which still use the staged world's statistics when
no snapshot is supplied. A supplied empty snapshot does not fall back to stale
world scales.

The full-width dispatch `world.statistics["1,0"]` is passed directly to
`changeLegacyResourceRate`. Missing scales fail. A successful command changes
the rate, not reserve/countdown, credits or census. Replaying an already committed
ID returns its receipt without another mutation or sound; a changed payload with
the same ID fails. Different command IDs remain distinct native dispatches.

Before the staged rate write, old word zero plus nonzero literal records:

```ts
{
  type: "source-sound", commandId, slot, generation,
  category: 1, event: 7, ebx: 0, ecx: 0, stackArgument: 0, spatial: false
}
```

This event is retained even if the scaled rate becomes zero. No sample number,
asset, spatial position or invented playback is supplied. The audio owner must
resolve category/event through initialized native event data and readiness gates.

Mixed `setarray`/`newrate` session plans are now admitted. `setarray 110` aliases
`s(1,2,0)`, not the two-argument resource scale `s(1,0)`; selector-2 writes do not
change selector-0 aggregates. Session feedback continues to start from committed
controller statistics and overwrite only census fields. It must not overlay the
last command's world snapshot afterward: trailing array writes may be newer.
Earlier triggers' committed world feedback and same-scan array reads are covered.
World-dependent expressions after a world write within the same block still
return `pendingEvaluation`; no stale evaluation or partial prefix is accepted.

## Required Owner Handoffs

1. **Admission and stale expectations:** controller union/decoder and dispatch
  snapshots are integrated. The orchestrator must use
  `auditMissionTriggerSupport` in loader admission and reconcile historical
  `newrate` rejection expectations in trigger-array tests, native preflight and
  [trigger-array-integration.md](trigger-array-integration.md). Complete original
  HUMAN02 still rejects trigger 17 `ai`; ALIEN02 rejects trigger 0 `ai`.
  Retain disabled blocks, source hashes and generated/source equality.
2. **Ordered feedback:** same-block world-dependent conditions/expressions still
  require a separate ordered host-evaluation design. A pending plan must remain
  uncommittable; do not clear the diagnostic or accept a partial world prefix.
3. **Main/source registration:** pass the explicit startup scale option only on
   the evidenced new-game path. Route `entity.resource` to neutral source visual
   registration using native slot/generation; do not register it as a combat
   static target or infer a faction for team 8. Existing static-target helper
   rejects sources. Forward committed `source-sound` requests to the audio owner.
   Main, game-data, views and source parsers were not edited.
4. **SCN non-entity rows:** complete HUMAN02/ALIEN02 still fail on fourth-field
   -1 records (e.g. HUMAN02 row 14). Do not filter these out or rewrite them into
   entities to claim acceptance. Their parser/allocator owner must represent the
   native non-entity branch and supply correct entity-slot ordering before full
   source registration. Current bounded row-index allocation only applies to
   supported entity-only placement inputs.

## Resource Lifecycle API

The optional `TransportHostOptions.resourceLifecycle` invokes the same admission
as `configureCampaignResourceLifecycle(world, options)` for an already initialized
world. Existing callers without it retain the explicit occupied-source rejection.
Admission and all updates return cloned `TriggerResult<CampaignWorld>` values;
failure publishes no source, money, sound, flag, task or registry mutation.

`ResourceHostOptions` requires:

- `animations`: unique opaque bank IDs, each with 32 direction timelines of
  native **runtime delay bytes**. Do not feed FIN's unconverted field 2 or choose
  direction zero for every unit. The probe exports these through the existing
  source FIN marshaller and original conversion/binding routines.
- `types`: bindings for the used types 40/6/47 and/or 40/14/48, with `stand`,
  `deploy`, `death` bank IDs, `deathVariants`, `removalHoldField` (type +0x100),
  and `selectedWeapon`. This bounded path requires one death variant, hold field
  zero and selected weapon -1. Different branches fail, not default or no-op.
- `bindings`: `{slot, generation, state}` for every active source and each mobile
  extractor to be owned. State contains actual `direction`, `animation`
  (`profile`, `frame`, `delay`, `mode`), `pendingOrder` (+0x36), `order` (+0x37),
  `stack: [{opcode: 1, words: [countdown, hpLowWord, hpHighWord]}]`, and
  `released: false`. Supply native idle payload contents, not guessed HP words.
  Fresh source countdown is 65535; other initial states must match the owner.

`bindCampaignResourceTask(world, binding)` admits a later arriving mobile idle
task or rebinds a released one with explicit owner-supplied state. It rejects
stale generations and replacing a task still owned here. Existing complete
host checkpoints restore their persisted stacks directly, without reconfiguring.

`stepTransportHost(world, resourceFrame)` consumes animation and tasks in native
slot order. `ResourceHostFrame` requires the actual post-increment/reset
`nativePhaseCounter` (+0x530), `localTeam`, `cancellationGate` (+0x948 byte), and
eight signed32 `{aiField, aiMultiplier, creditGate}` side records. Optional
`orders` supplies slot/generation and the native pending/order bytes. The proven
cancellation is pending=1/order=13 with gate zero; a nonzero gate does not cancel.
The host records the counter, never derives it from elapsed seconds or trigger
clock. `advanceTransportHost(world, milliseconds, frames)` requires one explicit
frame per fixed update, including across day/night resets supplied by the owner.

`requestCampaignResourceExtraction(world, {sourceSlot, extractorSlot}, frame)`
performs **one source idle task visit**, using its current animation and real
ground occupancy. It is not a force-deploy command or an income tick. It advances
the native countdown and applies any deployment effects, without advancing
animation, settling task 12 or advancing host time. Do not call it and the normal
source visit for the same entity update. Both entry points consume the same
implementation. Omitted profiles, task bindings or frame inputs fail precisely.

The normal host path now consumes 6 -> 47 / 14 -> 48, task 12
`[sourceSlot,1,0]`, deployment animation completion, native phase-mask settlement,
partner checks, full32 funds/income wrapping, per-update selector-5 cycle reset,
depletion, task 13 and the full 150-visit task-10 source removal. It clears only
the source MAP flag 0x04000000. Source reserve remains the native residual value,
including a negative AI overshoot, rather than being forced to zero.

Read committed `world.exomoney`, `world.statistics`, `world.entities`, native
`entityBytes` and `transportHostState(world)` together. Synchronize those funds
and income/cycle selectors into the session/controller before the next trigger
read; do not replace totals with deltas or let census feedback discard them.
`HostSlot.resourceTask` is the authoritative serializable animation/task state.
Task depth/opcode/payload-offset metadata, payload words, direction, animation
bytes, type, status and full32 HP/reserve are mirrored to native entity bytes.
Opaque profile IDs remain host data; they are not browser-native pointers at +0x14.
JSON checkpoints rebind the canonical active payload to `taskWords` on load.

Deployment, retraction and low-HP cleanup emit `resource-unit-sound` requests
with exact `edx`, `ebx`, `ecx`, `[xQ8,yQ8]` stack arguments and `spatial: true`.
These are separate from the zero-old-rate/nonzero-literal `source-sound` payload
above. Owner-local deployment and queued cancellation use event 5/ecx=1;
depletion retraction uses event 5/ecx=0. Low-HP collision cleanup uses event 3/ecx=1
without the owner-local gate. No playback sample is invented.

## Exact Remaining Boundary

The resource host does not own general mobile idle/wait, movement, combat
interruption or arbitrary queued-order dispatch. A bound mobile unit that reaches
its native visit still in ordinary idle fails with `general mobile idle/wait
dispatch must be supplied`. In particular, a source waiting 50 visits cannot
silently freeze its occupant's general task stack. The orchestrator must provide
that task owner and explicitly bind an eligible supported idle state when control
passes here; non-idle activation stacks remain unsupported by this bounded API.

After task 13 restores mobile type and idle, `resource-task-released` includes
slot/generation/task=1 and the full idle state remains available in the host slot.
Consume this handoff before resuming general tasks; this host does not pretend to
run native task 3 on later visits. The native probe does continue those general
tasks while source removal finishes, but the parity test deliberately ends
extractor task/animation comparisons at handoff and continues comparing its
type/HP/registration and the source through unregister.

Low-HP depletion (HP <=270) is proved for a single registered ground cell: the
extractor retains HP, clears collision, enters task 10 and unregisters after 150
visits. Non-single-cell cleanup fails. Neither source nor extractor resource
removal emits `combat-death` or victim losses. External completion cannot bypass
the resource counter. Arbitrary partner types retain the native 0x413a9d failure;
other queued reset branches require their task owner and fail explicitly.

No session/controller/world/simulation/view/main integration was edited for this
lifecycle. Full mission admission and global phase/census ownership remain with
the orchestrator. The required boundary is now runtime ownership/data supply,
not a missing VENT FIN death divisor or an unused settlement helper.

## Focused Verification

[resource-host-integration.test.ts](../tools/qa/resource-host-integration.test.ts)
checks all seven original resource rows and host persistence, source order,
strict ordinary-team validation, bounds, native status/rate/countdown and tile
flags, first-slot targeting, missing-target atomicity, full-width overflow,
census refresh, exactly-once sound payloads and explicit extraction failure.
The extraction-failure expectations apply to hosts **without** lifecycle options.
Original complete scenarios remain rejected; isolated rows are test fixtures,
not rewritten production missions. The (4,80) resource belongs to ALIEN02 in the
actual SCN, despite the HUMAN02 label in the evidence table.

[newrate-controller-integration.test.ts](../tools/qa/newrate-controller-integration.test.ts)
adds literal decoder boundaries, per-command full32 snapshots for generic and
resource commands, reverse order and prior-trigger state, separate selector-2
aliases, real first-slot host effects using differing dispatch scales, exact
sound payloads, prior-trigger beacon census feedback, trailing-array/checkpoint
preservation, whole-session rollback, pending same-block feedback, and pinned
complete-source equality with only `ai` controller audit blockers. Differing
scale snapshots are explicitly injected host fixtures, not fabricated setarray
aliases into selector 0.

```sh
node --import tsx --test --test-concurrency=1 tools/qa/newrate-controller-integration.test.ts \
  tools/qa/mission-controller.test.ts tools/qa/resource-host-integration.test.ts \
  tools/qa/legacy-resource.test.ts tools/qa/campaign-world.test.ts \
  tools/qa/campaign-session.test.ts tools/qa/transport-host.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --noUnusedLocals \
  --noUnusedParameters --skipLibCheck --target ES2022 --module ESNext \
  --moduleResolution bundler --allowImportingTsExtensions --types node \
  src/engine/campaign-world.ts src/engine/campaign-session.ts \
  src/engine/transport-host.ts tools/qa/resource-host-integration.test.ts
npm run typecheck
```

Observed integration verification on 2026-09-19: all 77 tests in the focused
serial command passed, and project `npm run typecheck` passed. The seven new
integration tests passed, including real host effects and full source hash/equality
checks. An earlier parallel invocation cancelled the session test worker without
an assertion failure; the serial rerun completed all session tests successfully.

No agents, browser, full-suite run, acceptance-gate edits or source-script edits.

New [resource-lifecycle.test.ts](../tools/qa/resource-lifecycle.test.ts) compares
nine executed native cases against host output, including checkpoint restore,
both factions, cancellation, low HP, money/income overflow, counter wrap to zero,
AI overshoot, side gates and exact sound requests. It also tests unresolved
partner failure, odd shared payout, missing flags, task-owner boundaries and
FIN off-by-one behavior. See the new report for focused reproduction commands.