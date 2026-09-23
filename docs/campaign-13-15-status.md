# Campaign 13-15 Status

## Scope and Acceptance

Owned files only: [driver](../tools/qa/campaign-13-15.ts), [tests](../tools/qa/campaign-13-15.test.ts), and this document. Runtime, original sources, generated assets, and shared fixtures are not edited. No agents or full suite.

The driver loads the original missions through `loadCampaignMission(..., "browser-adapted")` and uses real `MissionView` public selection, camera, command, harvest, production, and construction APIs. It imports the nearby mission06 pure trip-cell and air helpers and source-render fixture. It does not modify health, credits, source conditions, fog, statistics, or checkpoint contents. Original scripted resource/economy changes remain active.

This is original-script browser-adapted public play under Node/NullCanvas, **not native executable parity, browser pixel verification, or full-game completion**. A ready result requires actual source `bail 0 1`; exact acceptance additionally requires guarded JSON restoration of the pending view and complete checkpoint equality after ordinary updates to ready. A tick census, pending bail, or parseable checkpoint is never completion.

## Complete Source Goals

All original SCN teams/placements, complete TRO blocks/actions, and TXT briefings are recorded in each `source.json`. SHA256 covers SCN/TRO/TXT/MAP/MTG/PTH. Generated SCN base64 bytes must exactly hash to original SCN; complete parsed SCN and TRO are compared. MTG trip cells use the original bottom-to-top inversion and low six tag bits.

| Mission | Original win | Original loss | Other required script behavior |
| --- | --- | --- | --- |
| H13 | TRO2: `b(team,slot)==0` for teams 1,2,3, all slots 0-4 | TRO10: player slots 0-4 all zero | Commander recovery TRO0/1; timed resources TRO3-8; startup exomoney TRO9 |
| A13 | TRO5: teams 2,1, all slots 0-4 zero | TRO6: player slots 0-4 all zero | Recovery TRO7/8; resources TRO0-4,9,10 |
| H14 | Trip3 `(S==0)`: reinforce2 type10, messages2/1, `bail 0 1` | TRO18: one loss of source commander type69/70/71/72 | Trips1/2 waypoint orders; trip20 AI selector change |
| A14 | Trip3 `(S==0)`: reinforce2 type10, messages2/1, `bail 0 1` | TRO18: one loss of type73/74/75/76 | Trips1/2/4 waypoint orders |
| H15 | TRO2: teams 1,2,4, all slots 0-4 zero | TRO1: player slots 0-4 all zero | Recovery TRO3/4 uses authored selector2; timed resources; startup aimsg/exomoney; escalation TRO21/22 |
| A15 | TRO4: teams 1,2,4, all slots 0-4 zero | TRO3: player slots 0-4 all zero | Recovery TRO1/2; startup aimsg/exomoney; escalation14/15; TRO18 `c>180` delivers type105 and enables waypoint13 |

`S` is the entering team index, `t` the entering source unit-type index, and `c` the cycle counter shifted right four. Neither chamber win tests `t`, so it does not require a commander or guessed artifact type. Tests exercise the real evaluator with independent time/team/type values. Exact source conditions, including H15's unusual recovery selector, are not rewritten.

## Runtime Attempts

Current artifact root: `/tmp/dc-campaign1315-original-20260923-r3`.

The first two preflights stopped in QA source authentication before simulation: encoded SCN bytes were initially mistaken for text. They are not runtime blockers or playthrough evidence. The corrected tests cover real generated base64 envelopes for all six sources. Earlier roots `r1` and `r2` remain as audit evidence.

The group reserves at most 600000 ms for workers and 480000 ms for restores, uses sequential child processes, and SIGKILL at the hard deadline. Each completed child is reaped before the next starts. Chamber cases receive priority; unfinished colony cases preserve checkpoints and exact diagnostics rather than claiming wins.

Final results are recorded below after worker completion.

## Mandatory Full-Game Gaps

H15's TXT explicitly promises ESGAARD. A15's TXT explicitly requires PORTALIS deployment; original TRO18 delivers source type105/PORT, weapon47, at `c>180`. [MissionView deployment](../src/mission-view.ts#L1228) currently accepts only type4 SARGE, so PORTALIS deployment is unsupported by that public action. Do not present an ordinary colony win as verification of this mandatory feature.

[Artifact admission](../src/engine/browser-artifacts.ts) recognizes type63/LENS with weapon46 as a movable excavation artifact but removes its ordinary weapon, and recognizes type94/DOTT only as a static vision artifact. Excavation presentation is not special-weapon deployment/attack support. Mission15 source-class failures must be passed to the runtime owner, not bypassed by deleting the artifact or rewriting its weapon.

Construction, upgrades, research, artifacts, theft, mines, and economy are left live in the loader/runtime. This bounded driver exercises available ordinary purchases/harvest/combat; it does not certify every full-game feature or special source action merely because initialization or a goal succeeds.

## Reproduction

```sh
node --import tsx --test tools/qa/campaign-13-15.test.ts
node --import tsx tools/qa/campaign-13-15.ts --run --output=/tmp/dc-campaign-13-15-new
DC_CAMPAIGN_13_15_ARTIFACTS=/tmp/dc-campaign1315-original-20260923-r3 node --import tsx --test tools/qa/campaign-13-15.test.ts
```

Worker mode accepts `--case=H14`, `--output=...`, `--allowance=...`, and optional `--resume=/absolute/checkpoint.json`. `--proof` replays the existing pending/ready pair in its output directory. Use the group supervisor for automatic hard deadlines; direct worker use requires an external hard cap and must stay within the remaining aggregate budget.