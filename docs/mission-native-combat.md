# Explicit Native Combat In MissionView

`MissionView` accepts the optional `sourceNativeCombat` member described by
[source-native-combat-mission.ts](../src/engine/source-native-combat-mission.ts).
Its default scope is `source-separated-type0-weapon1-nonlethal`. The optional
`source-separated-type0-weapon1-bounded-lethal` scope requires providers created
with `createSourceNativeCombatOptions({ configuration, proof, death: true })`.
The declared scope must match the authenticated provider scope and death owner;
relabeling a nonlethal provider does not enable death. The override
contains complete `CampaignSessionOptions`, including independently authenticated
`nativeAiTasks` and `nativeCombat` from `createSourceNativeCombatOptions`.
The parsed source, unit/weapon tables, bounded caller, messages, dimensions,
PTH and tags must match the view. Presentation-only SCN metadata is excluded
from this comparison, not source actors or team data.

```ts
view.advanceNativeCombat({
  clockMilliseconds,
  nativeAiFrame: { counter, task6Budget },
  nativeAiReceipt,
});
const saved = view.checkpoint();
const restored = MissionView.restore(canvas, stage, callbacks, mission, saved);
```

The caller supplies actual visits and already framed native receipts with
expected actor identities/raw bytes. The view does not manufacture counters,
task budgets, elapsed native time, targets, packets or RNG draws. `update(time)`
only renders this mode. Screen Move/Attack/Stop commands reject with the explicit
API boundary; selection remains available. Normal missions keep their existing
clock, command and combat paths.

## Transaction And Projection

Each call checks the previously committed simulation projection, forks the view
and session, then runs the session transaction. Only committed source HP and Q8
positions are copied into a validated simulation checkpoint, with the session
cycle count and source day/night state. No generic simulation advance, damage,
movement, reservations, resource extraction or independent random consumption
runs. All projected units have generic weapons and harvesters disabled.

The entire simulation checkpoint is guarded against external edits, including
static targets, commands, paths, random state and health. Passive actors cannot
change HP/position without a native task owner. Unsupported presentation requests
and waypoint commands reject before publication. Missing frames, native failures
and later caller failures leave both view and session unchanged.

Restore passes the original external task configuration as argument three and
combat configuration as argument five to `CampaignSession.restore`. Recreate
these from authentic bytes; serialized configuration is not an authentication
provider. Session replay authenticates raw actors, projectile state, RNG and
history. The view rebuilds its simulation projection from the replayed world and
compares the entire saved simulation, binding IDs and absence of generic orders.

## Bounded Lethal Projection

The explicit lethal caller retains the complete 21-actor original HUMAN02 SCN.
It is a separate QA caller, not original TRO admission. The Node fixture takes
an optional `death` argument; its default nonlethal caller still rejects the
unsupported allocation at counter96. The lethal caller instead allocates two
source troops and a replacement after native removal, without editing original
TRO or clearing visibility bits. Actual registered slots are supplied explicitly;
the view invents neither a scheduler nor a 20-TPS clock.

Status10 remains registered and projected with simulation HP0/activity `die`.
Native signed HP stays in the host, including any overkill; the simulation's
nonnegative display value is clamped at zero. Collision release, loss counters,
raw actors, FIN and registry belong exclusively to the native session. No generic
damage, death event or death animation timer runs. Only native `unregister` with
status0 and an empty registry entry removes the projected unit. A finished FIN
does not remove it: task10 must receive all150 registered visits. Historical
bindings remain available, and reuse requires a new generation, key and simulation
ID. Restore reconstructs creation/removal order from authenticated session
provenance, then compares the full simulation projection. HP edits to mobile or
static projections remain rejected while a corpse is present.

For native task actors, rendering maps normalized provider bank IDs to the source
FIN state, with original direction quantization and fallback order. Primary and
active secondary reaction samples use raw bank/frame/delay/mode, never elapsed
time. Direction timelines must match the authenticated profile's durations.
Completed primary FIN retains its actual raw frame; completed secondary FIN is
inactive. Missing bank/frame or an unowned third layer produces an unsupported
diagnostic instead of a generic death/damage animation. Sprite composition still
uses the existing FIN renderer and its diagnostics.

[mission-native-combat-death.test.ts](../tools/qa/mission-native-combat-death.test.ts)
covers original FIN versus generated metadata across all quantized directions,
all three death banks, active secondary reaction, scope mismatches, the natural
32-hit chain, and exact fresh-provider restore before/during/after death. The
positive lifecycle is lethal614, registered corpse through763, unregister764
after150 visits, then slot reuse784 with HP800 and a new generation. All21 original
actors remain. The dying checkpoint is counter649, not rebased to a new clock.

The optional `SkirmishCallbacks.onNativeDeathSound` explicitly owns the
`native-death-sound` presentation boundary. Its type is
`(request: Extract<HostRequest, { type: "native-death-sound" }>) => void`.
The complete actual `entry.requests` item is copied: counter, generation, slot,
id, Q8 x/y, category0/event3, native volume/pan, and the complete source sound
row `{ id, source, parameters }`. The file path is `request.source.source`;
native flag/parameter words remain in `request.source.parameters`, with no
new interpretation or fabricated `flags` field. There is no synthesized cue or
unchecked caller-provided sound payload. `nativeAiFrame.sound` still passes
through to host authentication. No callback means a sound-producing transaction
rejects before publication, not silent consumption.

