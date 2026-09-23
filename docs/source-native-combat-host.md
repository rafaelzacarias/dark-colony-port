# Bounded Source Combat Host And Session

## Runtime Scope

2026-09-21 additive provider scope: `source-separated-type8-weapon15-nonlethal`.
The [ALIEN provider handoff](source-native-combat-alien.md) documents its distinct
authenticated configuration, direct-call proof, and unowned damaged-idle scan.
This addition does not admit that scope into CampaignSession/transport/view;
the session examples and type0 continuity claims below remain HUMAN-only.

This is an actual host/session transaction, not a detached proof helper.
The default `runtimeReady: true` scope remains
`source-separated-type0-weapon1-nonlethal`: registered type-0 fire, ordinary
weapon-1 travel/collision, positive nonlethal damage, reclamation, and the next
registered damaged visit. It does not admit the original HUMAN02 mission.

The standalone combat proof and fragment retain `runtimeReady: false` because
they do not install an owner. The factory in
[source-native-combat-host.ts](../src/engine/source-native-combat-host.ts)
composes these authenticated assets with a complete source-world task attestation.
No runtime configuration reads native traces.

The optional `death: true` factory input selects
`source-separated-type0-weapon1-bounded-lethal`. It installs the native death
owner described below; omission preserves lethal rejection in the default scope.

## APIs

```ts
const configuration = await createSourceNativeTaskOptions({ assets: taskAssets, world: freshWorld });
const proof = await createSourceNativeCombatProof(combatAssets);
const { nativeAiTasks, nativeCombat } = await createSourceNativeCombatOptions({ configuration, proof });
const session = new CampaignSession({ ...initialOptions, nativeAiTasks, nativeCombat });
const result = session.step({
  clockMilliseconds: 16,
  nativeAiFrame: { counter: 1, task6Budget: 0 },
});
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
const checkpoint = session.checkpoint();
const restored = CampaignSession.restore(checkpoint, undefined, nativeAiTasks, undefined, nativeCombat);
```

`freshWorld` must come from exactly `initialOptions`, including caller identity
and metadata. Rebuild both providers from authentic assets in a new process;
the serialized configuration does not authenticate itself. The fifth restore
argument is independently expected combat configuration. The third remains
the independently expected initial task configuration, not the dynamically
extended checkpoint binding list.

Direct host users can call `initializeTransportHostNativeAiTasks`, then
`initializeTransportHostNativeCombat`, followed by `stepTransportHost` with an
explicit native frame. Standalone host snapshots are not replay-authenticated
checkpoints; the session is the journal/replay owner.

## Source Coverage

- Pins and privately copies the original EXE, GAMESTAT, WEAPSTAT, BOOMSTAT,
  MBULLET, complete HUMAN02 SCN, TRSC FIN/SPR and complete 106-file ANIM registry.
  Task assets and typed world buffers are detached before the first await,
  including SharedArrayBuffer storage. Factory argument references are captured
  before awaiting. Published configurations are recursively frozen and their
  complete canonical contents are authenticated in-process.
- The task and combat providers must agree on the complete parsed SCN, not just
  type-0 upgrade levels. Full original actors, CITY, resources, RENAT and source
  identities remain present. No SCN/TRO asset is edited or stripped.
- Projects all 106 GAMESTAT scalar rows and original SCN upgrade bytes. Native
  comparisons cover faction, weapon selection, armor class, `+68` reveal filter,
  path class, upgrades and byte zero. Byte zero is the boolean final GAMESTAT
  token, as written by `43bcf4..43bd05`, not a zero default.
- Armor normalization follows `43bd46..43bd89`; native normalized parity and
  FIN/SPR collision geometry are certified only for admitted type 0. Type-0
  seven BLOODA..G reaction banks bind `+bc..d4`, count `+d8=7`, with all 32
  direction timelines. Damaged continuation retains `c8/c9`, consuming `c7`
  only when the registered reaction owner accepts it.
