# Stationary-Fire Default Campaign QA

## Scope

This QA-only check runs fresh default HUMAN01 and ALIEN01 win/loss routes after
the stationary-fire gate. The pre-gate ALIEN01 6945/2465 ticks are historical
evidence, not asserted current expectations.

| Case | Ready result/reason | Tick | Shots | Deaths | Movement violations | Replay |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| HUMAN01 win | 0 / 1 | 5177 | 778 | 27 | 0 | Exact |
| HUMAN01 loss | 1 / 3 | 2473 | 267 | 1 | 0 | Exact |
| ALIEN01 win | 0 / 1 | 6945 | 785 | 45 | 0 | Exact |
| ALIEN01 loss | 1 / 2 | 2465 | 267 | 1 | 0 | Exact |

All four intended outcomes are ready with null mission diagnostics. Four fresh
primary runs plus four exact replays audit 34120 ticks, 4194 shots and 148 deaths,
with zero shot displacement, retained-path or movement-reservation violations.
Each run initializes real assets and renders every tick, including all combat
and death transitions. The four regression cases took 935.16 seconds combined.
No blocking runtime defect was reproduced in these routes.

The historical human 4769/2481 runs used no render context. The older alien
6945/2465 pair sampled rendering. These new executions use the current gate
and every-tick rendering, so changed ticks/hashes are not attributed solely to
one engine edit. No old expected hash was overwritten.

Observed final-state SHA-256 values (replay status is listed above):

- HUMAN01 win: `90194db14c5db4ccbd299ad40a56110a44e5116dd4a5f1bc0bb0861b1c0de9fc`.
- HUMAN01 loss: `d4ae306af09fe0be3894b66394e7faa05eb038e1cdab8638fad3f811b3aa57d4`.
- ALIEN01 win: `2bdf8c2d9a79296397dd9afc45a70d8287299bcf54f69bc378101e4cca6b4198`.
- ALIEN01 loss: `e19d3efefdd5c03767671bd7ed6fca3c4d2d0ae988ab255951eca4be77768e47`.

These are trace results, not replacement hardcoded test expectations.
Both ALIEN01 ticks, shot/death counts and final-state hashes match the prior
initialized-render baselines despite switching to every-tick rendering.

[The runner](../tools/qa/source-playthrough.ts) retains the unchanged
[source-aware public-command strategy](../tools/qa/fixtures/source-playthrough-strategy.ts).
Original SCN/TRO/MAP/MTG/PTH hashes, all nine TRO blocks per mission, original
GAMESTAT/WEAPSTAT/MBULLET data and source production configuration are checked.
The loaded mission hash is unchanged after each run. No HP, funds, units,
visibility, triggers, simulation commands or native state are injected.
This is the default policy, not an explicit bounded native-combat profile.

The four [campaign regression cases](../tools/qa/source-playthrough-stationary.test.ts)
initialize the actual view and generated assets, render every update, roundtrip
an in-memory JSON checkpoint at tick 1000, initialize the restored view, and
continue to the original outcome. Each successful route is repeated from a fresh
view using recorded public commands at their original ticks. Complete final
state, command, combat and movement-audit hashes must match exactly. There are
no old hardcoded outcome ticks or final hashes to silently update.

## Movement Audit

Optional `--audit-fire-movement` captures detached simulation checkpoints
immediately before and after every 50 ms update. The
[audit helper](../tools/qa/fixtures/source-fire-movement-audit.ts) requires exactly
one simulation tick and verifies every shot event, including enemy shots and
lethal frames:

- The shooter exists in both frames and event ticks match the update.
- Exact integer X and Y subcells are unchanged, independent of activity labels.
- The post-update path is empty, path cursor zero and destination reservation null.
- No reservation event was issued for that shooter during the update.
- Death events have the same tick; all frame movement and activity transitions
  are counted, including frames without shots.

A pre-update path may legitimately be cleared by range acquisition before
firing without displacement. Ordinary grid occupancy reservations are not
movement intents and are not required to disappear. A dying shooter is still
audited. The check observes complete update boundaries, not an instrumented
private weapon method; it does not claim original-executable instruction parity.

Every shot's before/after evidence is written in `fire-movement` JSONL records;
`fire-movement-complete` reports counts and a deterministic audit digest.
Any violation throws immediately with shooter/tick/position/path/reservation
details and prevents a successful completion summary. Runtime and strategy
file hashes are recorded at process startup for provenance.

Six [audit tests](../tools/qa/source-fire-movement-audit.test.ts) exercise stationary
and lethal shots, legitimate cleared old paths, each displacement axis with
misleading final attack activity, remaining paths/cursors/reservations,
transient reservation events, missing shooters, stale/skipped events and
non-shooting movement. These synthetic negative controls are not campaign inputs.

The fresh HUMAN01 victory exercises 82 shots whose old path is cleared without
displacement, 60 whose old destination reservation is cleared, 21 whose activity
changes across the frame, and 40 shots on ticks containing deaths. Its audit
counts 27792 moved-unit updates and 595 activity transitions across all frames.
HUMAN01 defeat counts 2596 moved-unit updates and 168 activity transitions,
including the commander death. Both repeat with identical audit hashes.
ALIEN01 victory counts 28679 moved-unit updates and 874 activity transitions;
all 785 shots are stationary with no retained path or destination reservation.
ALIEN01 defeat counts 166 moved-unit updates and 13 activity transitions.
Both alien replays also match the complete audit hashes exactly.

## Rendering And Limits

[The existing Node render fixture](../tools/qa/fixtures/source-render.ts) loads
real generated JSON, palettes and PNG headers/dimensions. Actual FIN selection,
sampling, child composition and draw dispatch run, including restored views.
ALIEN checks explicitly require SAWS and SAUC, plus GRAY, SALA and TRSC. Both
factions reject missing-state, unsupported-timeline and missing-atlas-frame
warnings. `renderedFrames` must equal the final simulation tick.

