# Campaign Openings Independent Judge

Generated: 2026-09-23T01:02:40.761Z

**Opening milestone: PASS. Full game: FAIL.**

30/30 loaded, 30/30 initialized, 30/30 reached tick 200, 30/30 JSON-restored, 30/30 matched the complete 100-tick continuation, 30/30 reached tick 1200.

0 observed runtime failures; 3 missions with nonfatal armed-static/mine functional failures; 0/30 ready outcomes. Startup is not completion.

Measured harness duration: 2274.7 seconds for all30; 498.5 seconds for the separate mission12 probe. These include Node rendering stubs, source replay and concurrent machine load, not browser frame-time benchmarks.

## Method

Actual original loadCampaignMission and initialized MissionView.update(50ms); HUMAN01/ALIEN01 strict, all M02-M15 browser-adapted, matching main's default route. Full original SCN/TRO, no filtered blocks, injected events, orders, counters, runtime edits, agents, package/asset changes or full suite.

JSON restore at tick 200, asset initialize, then original/restored views run independently to 300. Deep equality covers the complete checkpoints, including simulation, actors, bindings, world, controller, owners, journal and source identity. Natural continuation then targets tick 1200. Canvas2D/WebGL/Image are stubs: this is not a real-browser pixel/native-parity pass.

All 90 original SCN/TRO/MAP files match source hashes and remain unchanged. Runtime/extractor/historical-report paths changed during execution: src/engine/simulation.ts, src/mission-view.ts. Concurrent changes do not retroactively enter the tested process.

Actual census artifact: /tmp/dc-openings-judge-1790122596399.json; SHA-256 891ab83f3b9a1e7a92d15e146bfb53ed34a8c48d538476b9a7d4e9495b107d2b. Detailed evidence is embedded in [the JSON report](campaign-openings-judge-20260922.json).

## Actual Missions

| Mission | Load/Init | Tick 200 | Restore +100 | Last tick | Compatibility |
| --- | --- | --- | --- | --- | --- |
| HUMAN/HUMAN01 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN02 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN03 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN04 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN05 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN06 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN07 | true/true | true | true/true | 1200 | failed-static-weapon-adapter |
| HUMAN/HUMAN08 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN09 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN10 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN11 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN12 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN13 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN14 | true/true | true | true/true | 1200 | bounded-runtime-only |
| HUMAN/HUMAN15 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN01 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN02 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN03 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN04 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN05 | true/true | true | true/true | 1200 | failed-static-weapon-adapter |
| ALIEN/ALIEN06 | true/true | true | true/true | 1200 | failed-static-weapon-adapter |
| ALIEN/ALIEN07 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN08 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN09 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN10 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN11 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN12 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN13 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN14 | true/true | true | true/true | 1200 | bounded-runtime-only |
| ALIEN/ALIEN15 | true/true | true | true/true | 1200 | bounded-runtime-only |

## Current Blocks

The census loaded its runtime before the concurrent dedicated-mine implementation was added. Missing-mine observations below describe that tested version. The current owner exists in [browser-mines.ts](../src/engine/browser-mines.ts); this independent census does not certify its detonation, splash, one-shot death or source casualty behavior.

- HUMAN/HUMAN07: nonfatal-functional-failure; Missing dedicated mine detonation/splash owner (nonfatal behavior failure); type 45, actor placement:27.
- ALIEN/ALIEN05: nonfatal-functional-failure; Missing dedicated mine detonation/splash owner (nonfatal behavior failure); type 45, actor placement:1.
- ALIEN/ALIEN05: nonfatal-functional-failure; Missing dedicated mine detonation/splash owner (nonfatal behavior failure); type 45, actor placement:2.
- ALIEN/ALIEN05: nonfatal-functional-failure; Missing dedicated mine detonation/splash owner (nonfatal behavior failure); type 45, actor placement:3.
- ALIEN/ALIEN05: nonfatal-functional-failure; Missing dedicated mine detonation/splash owner (nonfatal behavior failure); type 45, actor placement:17.
- ALIEN/ALIEN06: nonfatal-functional-failure; Missing dedicated mine detonation/splash owner (nonfatal behavior failure); type 45, actor placement:27.
- All 30 complete original win/loss outcomes and all-feature playthroughs.
- Late original predicates beyond each recorded natural tick; no counters or events injected.
- Mine detonation/splash/casualty correctness is not inferred from nonfatal startup or newly added code.
- Spy-enabled type37 art and collection are not certified by preserved hidden markers.
- AL08 team6 automatic-pickup suppression requires an actual qualifying death; flag publication alone is insufficient.
- Player harvesting/purchases are not performed in this autonomous census; configuration is not functional proof.
- Native parity and real browser/GPU rendering are outside this Node real-loader/real-view census.