- Type0 acquisition retains the first809 EXE entries at `434090`:16 complete
  source rings (radii0..15). Type8 now uses814 entries/17 sentinels (radii0..16),
  byte-for-byte compared to native inputs; larger scans and incomplete required
  rings reject. See [counter32 integration](type8-counter32-integration-20260922.md).
  SCN observer-row relations are preserved. Visible CITY acquisition
  remains conservatively rejected because city flags have no provider here.
- Weapon 1 has source-proved absent travel/impact FIN across the entire registry.
  Only BOOM record 0 is consumed. No impact effect is invented.

The reducer requires a 110*280 storage layout. Rows 106..109 are inaccessible
compatibility storage, **not native-proved rows**; all active actors are checked
against the 106 source rows. Other rows contain scalar projections, not proved
collision geometry or complete type records. Other weapon/BOOM storage is not
certified for firing. The active projectile guard requires the explicit
configuration `sourceType` and `weapon` before reduction: 0/1 for HUMAN or 8/15
for ALIEN. Geometry remains restricted to that configuration's authenticated
`geometryTypes`, not both races.

Before projectile reduction, all four wrapped Q8 substeps and each 3x3
neighborhood are checked in air/ground/extra order, including damage-class air
filter, same-team/neutral exclusions, source `+68` reveal and type-byte-zero
filters. An otherwise eligible candidate must have proved type-0 geometry and
a mobile slot. Different-team allies are checked **before** alliance filtering.
The guard conservatively checks later substeps even if an earlier impact would
terminate flight; this may reject a safe path, never admit uncovered geometry.

## Transaction And Replay

Each frame visits actual owned actors in ascending slot order. Every visit
receives the current staged raw220 actor map, current ground, one staged RNG
cursor and the current projectile pool; later actors cannot use stale targets.
The same RNG then feeds `reduceLegacyNativeProjectiles` after actor visits.
Commit publishes raw220, task.raw, host/world health, position/ground, pool
records/heads/high-water/statistics, RNG and the combat journal together.
Lethal effects without the optional death owner, and unsupported effects in
either scope, abort before publication.

`nativeCombat.journal` records counter, RNG boundaries, launches (including
source sound descriptors), impacts and reclamations. The session retains every
native caller input. Restore replays constructor installation, dynamic
allocation, receipts, visits and projectiles, comparing the entire resulting
state. Altered pool statistics, RNG, journal or missing inputs reject. Dynamic
bindings are replayed rather than incorrectly compared with initial bindings.

## Original Positive Evidence

[source-native-combat-host.test.ts](../tools/qa/source-native-combat-host.test.ts)
uses actual source assets at runtime. Its separately declared bounded caller
preserves all **21 original HUMAN02 actors**, allocates **two type-0 troops**
through real `reinforce2`, sends framed pending mode5/mode7 including Attack7,
and follows a real clear source PTH corridor. Native movement writes the
team bits (not persistent exploration bit31 tested by sound); the test never injects visibility or fabricates raw
targets. By frame **87** it produces **one launch, one positive impact and one
reclamation**, then a damaged reaction on the next visit. Full save/restore and
one-step continuation are identical.

Negative controls cover coherent lethal HP at the pre-impact host boundary
(all visits/pool/RNG/health/planes roll back), uncovered allied geometry,
provider substitution across await, shared-buffer mutation, changed source
configuration, missing external restore provider, checkpoint edits and missing
caller history. A deliberately unsupported bounded-caller allocation at tick 96
also rolls back the session after native visits, including both journals. TRO
condition `c` counts 16-tick cycles, so that test uses `c>5`, not `c>90`.
Existing scalar/FIN comparisons use supplied native evidence
only as test oracles, never as runtime configuration.

Focused verification: **32 passed, zero failed, zero skipped** across two
combat-host tests, ten combat-source tests, eleven task-source tests and nine
selected existing native-host regressions. Strict ES2022/ES2023-lib slice types
and local documentation links passed. Evidence logs:

- `/tmp/dc-combat-host-final-1789874410342468000.log`
- `/tmp/dc-combat-source-regressions-1789873979357080000.log`
- `/tmp/dc-combat-host-regressions-1789874630858464000.log`
- `/tmp/dc-combat-types-final-1789874635473822000.log`

## Browser QA Ready

