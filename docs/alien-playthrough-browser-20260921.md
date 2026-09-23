# Original ALIEN01 Browser API Playthrough

## API

[alien-playthrough-browser.ts](../tools/qa/fixtures/alien-playthrough-browser.ts)
accepts the actual, already initialized `MissionView`, including its existing main
HUD callbacks. It does not mount a fixture, initialize another mission, replace
the app's private view, or install anything on `window`.

**API automation, not manual input or native real-time.** The strategy reads
original map tags and enemy state, so it is source-aware, not restricted to a
human player's information. It shares the unchanged planner extracted from
[source-playthrough.ts](../tools/qa/source-playthrough.ts) into
[source-playthrough-strategy.ts](../tools/qa/fixtures/source-playthrough-strategy.ts).
The Node CLI retains its own IO, command issuance, rendering policy and tracing.

Use the captured original ALIEN01 view at tick zero, after `await view.initialize()`.
The caller must exclusively own its update clock throughout the run, including
between chunks. A hidden embedded page may stop rAF, but hidden state alone is
not a guarantee. The fixture does not cancel rAF, patch `update`, replace timers,
change `performance.now`, or disable rendering. Unexpected outside tick advances
are rejected. Keep the canvas laid out, even when its browser tab is hidden.

```ts
const { createAlienPlaythroughRunner } = await import(
  "/tools/qa/fixtures/alien-playthrough-browser.ts"
);
const checkpoints = [];
const runner = createAlienPlaythroughRunner(view, {
  outcome: "win", // "loss" uses the original commander-exposure policy
  maxTicks: 8000,
  batchTicks: 200,
  onCheckpoint: checkpoint => { checkpoints.push(checkpoint); },
});
const progress = await runner.step(200);
// Return progress from the browser evaluation; repeat step(200) while running.
```

The first 200 ticks issue two commands on either route. `step(count)` accepts
1..1000 ticks and defaults to `batchTicks` (200). `maxTicks` is an absolute
simulation-tick ceiling (default 8000, at most 40000). At the ceiling it returns
`status: "limit", success: false`, never a premature victory. Further steps on
a terminal runner advance zero ticks.

Every result contains `tick`, `ticksAdvanced`, `phase`, `status`, `success`,
`commandCount`, `actions`, `shots`, `deaths`, `outcome`, `diagnostic`, and an
explicit automation `semantics` label. `actions` contains only that batch's
commands and can naturally be empty; `commandCount` is cumulative. Actions
include source purpose, selected IDs, requested point, cursor, CSS client
coordinates, and actual camera-center cell after clamping. Collect batch actions
or use `onProgress` for a complete transcript. `runner.progress` is a read-only
summary with an empty batch action list.

`status` is `running`, `outcome`, `limit`, or `diagnostic`. Success requires a
**ready** outcome with the requested result code. A pending outcome does not
stop the loop. Errors from callbacks and public commands propagate; overlapping
`step` calls are rejected, and the fixture never retries an issued command.

An all-in-one async convenience function is also exported:

```ts
const { driveAlienPlaythrough } = await import(
  "/tools/qa/fixtures/alien-playthrough-browser.ts"
);
const result = await driveAlienPlaythrough(view, {
  outcome: "loss", maxTicks: 3000, batchTicks: 200,
  onProgress: progress => { /* consume each batch here */ },
});
```

It yields with a timer between batches, not rAF. Hidden-page timer throttling can
delay completion but does not change the simulation clock. Prefer incremental
`step(200)` calls for bounded browser-tool evaluations; if an evaluation is
deferred, await that same execution rather than issuing another step. Full
rendering costs real wall time. Do not interpret tool timeouts as mission losses.

## Main Browser Results, 2026-09-21

Main reports completed WIN and LOSS on the actual main-loader default original
ALIEN01 view, not a replacement fixture. The public API ran on a controlled clock
with real Canvas rendering on every tick, without actor, damage or funds
injection. Original mission data and the source-aware planner were retained.