The primary human victory/defeat runs issue 72116/9326 palette-backed sprite draw
calls and each loads 35 PNG URLs. Draw counts are calls, not pixel coverage or
unique sprites; replay counters are cumulative within each process.
ALIEN01 victory/defeat issue 102504/17021 sprite draw calls and each loads 21 PNG URLs.

Existing warnings for unverified native cadence/events, cross-entity sorting,
native shadows/draw modes and direction/state fallback remain visible in the
traces. They are not suppressed or represented as missing-asset failures.

Canvas2D methods and image decoding remain platform stubs. No browser, pixels,
WebGL, audio, manual-input or native visual-parity claim is made. Strategy
planning is source-aware, not human-information-only. No agents, full suite,
packages, generated assets or IndexedDB are used or modified. Engine, renderer
and main code are outside this QA owner's edit scope.

## Reproduction

```sh
node --import tsx --test tools/qa/source-fire-movement-audit.test.ts
node --import tsx --test tools/qa/source-playthrough-stationary.test.ts
node --import tsx tools/qa/source-playthrough.ts --case=alien-win --render --render-every=1 --restore-at=1000 --limit=8000 --audit-fire-movement
```

Each campaign case starts a fresh process by default and writes to a unique
`/tmp/dc-stationary-<faction>-<intent>-*/trace.jsonl`. The per-attempt budget is
8000 ticks; runner invocations retain the combined 40000-tick ceiling. A failed
intended outcome remains a failure, not an updated expectation.

Explicit `DC_STATIONARY_HUMAN_WIN_TRACE`, `DC_STATIONARY_HUMAN_LOSS_TRACE`,
`DC_STATIONARY_ALIEN_WIN_TRACE` and `DC_STATIONARY_ALIEN_LOSS_TRACE` variables
request recorded-trace assertions only. Such rechecks must not be described as
fresh playthroughs. No environment variables are needed for fresh execution.

## Evidence

- First edit validation: `/tmp/dc-fire-audit-first-20260921-231425-59784.log`,
  six tests pass.
- Integrated audit validation: `/tmp/dc-stationary-audit-tests-20260921-q03.log`,
  six tests pass.
- Scoped strict TypeScript: `/tmp/dc-stationary-owned-types-20260921-q02.log`,
  clean; four edited QA files also have no editor diagnostics.
- Fresh campaign execution: `/tmp/dc-stationary-four-fresh-20260921-q04.log`.
  Four fresh campaign regression tests pass, including all four exact replays.
- HUMAN01 win and replay: `/tmp/dc-stationary-human-win-OewBBU/trace.jsonl`,
  1094950 bytes, SHA-256
  `cebcc273f217a19ac5ad88ea3b21e40d825b3fc5eb96e04381e4504f52cc3212`.
- HUMAN01 loss and replay: `/tmp/dc-stationary-human-loss-a9v76w/trace.jsonl`,
  464075 bytes, SHA-256
  `16267382a5399010a81b7865b3c122de7f4b586113920914077575bb0860c58e`.
- Human outcome table and replay validation:
  `/tmp/dc-stationary-human-doc-check-20260921-q06.log`.
- ALIEN01 win and replay: `/tmp/dc-stationary-alien-win-5BdXa6/trace.jsonl`,
  1145919 bytes, SHA-256
  `0104fd9e28e621f1eba0dd73831a286e66b8d1b32fb6fafff70b42f758c242ea`.
- ALIEN01 loss and replay: `/tmp/dc-stationary-alien-loss-hPxEow/trace.jsonl`,
  443100 bytes, SHA-256
  `d9562649c6033ccf796055f92f41d5e47ee4060db7d4b6e1a742077709c8ce97`.
- Existing initialized alien render assertions against these fresh traces:
  `/tmp/dc-stationary-existing-render-assertions-20260921-q13.log`, two pass.
  This is a recorded-trace recheck, not two additional fresh executions.
- Independent comparison of all 4194 saved shot records to actual combat
  events, exact XY/path/reservation assertions, trace digests, totals and
  current-source fingerprint verification:
  `/tmp/dc-stationary-final-verified-evidence-20260921-q14.log`, pass.

Ten new tests pass (six audit controls and four campaign cases), plus the two
existing render assertions. No skips or failures. The first substantive edit
was followed immediately by the six-test audit validation before runner changes.

All four process-start runtime fingerprints are identical and match the files
at final verification. The stationary-gate simulation SHA-256 is
`2703fae82c3859704a9bed84f718a52c225a21c6f21fd8461563a51a0282759c`;
the unchanged command strategy SHA-256 is
`8fc22969086ca80745949f004cbd8070bb22becd945219aec472efb72ccc9b44`.

## Owned Files

- [tools/qa/source-playthrough.ts](../tools/qa/source-playthrough.ts): optional audit and evidence only.
- [tools/qa/fixtures/source-fire-movement-audit.ts](../tools/qa/fixtures/source-fire-movement-audit.ts): new read-only helper.
- [tools/qa/source-fire-movement-audit.test.ts](../tools/qa/source-fire-movement-audit.test.ts): six new controls.
- [tools/qa/source-playthrough-stationary.test.ts](../tools/qa/source-playthrough-stationary.test.ts): four new campaign regressions.
- [docs/stationary-fire-playthrough-20260921.md](stationary-fire-playthrough-20260921.md): this report.
- [docs/source-playthrough-20260919.md](source-playthrough-20260919.md): current report link and CLI option.
- [docs/alien-initialized-playthrough-20260921.md](alien-initialized-playthrough-20260921.md): historical-baseline label and current report link.