The [browser fixture](native-combat-browser.md) now reconstructs the same
authenticated providers from original bytes, using a QA-only Buffer bootstrap.
All126 fetched source hashes and complete configuration/world parity are tested
against the Node peer. This supersedes the former browser-construction blocker;
it does not turn serialized configuration into proof or create a production route.

The [MissionView path](mission-native-combat.md) preserves21 original HUMAN02
actors plus two real source allocations. MAIN's shared-browser frame87 showed
projectile0 impact from171 to170, substep2, damage25, HP775 and reclaim0
(projectile slot0), with23 actors,135,196 colored pixels and no diagnostic in
the screenshot. Four VENT actors have source-proved fresh frozen presentation,
not resource lifecycle/cadence. The explicit bounded caller is not original TRO;
normal Move/Attack remains disabled. Browser restore was interrupted by HMR:
no result yet, pending, independently of automated replay/restore passes.

Current gate, later focused checks and MAIN observations are separated in the
[round12 report](acceptance-round12-20260919.md). The original logs above remain
historical evidence for their own slice.

## Closed Gates

Production (including direct host production exits), CITY, resource lifecycle
and campaign AI/full-policy cannot share this combat scheduler. Source-supported
direct `reinforce2` allocation is covered; this does not prove native mission
phase ordering. Other firing weapons/types, type-8 geometry/reaction providers,
general paths, positive weapon
FIN/effects, general retaliation, original TRO admission and whole-mission
scheduling remain closed. The [pure death owner](native-death-owner.md) is now
joined to the bounded optional host/session provider below.
Visible death sound requires the explicit source-audio owner below; natural
mission visibility/audio startup and commander-statistics branches remain closed.

Browser construction is QA-ready and bounded nonlethal view rendering has been
observed, not general native effects/audio, normal controls, native resource
cadence or realtime performance. No browser/full-suite/build/package/assets
changes were part of the original host slice; later browser support and gate
results are separate. All-phases completion remains unclaimed.

## Optional Bounded Lethal Owner

### Visible Death Sound

`createSourceNativeCombatSoundProof` in
[source-native-combat-options.ts](../src/engine/source-native-combat-options.ts)
privately copies and hashes actual EXE, SOUND2 and SLIST bytes before parsing the
source catalog. It supplies rows 28/90/153/154 with their original paths and
parameters. Hash strings and deserialized proofs are not accepted in place of
bytes. The proof is frozen and its identity must be authenticated when composing
the combat configuration.

There is **no default mission audio seed or current DEA selection**. The only
admitted policy is `explicit-caller-boundary`, with externally supplied current
13-byte descriptor and unsigned CRT seed. This authenticates source assets and
records an explicit bounded caller state; it does not authenticate original
mission audio history. Original SLIST initialization proves descriptor
`[4,0,0,28,90,153,154,0,0,0,0,0,0]`, but subsequent consumers may change byte1.
The native test's original `srand(1)` is an explicit fixture call. Later read-only
research in `/tmp/dc-crt-bootstrap-positive-20260920-r8.log` independently proves
startup `0x45a7cb -> 0x4645d5 -> 0x469749`, with seed1 written at `0x469754` to
thread storage `+0xc`; first native rand16838 advances to1103527590. Only
VirtualQuery/GetCurrentThreadId are stubbed. This proves bootstrap, not the
current seed/DEA consumer history at death, and installs no runtime owner.
No zero/default seed is synthesized.

```ts
const sound = await createSourceNativeCombatSoundProof({
  executable, soundTable, bindings,
}, {
  policy: "explicit-caller-boundary",
  state: externallyEstablishedCurrentAudioState,
  initialized: true, disabled: nativeAudioDisabled, listener: nativeListenerQ8,
});
const { nativeAiTasks, nativeCombat } = await createSourceNativeCombatOptions({
  configuration, proof, death: true, sound,
});
const result = session.step({
  clockMilliseconds,
  nativeAiFrame: { counter, task6Budget, registeredSlots,
    sound: { initialized: true, disabled: nativeAudioDisabled, listener: nativeListenerQ8 } },
});
```

