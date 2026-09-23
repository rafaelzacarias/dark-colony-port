# Original Mission 03 Public-Command QA

Follow-up: the historical type94 blocker below is fixed. AL03 now has verified ready WIN at12633, with exact pending12432 -> ready12633 whole-checkpoint restoration and exact pre/post-spawn restoration; see [source artifact support](browser-artifacts-20260922.md). This report's earlier failure evidence is retained. HUMAN03 was not rerun.

## Result

HUMAN03: **verified ready WIN**. ALIEN03: **concrete runtime blocker**, not a timeout or a source LOSS. This is actual original-script `browser-adapted` MissionView with QA NullCanvas. It is not browser rendering, native parity, or full-game completion evidence.

Only new [runner](../tools/qa/mission03-playthrough.ts), [tests](../tools/qa/mission03-playthrough.test.ts), and this document are owned by this task. The M02 strategy, runtime, assets, health, funds, fog, counters, and enemies were not edited. No agents were used.

## HUMAN03

- Original briefing: protect AEROGEN and destroy the alien hive.
- TRO block 1 requires `b(2,0)..b(2,4)` all zero. Blocks 2 and 11 protect player/team7 City respectively.
- Pending WIN tick **6512**, ready WIN tick **6713**, original result/reason **0/1**.
- Full JSON pending checkpoint restore plus **201** normal public updates produced an exactly equal whole ready checkpoint.
- Ready checkpoint SHA256: `ca43a92265d677cfa0f98c5af27538ea5992e746fe3e6230953eb4dc98fd373e` (expected and restored).
- Loader mission SHA256: `5c32ea89521709749f1a11664cf8bdab6e96d7d41e5ac871150cf9fcfeafe75f`.
- Final City: team2 `[0,0,0,0,0]`; player `[4800,2400,0,2400,0]`; team7 `[4800,2400,0,0,0]`.
- Stepping **229408 ms**, under the configured 240000 ms hard cap. Independent proof budget 900000 ms; supervisor exited 0, no expiry.
- 461 movement/assault/harvest commands, 16 accepted infantry purchases, 3898 combat events, 21 deaths. Economy: initial 3000 + earned 7014 - spent 5600 = final 4414. Commander survived at 800 HP.
- Artifacts: `/tmp/dc-m03-human-b1/human/` contains `source.json`, `initial.json`, `journal.jsonl`, `pending-win.json`, `checkpoint.json`, `proof.json`, `result.json`, `integrity.json`, `exit.json`. Runtime hashes before/after equal, including the unchanged M02 fixture.

## ALIEN03

- Original briefing: locate Ancona's secret, protect it, destroy the human outpost.
- Original block 3 starts disabled and requires team1 City slots 0..4 all zero. Trip 8 executes `setlifes 3 1`, then `reinforce2 0 92 10 94 1 ...`. Block 9 loses on `s(2,3)==1`.
- The source MTG is vertically inverted into runtime coordinates and masked to its low six bits. The commander receives public Move orders from `(52,16)` toward tagged `(92,10)`; other troops remain near home until discovery.
- Actual commander type73, simulation id3, reaches `(91,10)` and attempts the tagged next reservation. View freezes at **tick350** with:

```json
[{"code":"invalid-input","message":"Missing source definition for type 94","triggerId":8,"actionIndex":1}]
```

