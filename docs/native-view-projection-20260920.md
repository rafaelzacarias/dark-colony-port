# Native View Performance Vertical Slice

## Ownership And API

[CampaignSession](../src/engine/campaign-session.ts) now runs `step` and
`stepForNativeView` through the same private transaction. Both clone/validate inputs,
stage the same host update, validate native alignment, retain authenticated immutable
configuration, journal the input and commit the same state. The response is prepared
before commit, so a failed compact projection cannot leave a committed session.

`step` still returns the complete detached public frame. `snapshot`, checkpoint
schemas, source hashing, external provider authentication and complete caller replay
are unchanged. Serialized JSON is not a trusted projection or configuration.

[NativeViewProjection](../src/engine/native-view-projection.ts) contains detached:

- Current source entities, HP/max HP, Q8 pose, type, team, status and height.
- Slot registry/generations, current carriers and the explicit lethal-owner flag.
- Actor raw220 bytes for receipt/FIN state, but no authenticated configuration.
- Current native ground words and dimensions, including the source visibility bits.
- Neutral resource constructor raw220 captures, entity and host fields.
- Latest message, credits, source clock, bail and mission statistics.
- Only the current frame's requests and commands, not accumulated event history.

The ground words are a source-state capture, not a new visibility owner or renderer
visibility policy. No new mutable-world authentication exemptions are introduced.

`nativeViewProjection` returns a fresh detached projection. `nativeViewActorSample`
checks slot/generation/registry and uses the existing strict source FIN sampler
against private configuration. It returns detached samples, never a profile reference.
All bank/direction/duration/frame/third-layer checks remain in that sampler.

[MissionView](../src/mission-view.ts) retains the projection privately for the
committed revision. Apply and HP/pose projection reuse its one transport projection.
The full simulation-checkpoint tamper guard is unchanged. Candidate failure still
discards the fork, and death sounds still dispatch only after outer commit.

Render, neutral resources, statistics and native construction-empty queries no longer
read public session/host snapshots. FIN samples are evaluated lazily once per visible
actor per committed revision, then invalidated on the next successful native step.
The existing authenticated VENT loader still runs at initialization; subsequent
frames compare every captured constructor byte, entity and actor field, registry and
generation before reusing its private frozen-pose data. Public resource results are
detached, including FIN children.

`MissionView.nativeCombatFrameState` supplies detached counter and actor identity/raw
metadata for caller receipt preparation. It does not manufacture commands, visits or
sound state. Existing fixtures and other agents' command/visibility modules were not
edited. Callers still using `campaignSnapshot` retain their full-copy cost.

## Measurements

Node v24.7.0 on the same workspace, 2026-09-20. The unchanged
[20-frame profiler](../tools/qa/native-immutable-config.perf.ts) includes the real
frame-16 allocation and frame-17 Attack receipt. Input preparation is timed separately.
Other agents were active; these are wall-clock observations, not an isolated CPU SLA.

The first small edit reused one public host copy between view apply and HP projection.
The final implementation removes the remaining public session-frame and host copies.

| Measurement | One-copy intermediate | Compact final |
| --- | ---: | ---: |
| Total, 20 advances | 7,597.982 ms | 5,160.971 ms |
| First five advances, mean | 211.500 ms | 88.170 ms |
| View initialization | 1,574.430 ms | 248.425 ms |
| Frame 8 trigger transaction | 760.025 ms | 627.983 ms |
| Frame 16 allocation | 2,940.125 ms | 2,864.834 ms |

The reported preceding three-copy profile was about 291 ms per native frame; this
document does not present it as a new baseline run. The measured intermediate-to-final
reduction is 32.1% across all 20 frames and 58.3% for the first-five mean.

Both same-caller runs produced exactly the same complete frame-20 snapshot SHA-256:

```text
55bdace0454361af87744b11ff51a9ea737c1a320ac6f4d4681dadb3ebfe4f1b
```

That snapshot is 14,725,895 JSON bytes, including 12,404,392 bytes of task configuration.
The final visibility-inclusive compact projection is 142,322 JSON bytes (0.97% of
the public snapshot). Excluding the plane it is 46,637 bytes.

The new getter measured approximately 0.015-0.094 ms for input preparation versus
125-135 ms for ordinary full-snapshot fixture preparation (196 ms at its receipt frame).
Twenty advances and twenty renders made zero public session snapshot reads and zero
complete-config host clones. Private transactional clones without configuration are
intentionally not counted as public copies.

With real FIN/atlas/indexed metadata loaded, twenty repeated renders measured
0.141-0.285 ms in the final run (0.130-0.223 ms in the isolated render run) on a mock
Canvas2D context. The test observed 8,228 draw calls and FIN
sampling only once per actor/revision, with fresh sampling after the next commit.
This is CPU preparation/dispatch coverage, not decoded PNG pixel, browser, WebGL or
GPU timing. Native renderer diagnostics and RGBA fallback remain visible.

This is not a sub-50 ms or real-time-frame claim. Trigger scans, dynamic allocation,
complete configuration authentication and mutable transaction cloning remain material.

## Verification

[Four passing focused tests](../tools/qa/native-view-projection.test.ts) cover compact/public
20-frame parity, complete checkpoints/journals, detached public mutation, late update
rollback, FIN parity and stale generation rejection, raw/resource identity guards,
detached visibility parity, full simulation-checkpoint tamper rejection, zero public
copies during advance/render, and loaded-FIN per-revision cache invalidation.

Existing focused ownership regressions passed 15 tests: external updates for every
original actor in lethal/nonlethal scopes, immutable fork isolation, SharedArrayBuffer
rejection, private input snapshots/caller mutation, detached public state, schema-1
migration, corrupt checkpoint rejection and authenticated VENT composition/tampering.

The existing full lethal view test passed once in 848,924 ms, preserving all 21
original actors plus two source allocations. It verifies HP25 at613, death/HP0 at614,
registered death through763, unregister764, generation reuse784/HP800, FIN completion
without early unregister, secondary reaction, exact fresh-provider restore at613/649/784,
and mobile/static HP plus simulation-checkpoint tamper rejection. Original death FIN
and relabelled-provider checks also passed. The existing nonlethal integration passed
in 166,096 ms: actual frame87 HP800-to775 hit, one launch/impact/reclaim, reaction,
fresh-provider restore, every-frame public-host parity and atomic frame96 rollback.
The full lifecycle invocation completed with four passes and no failures in 1,023,320 ms.

Total distinct focused coverage: 23 passing tests (4 new projection, 15 ownership and
presentation regressions, 4 existing native view/FIN lifecycle tests).

Strict scoped TypeScript checks, including tests and no-unused-symbol flags, passed.
No full suite, browser, packages, assets or other-agent modules were changed or run
as part of this slice.

Evidence logs:

```text
/tmp/dc-projection-onecopy-own-20260920-a1.log
/tmp/dc-projection-original-perf-own-20260920-a8.log
/tmp/dc-projection-focused-own-20260920-a4.log
/tmp/dc-projection-loaded-render-own-20260920-a11.log
/tmp/dc-projection-auth-guards-own-20260920-a6.log
/tmp/dc-projection-final-types-own-20260920-a10.log
/tmp/dc-projection-native-lifecycle-own-20260920-a5.log
/tmp/dc-projection-focused-isolated-012320862643.log
/tmp/dc-projection-types-isolated-012500492217.log
/tmp/dc-projection-lifecycle-evidence-a15.log
/tmp/dc-projection-lifecycle-final-a18.log
```