Every owned frame requires explicit flags and signed-dword Q8 listener position,
including nonlethal/hidden/muted frames. The owner keeps mutable `soundState`
separate from immutable source configuration and the shared simulation RNG.
Each audio-enabled owner journal entry records `sound.input`, `sound.before`,
`sound.after` and `soundRequests`, including empty results. Actors, HP, planes,
pool, death statistics, both RNG streams, descriptor and requests commit together.
Direct host and session forks detach all mutable state while retaining the
authenticated frozen configuration. Failed late session work exposes no request.

**View handoff:** the committed field is `result.value.entry.requests`; select
`request.type === "native-death-sound"`. The request contains
`counter,slot,generation,id,x,y,category:0,event:3,volume,pan,source`, where `source`
is the exact `{id,source,parameters}` SOUND2 row. A view callback can be named
`onNativeDeathSound(request)`; this slice does not add a MissionView callback.
Invoke it once only after the outer view/simulation transaction also commits.
Use the returned frame's requests, never scan cumulative host history or replay
checkpoint journals into a sink. Direct host callers use the new suffix of
`committedWorld.transportState.requests`. A global platform sink may accept the
descriptor independently of browser playback; neither decoding nor audible
browser output is claimed here. Sink failures must be surfaced or queued, not
silently discarded; they must not rewind a committed simulation frame.

Keep signed native volume/pan and original Q8 source position; do not resample
the variant or apply a second world-distance calculation. A legacy/browser-mute
sink still receives the native request and CRT advancement when native audio is
enabled. In contrast, original `disabled=true`, hidden cells and rejected
distance suppress **both** request and CRT advancement, as proved by the native
oracle. Uninitialized audio rejects even when disabled.

Restore requires the independently reconstructed expected combat provider,
including the same explicit initial audio boundary, and complete caller replay.
It compares current seed/descriptor, all requests, flags/listeners and journal
state. Restore itself does not dispatch audio. Other consumers of the native CRT
stream or DEA descriptor are outside this bounded owner and must not run beside
it without shared ordered ownership.

**Natural visibility blocker:** supported original horizontal move writes
`0x40000000 >>> team` at `412580/4125af`, not bit31 tested by `431da8`.
Bit31 is persistent exploration, **not current visibility**. Read-only evidence
`/tmp/dc-visibility-positive-20260920-r6.log` shows original clear `0x4456f0`
preserving bit31 with mask `0x807fffff` while clearing team visibility. Compute
`0x44a6d4` gives411 explored/411 visible cells, clear411/0, and recompute411/411
with the identical full ground hash. This is not a runtime visibility owner.
The fresh-session victim lacks bit31; manually setting it is a controlled
fixture only. A view screenshot or render visibility does not authenticate
native cell bit31 or the exact victim history. Main must supply the
original visibility owner/caller history and actual current audio boundary
before claiming a naturally visible mission kill. Default nonlethal and
`death:true` without audio retain their existing admission rules.

Focused tests are in
[source-native-combat-sound.test.ts](../tools/qa/source-native-combat-sound.test.ts)
and the `visible sound` cases in
[source-native-combat-host.test.ts](../tools/qa/source-native-combat-host.test.ts).
The direct original projectile test uses
`/tmp/dc-death-sound-platform-20260919-a19.json` only as an oracle, relocates FIN
pointers to authenticated source banks, and labels its controlled bit31 input.
Its real packet is sound28 at Q8 `(17536,12416)`, CRT `1 -> 1103527590`, next
DEA index2, simulation RNG `127 -> 127`. Only DirectSound platform methods are
stubbed in that oracle. No runtime provider reads a trace file.

The fresh-session test completes 32 actual 25-damage impacts without HP edits,
lethal counter614. Its natural target cell word is `1107296426`, with movement
history but no bit31, so no audio request occurs. A separately labelled fork
injects only bit31 and obtains exactly one committed `native-death-sound` for
slot170/generation0, source sound28 at Q8 `(11124,3456)`, volume0/pan0. CRT moves
`1 -> 1103527590`, DEA index `0 -> 2`; simulation RNG stays132. Late reservation
failure rolls back the entire lethal frame, including audio. The next task10
visit preserves audio state and emits no second request. Direct transport and
session requests agree. Fresh-provider natural replay passes; the injected
visibility checkpoint explicitly fails caller replay, so this is not a
naturally visible mission claim.