The view captures the consumer, stages without dispatch, checks projection and
presentation, then publishes the candidate before delivering sound effects.
Late failures discard the prepared effects. The handoff consumes its batch
before calling the consumer, so reentrancy or another call to that handoff
cannot duplicate delivery. Each request is attempted once; consumer exceptions
are collected in an `AggregateError` with `presentation failed after commit`.
As with existing synchronous view callbacks, the error reaches the caller;
the already-committed simulation/session must not be rolled back or retried.
Sound dispatch precedes `onUnitsChanged`; a sound exception prevents that later
notification. Other sounds in the same batch are still attempted. Consumers
must handle their own asynchronous failures. No firing callback, generic death
event, statistics update, audio-manager call or native RNG draw is added.

Restore authenticates/replays session data but never invokes this handoff and
does not replay historical audio. Callback presence is runtime presentation
configuration, not serialized ownership or a substitute for fresh providers.
The exported `prepareNativeDeathSoundEffects` is only an isolated delivery
helper, not an authentication API or a simulation commit operation.

Focused callback QA adds typed collection assertions to the existing MissionView
warm/nonlethal, fresh-provider restore, projection guard and late frame96 failure
test. The host's controlled visible kill at614 supplies the real positive request
to isolated handoff tests: no consumer rejection, deferred/once-only/reentrant
delivery, complete detached payload, and exception without state/statistics
changes. This is not a positive sound-producing MissionView lifecycle test.
The controlled host visibility injection is not authenticated natural mission
visibility and is rejected on restore; it is never injected into the view.
The ordinary view fixture uses the host-tested nonvisible cohort unchanged.
Native DirectSound volume/pan to WebAudio gain/pan and cue PCM mapping remain
unproved. This is an explicit QA callback, not audible playback certification.
Projectile/effect presentation remains unsupported; positive actor FIN sampling
does not certify those effects or browser pixels.

Reproduce only the callback slice from the repository root:

```sh
node --import tsx --test \
  --test-name-pattern='^visible sound transport publication|^MissionView explicit authenticated combat:' \
  tools/qa/source-native-combat-host.test.ts tools/qa/mission-native-combat.test.ts
npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext \
  --moduleResolution bundler --lib ES2023,DOM \
  src/mission-view.ts src/simulation-view.ts \
  tools/qa/source-native-combat-host.test.ts tools/qa/mission-native-combat.test.ts
```

## Original Focused QA

[mission-native-combat.test.ts](../tools/qa/mission-native-combat.test.ts) uses
[the Node-only fixture](../tools/qa/fixtures/native-combat-mission.ts), which
recreates providers from original bytes and preserves the complete HUMAN02 SCN.
Its explicitly separate test caller allocates two source type-0 troops via
`reinforce2`; no original TRO is edited or stripped. The test compares the view
against a direct authenticated session, exercises the real launch/impact/reclaim
and next damaged visit, and checks restore and atomic rejection.

The observed positive boundary is frame 87: one launch, one impact, one reclaim,
target HP 800 to 775, all 21 original actors retained plus two source allocations.
The next visit consumes damaged pending `c7`, retains `c8/c9`, and selects the
registered reaction. Recreated external providers restore the hit checkpoint
and produce the same next view checkpoint. Generic simulation RNG stays fixed;
generic combat events remain empty throughout the compared frames.

Focused verification: one integration test passed, including missing-frame
rollback, frame-96 unsupported-allocation rollback, mobile/static HP and position
tampering, generic RNG tampering, external-provider absence and queued generic
commands. Two existing HUMAN/ALIEN normal damage tests and one existing normal
checkpoint rejection test also passed. Strict ES2022/ES2023-lib slice types,
editor diagnostics and local documentation links passed.

Evidence: `/tmp/dc-mission-native-combat-20260919-a5.log` (420 seconds),
`/tmp/dc-mission-native-normal-20260919-a1.log`,
`/tmp/dc-mission-native-normal-restore-20260919-a1.log`, and
`/tmp/dc-mission-native-types-20260919-a4.log`.

## Current Browser QA Scope

The [browser QA fixture](native-combat-browser.md) now recreates authenticated
task/combat providers from original bytes with a QA-only Buffer bootstrap.
Browser-fetch/Node-peer tests match all126 source hashes and configuration/world
state. The original Node fixture remains Node-only; serialized fixture output
does not authenticate a provider. Both callers preserve21 original actors and
two source allocations, without admitting original HUMAN02 TRO.

MAIN observed frame87 in the shared browser: projectile0, source171, target170,
substep2, damage25, HP775, reclaim0 (projectile slot0),23 actors and135,196 colored
pixels, with a screenshot without diagnostics. Browser restore was interrupted
by HMR and has no result yet; automated restore evidence above is separate.

The prior visible-VENT rendering blocker is superseded only for source-proved
fresh frozen poses of all four VENT actors. They remain present; resource FIN/task
cadence and lifecycle are not admitted by this combat scheduler. See the
[round12 status](acceptance-round12-20260919.md) for current gate and evidence
boundaries; the original focused logs above remain historical.

## Remaining Boundaries

- No default HUMAN02, original TRO, campaign full-policy or shared scheduler admission.
- Lethal admission is only the explicit bounded scope above. Other firing
  types/weapons, general paths and general retaliation remain unsupported.
- Native actor FIN/secondary-reaction sampling is bounded to mapped source
  profiles; projectile graphics and source sound playback are not admitted.
- Frozen source VENT presentation is not resource cadence or scheduler ownership.
- Browser QA is bounded and nonlethal, not complete browser certification.
  Browser restore remains pending; native effects/audio and normal controls are
  not certified by the frame87 screenshot.
- This explicit QA path copies and authenticates substantial source state;
  neither its per-visit performance nor replay latency is certified for live play.
- The original integration slice ran no browser/full suite; later completed
  evidence is recorded separately in round12, not retroactively in those logs.