## Bounded Evidence

- Actual strategy decision modes observed: 1, 3. Positive earned income in 0/28 adapted missions; zero player orders/purchases were issued. Full per-team amounts and decision counts are in JSON.
- HUMAN05: independent native original loader/parser comparison passed for all 16 messages, including original `text 5.`; complete original loader source equality passed. No assets were regenerated by this audit.
- HUMAN07: actual initialized source mission now reaches tick1200 and restores identically; former delivery collision at tick82 did not recur.
- ALIEN06: actual initialized source mission now reaches tick1200 and restores identically; former ORTU admission failure at12,74 did not recur. Source class2/air-plane contract is not a native flight-parity claim.
- ALIEN08: original nopickup6 event applies with the adapted casualty owner. No qualifying team6 commander death occurred in the natural 1200-tick window; suppression and other-team behavior remain unproven here.
- Type37: 37 initial markers in 12 missions; identities preserved in 12/12; 0 POOP requests; 0 failed asset reads.
- HUMAN/HUMAN12: natural effects vision; 2 source-owned effect events.
- HUMAN/HUMAN15: natural effects aimsg; 12 source-owned effect events.
- ALIEN/ALIEN05: natural effects vision; 3 source-owned effect events.
- ALIEN/ALIEN08: natural effects nopickup; 1 source-owned effect events.
- ALIEN/ALIEN10: natural effects vision; 1 source-owned effect events.
- ALIEN/ALIEN15: natural effects aimsg; 12 source-owned effect events.
- HUMAN12/ALIEN12 first newrate clock threshold: c>240, tick 3856. HUMAN12 initial reinforce2/waypoint sequence begins c>30, tick 496; trip predicates still require real arrivals. See original conditions and per-mission evidence, never substitute t with time.

## Natural Late Probe

- HUMAN/HUMAN12: initialized true; actual tick 3900/3900; diagnostic none; first failure none; source newrate commands 2.
- ALIEN/ALIEN12: initialized true; actual tick 3900/3900; diagnostic none; first failure none; source newrate commands 3.
- All 90 original source hashes unchanged. Runtime paths changed during this separate run: none.
- Complete source commands, world and controller evidence are embedded in lateProbe in the JSON report. No predicates, statistics or event inputs were manufactured.

## Next Gates

- HUMAN/HUMAN12: tested through 3900; next clock gate (c>300) at tick 4816, block 14 (reinforce2, reinforce2, msg, setlifes, setlifes, setlifes).
- ALIEN/ALIEN12: tested through 3900; next clock gate (c>450) at tick 7216, block 8 (newrate, newrate, newrate).
- ALIEN08: actual team6 commander death, source block9 follow-up, and unaffected other-team automatic pickup still need natural playthrough proof. No death/statistic was injected.
- Native aimsg/dfiddle parsing evidence is prior bounded evidence, not new full-native gameplay certification. dfiddle had no natural event in this census; aimsg did. Unknown/unreached predicates are not marked ready.

## Reproduce

```sh
DC_OPENINGS_JUDGE=1 DC_OPENINGS_LATE_TICK=1200 DC_ADAPTED_CENSUS_OUTPUT=/tmp/unique-openings-census \
  node --import tsx --test tools/qa/campaign-adapted-census.test.ts
node tools/qa/campaign-openings-judge-report.mjs /tmp/unique-openings-census.json
```