Verification: 30 distinct focused tests passed, zero failures/skips, including
the original sound matrix and default frame87 nonlethal hit/reaction/replay.
Project `npm run typecheck`, strict test-slice compilation, editor diagnostics
and local documentation links passed. Evidence:

- `/tmp/dc-visible-kill-20260919-b6.log`: original controlled boundary and fresh
  source kill, atomic publication, natural replay and injected-state rejection.
- `/tmp/dc-visible-sound-regressions-20260919-b7.log`: 21 native sound cases plus
  runtime provider byte authentication, call-time copy and missing-state guards.
- `/tmp/dc-visible-host-regressions-20260919-b9.log`: five selected audio/default
  provider, rollback, fork and caller-replay tests.
- `/tmp/dc-visible-default-positive-20260919-b12.log`: default positive combat.
- `/tmp/dc-visible-strict-types-20260919-b8.log` and
  `/tmp/dc-visible-final-typecheck-20260919-b10.log`: strict and project types.
- `/tmp/dc-visible-evidence-20260919-b13.log`: consolidated kill/replay trace.

No MissionView, renderer, package, asset or native reducer edits; no agents,
browser, full suite or mission-audio startup admission in this integration.

### Lethal State

```ts
const { nativeAiTasks, nativeCombat } = await createSourceNativeCombatOptions({
  configuration, proof, death: true,
});
```

The provider authenticates TRSCDIEA/B/C, all 32 directional timelines, the
three-variant count, source `type+100` and `type+60`, alongside seven reaction
banks. Initial registry comes from the complete private fresh-world attestation,
not the mobile task binding subset. Initial statistics follow original
`419d60`: 384 team bytes and 0x3700 type bytes are explicitly cleared; remaining
type-table storage is verified zero-initialized executable BSS. Startup
`4012b4/4014c6/40183b` supplies the two nonzero 256 cells. No kill statistics
are fabricated or copied from traces at runtime. The original full HUMAN02
scanner proves eight absent commander links; this provider rejects source
worlds with heroes and subsequent hero allocation rather than guessing links.
Native policy remains 0 in the authenticated fresh provider.

The source probe [source-native-combat-host-native.py](../tools/qa/source-native-combat-host-native.py)
observes all 21 original actors, full registry, both accounting arrays and all
commander links before dynamic allocation. It poisons the explicitly cleared
statistics ranges before running the native initializer. The host test compares
these values and death FIN timelines with authenticated source projections.

`nativeAiFrame.registeredSlots` is an optional, explicit ascending list of actual
registered mobile slots, accepted only with the lethal provider. Missing means
the existing all-owned-actors scheduler; empty means no actor visits, followed
by the actual projectile phase. Slots must be unique, in range, currently
registered and bound to the current generation. This is a bounded caller
contract, not a claim about the original mission scheduler. Full caller lists
are saved and replayed. Native counters must advance monotonically.

The fresh full-world kill test preserves the 21 SCN actors and allocates two
ordinary source troops. It schedules only those supported actors, uses real
pending Attack/Move receipts and source PTH movement history writes, then
schedules the victim alone after lethal admission. It never clears bit31,
rewrites HP or installs an oracle snapshot. Policy0 obtains 32 real 25-damage
impacts: lethal counter614, HP0, removal counter764. The default all-actor
continuation remains bounded: it may reject an unsupported original actor
idle/turn profile, as observed at counter382 in an earlier full schedule.

At impact, status10 and signed HP (including negative overkill) are published
without truncation. Ground occupancy is released immediately, but registry,
slot identity and world entity remain until the 150th actual death visit.
Task10 bypasses living task dispatch and calls `reduceLegacyNativeDeathVisit`.
FIN completion does not remove the actor. At visit150 the runtime entity and
registry entry are removed; raw actor/task state remains until allocation.
The existing allocator reuses the slot with a fresh generation and replaces
the authenticated dynamic binding. It cannot reuse a pending death.