| Browser result | Ready tick | Commands | Shots | Deaths | Outcome / reason | Diagnostic |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Win | 6945 | 88 | 785 | 45 | 0 / 1 | null |
| Loss | 2465 | 10 | 267 | 1 | 1 / 2 | null |

The fixture itself does not patch `update`; the surrounding browser harness used
a test-only app-update ownership wrapper to prevent competing clock advances,
then restored it after each run. These are full-render browser API outcomes,
not manual-input playthroughs, native-game parity or rAF pacing measurements.
Null mission diagnostics do not remove global visual-order/effect limitations.

Separate trusted Playwright M-key and pointerdown events both had
`isTrusted: true` in the actual main handler. All five selected units moved over
100 updates, tick 346 to 446. An in-memory tick-340 checkpoint restored exactly
after real-Canvas initialization; this is separate from the Node tick-1000
continuation below and is not a browser outcome-run restore claim.

At viewport 390x844, a fresh mobile loss had shell bounds x 0..390,
y 275.75..568.25 and result-panel bounds x 20.71875..291.28125,
y 297.6875..485.2417. An initial tool resize emitted no window resize event and
left desktop shell bounds outside the viewport. Main added parent-container
`ResizeObserver` support while retaining the window fallback. On a fresh mobile
result, a hidden-page locator stability timeout was followed by a successful
trusted coordinate mouse click at the Retry action's center. Fresh ALIEN01 then
reached tick 220 with five units, no diagnostic and a fitted shell. This verifies
mouse recovery at mobile dimensions, not touch input or sustained device pacing.

Real Ctrl+S, Meta+S and Alt+M issued zero Stops and retained context mode;
plain S issued one Stop and plain M selected move mode. Runtime stop/audio
diagnostic cleanup is one-shot. Continue preserved the existing Human save;
the browser tests made no IndexedDB writes and left all saves untouched.

Main supplied `/tmp/dc-alien-mobile-final-20260921.png`. This documentation-only
update did not inspect or display it and does not certify its image content.
The update-clock wrapper is restored, but main still must restore the original
prototype method and remove test globals: the `view.stop` observation wrapper
remains installed. Do not treat the browser as fully cleaned up yet.

## Clock And Commands

Construction calls public `resetClock()` then `update(0)` without advancing the
simulation. Each step calls `update` with another explicit 50ms. All updates
execute the real render path, including carriers, FIN children and HUD callbacks;
there is no render sampling or null-context switch in the browser helper.

Every 50 ticks, the shared strategy chooses an order. Issuance uses only public
`clearSelection`, `selectUnit`, `setCameraCenter`, `setOrderMode`, `cursorAt`, and
`commandAt`. Camera coordinates are world-up Y: `(point.x + .5, point.y + .5)`.
Clicks use the CSS rectangle's center, accounting for scaling and page offsets.
The initialized CLI's camera clamp and center-click behavior are preserved,
including near map edges; no alternative target correction is introduced.

The helper requires alien source metadata matching ALIEN01, nine TRO blocks,
source production and no native-combat opt-in. These admission guards are not
full cryptographic validation of a caller-modified mission. Supply the original
loader result with all TRO, actors, stats, damage, visibility and production
unchanged. The helper neither injects nor modifies any of these. It also does
not touch `console`, fetch, global state, audio callbacks or storage APIs.

## In-Memory Checkpoints

`onCheckpoint` is optional. When supplied, it receives detached JSON at each
`checkpointEvery` ticks (default 1000). `runner.checkpoint()` explicitly captures
the same `{ view, continuation }` envelope at the current tick. Neither invokes
Save, IndexedDB, local storage or downloads. Keep the user's saved mission intact.

Restoration is explicitly caller-owned and is not required for a browser run.
For a separately constructed view:

```ts
const saved = runner.checkpoint();
const restored = MissionView.restore(canvas, stage, callbacks, mission, saved.view);
await restored.initialize();
const continued = createAlienPlaythroughRunner(restored, {
  outcome: "win", maxTicks: 8000, continuation: saved.continuation,
});
const next = await continued.step(200);
```

