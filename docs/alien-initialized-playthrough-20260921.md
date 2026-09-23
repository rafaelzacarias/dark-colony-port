# ALIEN01 Initialized Public Playthrough

These are historical pre-stationary-gate results. The current fresh four-case
validation is tracked in [the stationary-fire QA report](stationary-fire-playthrough-20260921.md).

## Result

The default original ALIEN01 completes both intended outcomes through the actual
public `MissionView`, with real generated asset loading, sampled rendering,
an in-memory JSON checkpoint at tick 1000, fresh restored-view initialization,
and continued public commands/combat. No new blocking runtime failure was found.

| Route | Ready result/reason | Tick | Commands | Shots/deaths | Objective |
| --- | --- | ---: | ---: | --- | --- |
| Win | 0 / 1 | 6945 | 88 | 785 / 45 | `s(1,0,82)=11`; commander losses 0 |
| Loss | 1 / 2 | 2465 | 10 | 267 / 1 | `s(0,0,73)=1` |

Both have null mission diagnostics. There are 73/4 commands after restoration,
respectively, and combat continues afterward. Win/loss final-state hashes:

- Win: `2bdf8c2d9a79296397dd9afc45a70d8287299bcf54f69bc378101e4cca6b4198`.
- Loss: `e19d3efefdd5c03767671bd7ed6fca3c4d2d0ae988ab255951eca4be77768e47`.

The historical no-context win at tick 7241 is not an initialized-render baseline.
The renderer clamps the camera, including inside public `setCameraCenter`,
whereas a null-context render exits before clamping. The planner clicks the
viewport center, so these harnesses can issue different effective destinations
near map edges. This run is not claimed to reproduce the old win command hash.
The loss tick, command/combat hashes and final hash do match the historical loss.

## Integrity And Presentation

[source-playthrough.ts](../tools/qa/source-playthrough.ts) retains the complete
nine-block original TRO, SCN actors, original stats, damage matrix, source
production configuration and default generic browser policy. Source hashes and
fresh parser comparisons run before the attempt; the complete loaded mission
hash is unchanged afterward. No actor/HP/credits injection, target rearming,
trigger filtering, private command queue or native bounded combat opt-in is used.
Planning remains source-aware automation, not a human-information-only player.
Selection, camera, order mode and `commandAt` are public APIs.

`--render` initializes the real view with the
[2D platform fixture](../tools/qa/fixtures/source-render.ts), patterned after
[the opening alien regression](../tools/qa/mission-alien-regression.test.ts).
It reads actual generated JSON/indexed palette data and PNG headers/dimensions.
Real FIN selection, sampling, child composition and draw dispatch execute.
Image decoding and Canvas2D methods are stubs; this is not pixel/screenshot proof.
WebGL2 is deliberately unavailable, so terrain uses its explicit RGBA fallback.

The opening 200 updates render continuously; later updates render every 25 ticks
and at command ticks. Initialization, restore and final outcome also render.
The logs contain 27 win and 9 loss phase records, with 18,625/1,694 palette-backed
image draw calls respectively (not unique sprites or pixel counts). Loaded
archives include SAWS **and** SAUC, GRAY, TRSC, SALA, CENT, ALBU and DROP.
The opening regression separately verifies four GRAY plus commander delivery.
Observed campaign types are 0, 8, 69, 73, 82 and 89; carrier presentation is
additional to that world-entity list. Combat, deaths, reinforcement trips and
the final source objective are reached naturally.

No `missing-state`, `unsupported-timeline` or `missing-atlas-frame` diagnostic
was recorded. Existing warnings remain: native cadence/events, cross-entity
sorting, shadow/draw modes and nearest-direction death-bank fallback. Do not
claim native visual parity, WebGL correctness, audio, browser input or real-time
performance. No full fresh exact replay was added to these expensive runs.

## Fixtures And Checks

- [source-playthrough-render.test.ts](../tools/qa/source-playthrough-render.test.ts):
  actual default ALIEN01 win/loss, source objectives, assets and restored continuation.
  By default launches fresh processes. `DC_AL01_RENDER_WIN_TRACE` and
  `DC_AL01_RENDER_LOSS_TRACE` explicitly switch to recorded-trace assertions only.
- [alien-animation-assets.test.ts](../tools/qa/alien-animation-assets.test.ts):
  three original FIN/parser/selector/composition cases for BEAC, BEEK and ATRIL,
  including original FIN hashes, GAMESTAT identities and PNG dependencies.
  The source name is **ATRIL**, type 11, not ARTL.
- Its fourth case is a **synthetic visual-discovery fixture** for `newtype` BEAC.
  It tests preload discovery only, does not run a modified campaign and does not
  claim later-mission completion. ALIEN01 has no `newtype` BEAC action.

The initial outcome test required the historical win tick and failed with
`6945 !== 7241` **after a successful ready victory**. The corrected assertions
validate original objectives instead of imposing the null-render trajectory.
Both completed traces pass those assertions; they were not rerun merely for
that assertion change. Four asset tests, the existing opening regression,
scoped strict TypeScript and editor diagnostics pass. Only QA/tools/docs changed.

An earlier every-tick win attempt was intentionally stopped for cost and is not
counted as a completion. An every-tick loss also completed at 2465. The sampled
fresh pair took about 245/60 seconds on this shared machine, not 20 seconds.
No browser, agents, full suite, Git commands or user save files were used.

## Exact Logs

- Win: `/tmp/dc-al01-win-complete-20260921-r13.jsonl` (309716 bytes), SHA-256
  `cac33a05603d73b809c447b74e8cff59ba74276740319b38a54360f1977f9ca8`.
- Loss: `/tmp/dc-al01-loss-complete-20260921-r14.jsonl` (128081 bytes), SHA-256
  `d316083d62fe59bb1f6dd8b38a23fe0b0818c5263edd7b5dee5eb916fe7755a6`.
- Summary/objectives/checksums: `/tmp/dc-al01-final-evidence-20260921-r15.log`.
- Fresh pair, obsolete tick assertion failure: `/tmp/dc-al01-render-regression-20260921-r06.log`.
- Corrected recorded assertions, 2 pass: `/tmp/dc-al01-recorded-assertions-20260921-r09.log`.
- Asset/discovery tests, 4 pass: `/tmp/dc-alien-alias-focused-20260921-r12.log`.
- Scoped strict TypeScript, clean: `/tmp/dc-al01-owned-types-20260921-r16.log`.
- Opening regression, 1 pass: `/tmp/dc-al01-initial-regression-20260921-181406-45503.log`.
- Every-tick loss completion: `/tmp/dc-al01-render-loss-1790039726351.jsonl`.
- Cancelled partial win: `/tmp/dc-al01-render-win-1790039703153.jsonl`.

Fresh reproduction (no recorded-trace environment variables):

```sh
node --import /Users/rafael/Downloads/darkcolony/node_modules/tsx/dist/loader.mjs --test /Users/rafael/Downloads/darkcolony/tools/qa/source-playthrough-render.test.ts
node --import /Users/rafael/Downloads/darkcolony/node_modules/tsx/dist/loader.mjs --test /Users/rafael/Downloads/darkcolony/tools/qa/alien-animation-assets.test.ts
```

Runtime-owner handoff: **No new blocking runtime defect reproduced. Retain
`missionAnimationArchives("SAUC") = ["SAWS", "SAUC"]`; default original ALIEN01
now reaches initialized public win/loss with restored continuation. This is
Canvas2D-stub asset/composition evidence, not native/browser visual parity.**