Projectile and death team statistics are the same ledger. The session publishes
killer/victim counters and per-type classes, records the victim loss once and
retains identity provenance. Raw/task state, RNG, pending death metadata, pool,
planes, statistics, registry and both journals are staged together. The fifth
restore provider remains mandatory; restore reconstructs every caller from
fresh source options and compares the entire result, including pending visits
and dynamic generation bindings. Standalone mutable host state does not replace
session replay authentication.

Only privately retained, canonical-verified, deeply frozen task/combat
configurations are shared. Public checkpoints and snapshots stay detached.
Mutable actors, death metadata, statistics, pools and journals are never shared.
Exotic prototypes, accessors and shared-storage configurations are rejected.

The [continuity tests](../tools/qa/source-native-combat-host-continuity.test.ts)
now assert that host adapters reject unauthenticated external oracle
configuration, then use **pure reducers** to compare all 1880/2543 original
phases from the first real native hit,
then use only prior TypeScript outputs: 32/45 total shots, HP0/-10, all150
registered death visits and removals678/899. Every phase compares raw800,
pool/heads/high-water, both statistics tables, all planes, registry, commander
links and ordered RNG writes. The source-geometry guard is retained. This is
pure-owner continuity and host rejection coverage, **not host-adapter continuity
parity**, authenticated fresh-provider policy1 or original whole-world scheduling.
The fix changes tests, not runtime authentication. The actual fresh-source
host/provider kill614, removal764 and reuse784 tests remain separate positive
evidence.

Focused evidence:

- `/tmp/dc-lethal-host-kill-20260919-A11.log`: positive fresh-session kill.
- `/tmp/dc-lethal-host-continuity-20260919-A14.log`: historical chain evidence,
  superseded for host-continuity claims by the pure-owner/rejection correction.
- `/tmp/dc-continuity-final-20260920-FCNfG2`: corrected two-pass/zero-fail focused
  continuity result; scoped types clean, not authenticated host parity.
- `/tmp/dc-lethal-host-guards-20260919-A23.log`: source/FIN/poison initialization,
  configuration tampering, caller guards and private fork isolation.
- `/tmp/dc-lethal-host-types-20260919-A27.log`: final strict owned-slice compilation.
- `/tmp/dc-lethal-host-restore-20260919-A15.log`: complete fresh-provider replay,
  lifecycle checkpoints, tamper rejection, rollback and allocation reuse.
- `/tmp/dc-lethal-host-regression-20260919-A26.log`: six existing host checks,
  including the unchanged default frame87 positive hit and lethal rejection.

The earlier ten-check summary grouped eight host tests (two new, six existing)
with two external-oracle trajectories; it must not be read as ten authenticated
host parity checks. The latest full suite finished2634/2628pass/2fail/4skip,
duration1644887ms, with only those two unauthenticated fixtures failing
(`/tmp/dc-round12-death-final-20260920.log`). Their corrected two-pass focused
result is separate: no corrected clean full gate or runtime fix is claimed.
Fresh-provider
checkpoints before lethal, dying, removed and after reuse compare identically;
pending-state tampering rejects. Late reservation failures after the lethal
impact and first death FIN reset roll back state and journals. Removal at764
is followed by real reinforce2 allocation at784 into the same slot with a new
generation, fresh HP800 and replacement binding, without another victim loss.
Strict owned-slice TypeScript and documentation links pass. No MissionView,
browser, package, assets or full suite changes are part of this integration.

Reproduce with absolute paths or from the workspace root:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 python3 -B tools/qa/source-native-combat-host-native.py > /tmp/dc-combat-fresh-unique.json
DC_NATIVE_COMBAT_FRESH_TRACE=/tmp/dc-combat-fresh-unique.json node --import tsx --test tools/qa/source-native-combat-host.test.ts
node --import tsx --test tools/qa/source-native-combat-host-continuity.test.ts
```

The continuity tests use the two cached death traces named in the pure-owner
document. The host test also uses the cached base trace for FIN comparison.
Use positive test-name filters for focused subsets: a negative lookahead can
match Node's parent file suite and unexpectedly run the long replay again.