The caller supplies the real constructor/canvas/callback ownership and manages
old-view disposal. The helper never swaps a private app view. Continuation keeps
the planner phase, duplicate-command suppression and cumulative evidence counts;
its outcome and tick must match the separately restored view. Its explicit clock
restarts at zero, while absolute simulation ticks and planning cadence continue.

## Separate Node Verification

[alien-playthrough-browser.test.ts](../tools/qa/alien-playthrough-browser.test.ts)
uses the actual original loader, complete original TRO and real generated
assets with the existing Canvas2D platform stub. No actors, damage, credits,
visibility or gameplay configuration are faked. Both trajectories render every
update and restore a separate view at tick 1000 before continuing.

| Outcome | Ready tick | Commands | Shots / deaths | Render callbacks |
| --- | ---: | ---: | --- | ---: |
| Win | 6945 | 88 | 785 / 45 | 7924 |
| Loss | 2465 | 10 | 267 / 1 | 2499 |

Full command hashes (including every command tick, ID, point, mode and purpose)
and final-state hashes exactly match the earlier initialized sampled-render
[baseline](alien-initialized-playthrough-20260921.md). Original objectives,
source immutability, SAWS/SAUC loading, original callback retention and no missing
animation state/timeline/frame warning are asserted. Two additional short tests
cover CSS-scaled/up-Y center clicks, clock bounds, async progress, concurrent
steps, outside clock advances, and unchanged global/console function identities.

The fresh pair passed in about 222 seconds. Its first run reached and matched
both outcomes but failed a test-only PNG-directory assumption; the corrected
test checks the actual fetched animation JSON paths and was rerun in full.
These are real-asset Canvas2D-stub results, not browser pixel, native input,
audio or real-time proof. The original helper task opened no embedded browser;
the later main-owned real-browser results are recorded separately above. This
documentation update launches no browser, tests, code or agents.

Focused reproduction (no recorded trace substitution):

```sh
node --import ./node_modules/tsx/dist/loader.mjs --test tools/qa/alien-playthrough-browser.test.ts
```

Evidence logs:

- `/tmp/dc-browser-runner-fast-20260921-03.log`: two short tests passed.
- `/tmp/dc-browser-runner-trajectories-20260921-05.log`: fresh win/loss passed.
- `/tmp/dc-browser-runner-final-types-20260921-06.log`: scoped strict TypeScript.
- `/tmp/dc-browser-runner-bundle-20260921-07.log`: in-memory browser bundle check.

The original helper change added QA and this document plus the pure-strategy
extraction in the CLI, without runtime changes. Main's later startup recovery,
modifier and resize fixes are separate and summarized in the
[repair report](alien-repair-20260921.md).

## Final Validation And Scope

Existing log footers were read for this docs-only update, with no execution:

- `/tmp/dc-alien-fix-full-20260921.log`: 2,803 tests, 2,799 passed, zero failed,
  four skipped. This earlier state does not certify later modifier/observer edits.
- `/tmp/dc-alien-final-focused-20260921.log`: 112/112 passed, zero failed/skipped;
  its long-outcome cases assert recorded traces rather than fresh playthroughs.
- `/tmp/dc-alien-main-final-20260921.log`: final isolated main checks 18/18 passed,
  zero failed/skipped. Main separately reports strict TypeScript/build passing,
  653.14 kB JS / 204.76 kB gzip, 4.42 s, with the size warning retained.

These overlapping counts are not additive. The metadata audit's 97 focused
passes did not justify a speculative warning fix. Mode5 layer-1 support retains
320 source-exact normal native framebuffers in its bounded matrix, not global
scene parity; global warnings remain. ALIEN01's repaired default browser guard
path and these outcomes do not open ALIEN02 or accept the whole campaign.
Phases 1-2 retain pinned acceptance; phases 3-5 and the prior all-phase goal
remain incomplete. The next bounded source step is in the repair report.