- The transaction rejects the trip's spawn action. No committed trip8, enabled-win assertion, type94 spawn, pending WIN, or ready WIN is claimed. The source outcome is `null`; both teams' City remain `[4800,2400,0,0,0]`.
- Root boundary: [campaign-session.ts](../src/engine/campaign-session.ts#L350) admits transport definitions only for movement classes 0/1; [transport-host.ts](../src/engine/transport-host.ts#L541) cannot resolve requested type94. This task does not add a definition or bypass that guard.
- Final-code reproduction: `/tmp/dc-m03-a03-regression-70411-1790142878472/`; **10573 ms** stepping, 25 public commands, four infantry purchases, zero shots/deaths. Initial 3500 + earned330 - spent1400 = 2430. Stable runtime hashes.
- Loader mission SHA256: `c7b092f45420bc1fb761ec1007d05e985cb3554296dc4b22956f5ce993ccd4a4`.
- Earlier same-failure artifact: `/tmp/dc-m03-opening-1790142802/alien/`. Two HUMAN opening workers were interrupted by external terminal SIGINT; their SIGKILL receipts have `expired:false` and are not runtime failures or acceptance runs. The isolated final HUMAN worker completed normally.

## Original Hashes

| Source | HUMAN03 SHA256 | ALIEN03 SHA256 |
| --- | --- | --- |
| SCN | `988d479b35a3a412f4d57203c191b07d568751e9c86194b6d47d2a4c281cfe41` | `34af128654e5dda40484326b83bb4daee49de3a115307c37688243c3133a4aad` |
| TRO | `e96ba453ba46221caa851d94c175f937a9fac01e6852b024f2ac35e79e1a6ede` | `95bf3e46e29a40713c2b163a257657e2c5d109ed6f35765e5c96025154bd57b6` |
| MAP | `64b30e8d6048ae85dfeb89e5795276e70bbac7d3521bb69d58f25b8e45dbe5b2` | `475b165159bae40998017e9b6bb8772491d3b2fbd7316663f95cf4885e71a885` |
| MTG | `a6eae2f3a3958eb926ff485957f263ed91d630a84f56a091f7a2ddfb0e6451b2` | `6e1cd0d973598dcde626a97577896ebd43f0e19bc31addbc982ce1a8e4ce8d0f` |
| PTH | `a447ba7e3445ee6abc7a6d4ae1ef1b5dfb12ca5b05782c850c252e007555e1c1` | `230f3cc1169762e68edc86141431488b91765ba53d59686115de1cdc33aa3c4a` |

## Reproduction

Run from the repository root. Always choose a fresh absolute output directory. Missions execute sequentially in separate workers to release memory. No M02 strategy is imported.

```sh
DC_M03_OUTPUT=/tmp/dc-m03-unique DC_M03_STEP_MS=600000 \
  node --import tsx tools/qa/mission03-playthrough.ts --run
node --import tsx --test tools/qa/mission03-playthrough.test.ts
DC_M03_ACTUAL=1 DC_M03_HUMAN_PROOF=/tmp/dc-m03-human-b1/human \
  node --import tsx --test tools/qa/mission03-playthrough.test.ts
```

Use `--faction=human` or `--faction=alien` to select one mission. Without `--run`, preflight writes original briefing, initial map/units/City, source hashes and loaded menu. `DC_M03_MAX_TICKS` defaults to 30000, maximum 60000. `DC_M03_STEP_MS` defaults to 240000, maximum 600000. The worker reserves 3 seconds for the transition out of stepping; an independent supervisor enforces the hard cap and kills/reaps its process group on expiry. Initialization/restore, finalization, and exact proof have independent 900000 ms caps. No aggregate guarantee that two worst-case restore/proof runs fit twenty minutes.

For a saved legitimate run, combine one faction with `DC_M03_RESUME=/absolute/checkpoint.json`. To retry only proof, use `DC_M03_PROOF=/absolute/artifact-directory` with `--run --faction=human`; proof requires pending and ready checkpoints and exact original mission identity. Commands stop after pending WIN, so its continuation contains only normal updates.

Source `ready` outcome, harness deadline/tick cap, and runtime diagnostic are separate result classes. Non-WIN runs exit nonzero. `integrity.json` records every fetched data asset hash plus runtime hashes; a concurrent runtime change marks the result `RUNTIME_CHANGED`, rather than silently accepting a mixed revision.

## Validation

Five tests passed, none skipped, including actual A03 commander identity/public tagged Move reproduction and H03 exact proof artifact checks: `/tmp/dc-m03-final-b6-tests.log`. Scoped strict TypeScript passed: `/tmp/dc-m03-final-b6-types.log.exit.json`. Final A03 repeat: `/tmp/dc-m03-a03-regression-73419-1790143020087/`, same tick350 failure. Source/link/process audit: `/tmp/dc-m03-final-audit-b5.json` (no active runner workers; hashes of the files there precede the final test/document-only edits). No full suite or browser parity test was run.