# Release Revalidation, 2026-09-23

Working tree on top of `2a0a4da` (uncommitted). This report covers the harness
reliability fixes, the shared-mechanics additions and the one-revision
revalidation of all thirty campaign missions.

## Critical finding: six missions did not load in the shipped game

`main.ts` loads campaign missions with `campaignConstructionPolicy(...)`
(construction enabled from mission 4 up). Every QA driver and the adapted
census loaded missions **without** that policy, so they tested a
configuration different from the shipped one.

Loading all thirty missions exactly as `main` does exposed this:
`createBrowserConstructionConfiguration` threw
`Cannot read properties of undefined (reading 'unitType')` for
**H06, H11, H14, A05, A09 and A14**. These are commando missions whose SCN
player team has no city location (`coordinateRows[1] = [0,0]`). There is no
slot-0 building to project, so they failed at load in the browser.

Fix: `loadCampaignMissionSource` skips construction when the player team has
no original city location. `loadCampaignMission` now also carries the root
cause (`{ cause }`) in its wrapper error.

Guard: [release-mission-load.test.ts](../tools/qa/release-mission-load.test.ts)
loads all thirty missions through `loadReleaseMission`. It asserts zero
failures and that exactly those six have no construction configuration.

Browser check (headed Chromium, dev server on the `localhost` origin, script
`/tmp/dc-ui-check/commando-check.mjs`): H06, H11, H14, A05, A09 and A14 all
launch from the mission picker with no page or console errors.

Opening A09 in the browser exposed a second problem: the viewport started on
black, fogged ground. Its owned units begin in three widely separated groups,
and the camera used their centroid. `MissionView.initialize` now centres on the
largest group whenever no owned unit lies within the viewport around the
centroid, so missions with clustered starts are unchanged. Screenshot:
`/tmp/dc-ui-check/commando-175931-ALIEN09.png`.

## Harness: every driver uses the release configuration

[`loadReleaseMission`](../tools/qa/fixtures/release-mission.ts) mirrors
`main.startCampaign`: the runtime profile and the construction policy. When
restoring a checkpoint, the policy is derived from that checkpoint, as `main`
does on resume.

These drivers now use it:

- the campaign-07-09, 10-12 and 13-15 group drivers;
- the mission03, 04, 05 and 06 playthroughs;
- human11-rescue, alien09-escort, alien05-rescue-route and alien-05-06-final;
- human02 and alien02 final-assault, and human02-pending-ready-verify;
- the adapted census.

Historical checkpoints carry no construction options, so their proofs replay
under the same configuration they were recorded with.

## Shared mechanics

- **Contact objects (DC.EXE `4148b0` → `4140dc`)**, implemented in
  [browser-contact-pickups.ts](../src/engine/browser-contact-pickups.ts):
  - The SCN sixth field is stored in entity byte `+0xcb`.
  - Value 1 means a dormant unit. It joins team 0 when a team-0 actor touches
    it.
  - Value 2 means a money store. The first team 0–7 actor within ±2 tiles
    collects its `+0xc` HP as credits.
- **Dormancy.** Native code skips the ordinary update of state-1 objects.
  - Before each simulation advance, `MissionView` passes their ids to
    `DeterministicSimulation.setDormantUnits`.
  - The simulation skips their updates and drops commands addressed to them.
  - The set is derived from checkpointed session bytes, so restores stay
    exact.
- **Alien 10 opening** is resolved: the commander collects two 800-credit
  stores and buys the 2000-credit Mind-Hive.
- **Contact sound.** Both contact branches call the native sound routine
  `0x431bf4` with EAX=3 and EDX=7, at `0x414237` and `0x4142ab`. That index
  resolves through SLIST XTR 3 to sound 5, `SOUND/CAPTURE.WAV`.
  - Adapted frames advance in an audio-less candidate view, so contacts are
    counted there. CAPTURE plays once per committed frame.
  - The A10 contact test asserts one CAPTURE per collected store.
- **Finale artifacts**: ESGAARD (H15) and PORTALIS (A15) load as owned,
  armed units with weapon 47 (2000 damage, range 9). After a public assault
  order, ESGAARD advances and fires on hostile type-12 units, dealing 1312
  damage per shot after the damage matrix (tick 542 in the probe). This is
  covered by
  [finale-artifacts.test.ts](../tools/qa/finale-artifacts.test.ts). The
  30000-HP type-40 object next to it is not auto-targetable. Neither finale
  has been played to a WIN.

## Frame cost (the game ran slower than real time)

Measured with [frame-cost-probe.mts](../tools/qa/frame-cost-probe.mts): per-tick
`MissionView.update` cost over 200 ticks, with no strategy and no rendering. The
tick budget is 50 ms.

| Mission | Before | After |
| --- | --- | --- |
| A10 | 77 ms (p50 76) | 25 ms |
| A13 | 60 ms (p50 59) | 32 ms |
| H12 | 43 ms (p50 43) | 24 ms |

- **Diagnosis.** A CPU profile
  ([cpuprofile-summary.mts](../tools/qa/cpuprofile-summary.mts)) showed that
  84% of the time went to `structuredClone`. Read-only validators and census
  code deep-cloned the whole transport host on every call.
- **Changes:**
  - Added `readTransportHostState`, an uncloned read-only accessor. It is used
    by construction validation, the production census and population cap,
    collector admission, type-37 observation/presentation and research
    observation.
  - `browserResearchWorld` returns the committed world without cloning; steps
    always clone before mutating.
  - Added `DeterministicSimulation.fork()` for the per-tick candidate view. It
    skips the checkpoint validation and the second clone.
  - `stepBrowserType37` no longer deep-clones the world up front; it copies the
    host only when a marker deactivates.
- **Remaining cost** was the transactional per-step `cloneSessionState`.
- **Second pass (2026-09-24).** Four map-sized plain arrays (`ground`, `flying`,
  `groundEligible`, `resourceTileFlags`) made up about 5.8 ms of every host
  clone, and the host was cloned several times per tick. They hold only
  primitives, so the host clone now copies them with `slice()` and deep-clones
  the rest as before. H13 went from 41 ms to 16 ms p50, and A13 from 32 ms to
  20 ms, both measured under the same background load.

## 60 fps pass (2026-09-24)

This pass was measured in a real headed Chromium on a 120 Hz display. The probe
launches a mission from the launcher and times every `requestAnimationFrame`
callback, `MissionView.update` with and without a simulation tick, and every
`getImageData` call. The simulation runs 20 ticks/s, so 60 fps needs each frame
that contains a tick to finish in 16.7 ms.

| H13 (live, dev server) | Before | After |
| --- | --- | --- |
| fps (120 Hz display) | 44 | 117 |
| Frame interval p50 / p95 | 23.4 / 33.6 ms | 8.3 / 10.3 ms |
| Frames with a tick (update + render) p50 | 22.8 ms | 13.2 ms |
| Frames without a tick p50 | 11.8 ms | 4.2 ms |
| Node tick cost p50 (frame-cost-probe, 400 ticks) | 12.0 ms | 7.2 ms |

The production build (`vite build`) measured the same as the dev server.

**Render changes:**

- The mission canvas uses `willReadFrequently`. A GPU-backed canvas measured
  worse, and Chrome falls back to CPU after repeated readbacks anyway.
- WebGL terrain no longer calls `gl.getError()` every frame. That call blocked
  on the GPU. Only the first draw after init or context loss is checked;
  context loss is still polled every frame.
- The terrain is cached per tick and camera position.
  - A camera move re-renders synchronously, so terrain and units stay aligned.
  - A tick-only change (fog, exploration, day/night) is read back through a
    WebGL2 pixel-pack buffer with a fence and shown one frame later. Copying
    the WebGL canvas immediately had stalled every tick frame by about 5 ms.
  - A QA flag compared the two paths over 240 tick changes on H13 and A13:
    0 differing bytes.
- Palette-exact mode-1 shadows and mode-5 effects share one canvas "mirror"
  per frame. The canvas is read once, and later effects re-read only the
  rectangles drawn since.
  - Every `getImageData` costs about 0.5 ms however small, so H13 went from
    8–10 readbacks per frame to 2.
  - Mirror output matched the plain per-effect readback path exactly: 0
    differing pixels at 8 sample ticks each on H12, H13 and A13.
- Radar and production-menu rebuilds run only when their inputs change, at
  most once per tick. They run on the frame after the tick (at most 2 frames
  late), so they no longer add to the tick frame.

**Simulation tick changes:**

All of these are clone removals that leave behaviour unchanged.

- The browser view frame and the HUD/construction snapshots are shared rather
  than cloned. The HUD and construction snapshots are cached per committed
  state and deep-frozen.
- The research preview copies only what `applyUnitBatch` writes, instead of
  cloning the whole session.
- Trigger transactions copy the world only before the first world command.
- The session steps its own staged host in place (`stepOwnedTransportHost`)
  instead of cloning it twice.
- `commitRuntime` moves the candidate's maps instead of cloning them, and
  `fork()` skips boxing the cost array.

**Verification:**

- Determinism: a copy of the tree with these edits reverted produced identical
  state hashes (campaign snapshot, simulation snapshot and checkpoint) at ticks
  500/1000/1500 on H13, A13, H12 and A10.
- Deep-freeze guards on the shared frame, the committed state and the research
  preview found no mutation during 5–7 minute army-bot runs, 7k–10k ticks per
  mission.

**Final production-build check.** Each mission was measured for 10 s after
launch. "Work" is main-thread time per rAF callback.

| Mission | fps (120 Hz) | Work p50 / p95 | Frames with > 16.7 ms work |
| --- | --- | --- | --- |
| H13 | 117 | 6.3 / 14.9 ms | 6 of 1166 |
| H04 | 117 | 6.1 / 14.5 ms | 6 of 1173 |
| H12 | 88 | 9.8 / 19.7 ms | 138 of 875 |
| A13 | 83 | 10.9 / 19.3 ms | 139 of 828 |
| A10 | 67 | 13.4 / 21.8 ms | 183 of 666 |

**Remaining:**

- Heavier scenes (A13, H12, A10) are above 60 fps on average, but most of
  their tick frames still exceed 16.7 ms. On a 60 Hz display they would drop
  about one frame per tick.
- Several shadows overlap freshly drawn sprites, so these scenes need 4–8
  readbacks per frame, at about 0.5 ms each.
- Removing those readbacks means software compositing of sprites in the
  mirror; this pass did not do that.
- Camera scrolling re-renders the terrain synchronously on every moved frame.

## Production exit stall (2026-09-24)

An idle unit standing on a producer's exit cell froze that producer's queue
forever. In H10 the second TRSC stayed queued with 16,000 credits unspent.
DC.EXE writes `+0x35 = 0` into the occupant so that its idle consumer steps
aside; the adapted runtime had no such consumer. `MissionView` now moves an
idle same-team ground unit off any exit whose head is waiting. The exits come
from `CampaignSession.browserWaitingProductionExits`, which does not clone.
[production-exit-clear.test.ts](../tools/qa/production-exit-clear.test.ts)
buys two TRSC in H10 and requires both to appear.

## Armies pinned on the city TOWR (2026-09-24)

Every colony has a TOWR marker (type 81, HP 1, target class 8). Class 8 has a
zero damage coefficient, so the TOWR can never be killed. `canAutoTarget`
already skipped zero-damage targets for legacy profiles, but it returned true
for every native-ordinary profile. Whole armies therefore locked onto the TOWR
and fired for thousands of ticks without effect. In an A07 restore, all eight
attackers at the team-2 city targeted the TOWR, and after 200 ticks the city's
structures still had full HP. This caused the long A06/A07/A12/H09 stalemates.

Native profiles now compute the actual ordinary-hit damage (Inspire factor
256) and are auto-targetable only when it is positive. A diagnostic result
stays eligible, so missing-phase reporting is unchanged. Explicit attack
orders on zero-damage targets are still honoured.
[simulation-auto-target.test.ts](../tools/qa/simulation-auto-target.test.ts)
now includes a TOWR case.

## HUMAN10 reinforcement past the map edge (2026-09-24)

HUMAN10 block 14 (`c>2000`) sends team 3 to `(133,107)` on a 128×112 map. This
is the only out-of-bounds reinforcement across all 30 TROs. The host rejected
it, which raised a fatal mission diagnostic at tick 32,015 of every long H10
game. DC.EXE's carrier constructor `0x418f4c` does not bound-check the tile.
The host now clamps the tile to the nearest edge cell; this is covered in
[transport-host.test.ts](../tools/qa/transport-host.test.ts).

## Same-tick unit and building purchase (2026-09-24)

A unit purchase and a building purchase made in the same tick are both settled
in one session step, but each was checked against the credits on its own. In
H09, a 1,500 collector plus the 2,000 laboratory overdrew the credits, and the
session raised a fatal mission diagnostic ("Browser construction: Insufficient
credits"), which froze the game. `purchaseConstruction` and
`purchaseProduction` now refuse the second request when the pair does not fit.
The H09 sequence is covered in
[production-exit-clear.test.ts](../tools/qa/production-exit-clear.test.ts).

## PSYC checkpoints (2026-09-24)

A saved game with a deployed PSYC, or with its interception ledger, failed to
restore: the validator accepted only SARGE (type 4). Both checks now accept the
shared interceptor set {4, 12}. The new A11 test in
[sarge-deployment-view.test.ts](../tools/qa/sarge-deployment-view.test.ts)
recruits the dormant PSYC contact, deploys it and restores exactly. It fails
with the old validator.

## Alien interceptor (GORREM / PSYC)

The A11 briefing requires deploying a GORREM near an enemy collector to steal
50% of its income. Only the human SARGE (4→77) was implemented.

DC.EXE confirms the alien path is identical:
- The deployment completion at `0x417d0d`–`0x417d33` switches type 4→77 and
  12→78 (and back again on undeploy).
- The scan at `0x417dfa`/`0x417dff` accepts both 77 and 78.

Interception, deployment and the deployed-sprite choice now use the player
faction's interceptor. PSYC is covered in
[sarge-native-policy.test.ts](../tools/qa/sarge-native-policy.test.ts). In an
A11 run, the recruited GORREMs deployed and credits began rising from 0.

## Reproducing the gate

```sh
npm run typecheck && npx vite build
# Full suite, including the all-30 census; detach it from the terminal:
DC_ADAPTED_CENSUS_OUTPUT=/tmp/dc-census-UNIQUE DC_OPENINGS_JUDGE=1 DC_OPENINGS_LATE_TICK=400 npm test
# Long finale delivery check (about 5 minutes):
DC_FINALE_LONG=1 node --import tsx --test --test-name-pattern=PORTALIS tools/qa/finale-artifacts.test.ts
# Headed-Chromium sidebar and commando launches (dev server on localhost:5173):
node tools/qa/original-sidebar-browser.mjs /tmp/dc-original-sidebar-UNIQUE
```

## Evidence

| Check | Result |
| --- | --- |
| Release load, all 30 missions | 30/30, [release-mission-load.test.ts](../tools/qa/release-mission-load.test.ts) |
| Contact pickups (A06 join and restore; A10 stores fund the hive) | 2/2 pass with dormancy |
| Original interface and cinematics tables | 4/4 pass |
| Adapted census before the release-config switch (`/tmp/dc-census-rev-20260923-r1`) | load 30, init 30, step32 30, step200 30 |
| **Final gate, release config** (`/tmp/dc-final-gate-185514`) | `npm test`: 3810 tests, 3700 pass, 62 fail, 48 skip. All-30 census under the release configuration: load, init, step32 and step200 all 30/30 |
| Failing files re-run on HEAD `2a0a4da` and on the current tree | identical pass/fail counts for mission-browser-campaign (0/15), campaign-session-collectors, source-native-combat-options, campaign-session-browser-economy, mission-checkpoint, mission-view-adapted-upgrades and legacy-native-visibility. native-world-cycle passes 12/12 on both when run alone |
| Long A15 PORTALIS delivery (`DC_FINALE_LONG=1`) | pass on the current revision |

## Pre-existing failures (reproduced in a clean `2a0a4da` worktree)

- The three ALIEN02 final-assault tests fail. The saved 09-22 checkpoint's
  source hash (`5d52…`) no longer matches the current mission (`c0f7…`).
- adapted-tro-semantics "thirteen session openings".
- alien-animation-assets "ATRIL type 11".
- browser-campaign-resource-options: "human02: no reachable source VENT".
- alien-playthrough-browser "original win" transcript (6185 vs 6945).
- legacy-native-visibility: one `spawnSync python3 ENOBUFS`.
- main-campaign-ui: all 25 tests fail. The VM harness has no
  `cancelCampaignIntro`.
- "default AL01" state hash (a stale golden).

One regression from this work's `main.ts` changes was found and fixed:
campaign-intro-main now stubs `cancelCinematic` and expects the HMR
disposal to cancel cinematics.

Environment note: macOS prunes old `/tmp` files, and it had deleted the
Python sources of the hard-coded native-test dependencies
(`/tmp/dc-re-capstone-20260918`, `/tmp/dc-trigger-unicorn-20260918`). That
caused dozens of spurious "unicorn/capstone" failures. The packages were
restored from the intact copy in `/tmp/dc-h06-native-20260923`.

## Mission outcomes on this revision

### Full suite on the final revision (2026-09-24)

Log: `/tmp/dc-gate-073158.log`. Totals: 3633 tests, 3515 pass, **70 fail**, 48
skipped. The typecheck is clean. The production build passes (built into a
fresh out dir; building into `dist/` hit a transient `ENOTEMPTY` while emptying
`dist/assets`).

- **62 failures are the same pre-existing set** as the 2026-09-23 gate.
- **8 failures are new.** All of them are missing 2026-09-19 native evidence
  files that the macOS `/tmp` cleaner deleted:
  - `/tmp/dc-ai-demand-native-0919-f2.jsonl`: the four AI policy/demand files
  - `/tmp/dc-lethal-host-fresh-poison-20260919-A19.json`
  - `/tmp/dc-death-complete-20260919-222344.json`: two host-continuity tests
  - `/tmp/dc-death-sound-platform-20260919-a19.json`

  They are environmental, not code regressions. Regenerating those traces
  requires re-running the corresponding research scripts.
- Every test added in this session passes: production exit, same-tick purchase,
  PSYC restore, TOWR auto-target, edge reinforcement and the army-driver units.

Recorded winning proofs remain historical and revision-scoped. H06 and H14
could not have loaded in the shipped build before the fix above.

### Generic army wins (2026-09-24)

[campaign-army.ts](../tools/qa/campaign-army.ts) plays using public commands
only: harvesting, purchases, construction, selection and cursor orders. For
every run below, the supervisor replayed the saved pending-WIN checkpoint in a
fresh process on the final revision. That replay reproduced the ready-WIN
checkpoint exactly. The receipts are in
[evidence-20260924](evidence-20260924/).

| Mission | WIN tick | Proof window | Notes |
| --- | --- | --- | --- |
| A11 | 16,481 | 16,280 → 16,481 | Played from the start in one run |
| H10 | 32,273 | 32,072 → 32,273 | Resumed checkpoint chain; passes the fixed edge reinforcement |
| A12 | 26,537 | 26,336 → 26,537 | Resumed checkpoint chain |
| A06 | 39,649 | 39,448 → 39,649 | Resumed checkpoint chain |
| H07 | 43,241 | 43,040 → 43,241 | Resumed checkpoint chain |
| H13 | 34,897 | 34,696 → 34,897 | Resumed chain. The supervisor's 600 s proof cap was hit under load; the proof was re-run standalone and passed |
| A15 | 9,145 | 8,944 → 9,145 | Played from the start in one run. Trigger 4 fired: every b-slot of teams 1/2/4 at 0 |
| H08 | 24,281 | 24,080 → 24,281 | Played from the start in one run. Trigger 4 fired (teams 2/3 cleared); the team-7 casualty loss never fired |
| H15 | 8,257 | 8,056 → 8,257 | Played from the start in one run. Trigger 2 fired (b-slots of teams 1/2/4 at 0) |
| A07 | 55,761 | 55,560 → 55,761 | Resumed chain. The proof was re-run standalone after the 600 s cap; the supervisor cap is now 1800 s |
| H09 | 57,577 | 57,376 → 57,577 | Resumed chain. Both CITYs were already down; the win also needs `s(4,3)==12`. At 8 team-4 pod losses the bot now targets the remaining hostile objects, and the fourth kill made it exactly 12 |
| H12 | 24,785 | 24,584 → 24,785 | Played from the start in one run. Troops now scout vents beyond the collectors' 32-cell limit, and the collector reserve is released once income stops |
| H04 | 35,801 | 35,600 → 35,801 | Played from the start in one run with `DC_ARMY_WAVE=40 DC_ARMY_HOLD_UNTIL=22000`: the whole army stays home through trigger 10's team-2 drop at (59,9), then attacks with 50+ troops. Scouts stop after two losses at the same vent |
| A13 | 21,225 | 21,024 → 21,225 | Played from the start in one run with `DC_ARMY_WAVE=40`. Collectors now retreat to the base when a mobile hostile comes within 7 cells; before that, the first raids killed both and the economy never recovered |

"Resumed checkpoint chain" means that the game was saved with `--resume`
every 5,000 ticks and continued across bot runs. Some of those segments ran on
earlier revisions of this session. Only the final proof window is certified on
the final revision.

Before the TOWR, exit and purchase fixes, every one of these games stalled or
faulted.

- **A10**: the opening is fixed, but it is still a LOSS.
  - Old strategy: the commander dies and the hive is destroyed; LOSS is
    ready at tick 5881 (`/tmp/dc-a10-play-20260923-r2`).
  - Revised strategy (`r3`): the commander collects every store and then stays
    at the city location. The hive is built, but income is small. LOSS is
    ready at tick 10081, when the base falls.
- **A09**: see the escort follow-up below.

### A09 escort follow-up (release config, fresh runs)

A09 could not load in the shipped configuration before this revision. Three
fresh public-command strategy variants were run with the escort driver. All
ended in the original commander-death LOSS:

| Run | Variant | Trip 4 / trip 2 | Commander death |
| --- | --- | --- | --- |
| `k4` | Solo commander; waits in cells away from visible threats around the extraction anchor | 994 / 1042 | 1504, swarmed by 11 hostiles |
| `k5` | Solo commander; falls back to the troop centroid after trip 2 | 994 / 1042 | 1328, retreat crossed hostile groups |
| `k2`/`k3` | As k4, before passability filtering | 994 / 1042 | stopped early: no route, then budget |

Artifacts are in `/tmp/dc-a09-escort-20260923-k{2..5}`, and the variant code
is saved at `/tmp/dc-a09-escort-v3.ts`. None of these beat the recorded
historical strategy, so the driver keeps it. Removing the commander's regroup
gets the timer started about 1070 ticks earlier. But the lone commander cannot
survive the roughly 1000-tick wait near the extraction point: norm 5 fires
about 974 ticks after trip 2. A09 needs a coordinated escort that stays with
the commander, not a routing change. **A09 is not won.**

### Unwon missions after the final army-bot round (r16/r17)

**Mine drop onto a moving unit (A08).** Trip 13 reinforces ten team-2 mines
(type 45) along x=47, y=0..9. On the host the target cells were free, but a
public trooper was already stepping onto (47,6). The next unit batch then
rebuilt occupancy and failed with the fatal `Occupied or ineligible ground cell
47,6` at tick 1919. Mines are proximity triggers, not walls (transport delivery
already ignores them as occupants). `rebuildOccupancy` now registers mines
after every other actor and skips a mine whose cell is already held. The
regression test is `tools/qa/browser-mine-occupancy.test.ts`; the mine suites
still pass (6/6).

24 of 30 missions are won and proven by replay. None of the six below
stopped on an engine diagnostic. Each ended in a LOSS or a stalemate caused by
the bot's strategy.

| Mission | Last run | Result |
| --- | --- | --- |
| A04 | `r27` | Not won. The trip runner now reaches trip 16 (it used to pick the cell-less trip 13) and the army reaches 40 units, but team 1 (27,000+ HP) is never broken. Once the near vents run dry, the remaining vents are 40+ cells out in contested ground. With `DC_ARMY_COLLECTOR_RANGE=200` the collectors do reach them, but they flee raids or are killed there, and income stalls at about 100 credits |
| A10 | `r23` | LOSS at 11,993. Collector retreat keeps income alive now, but 16 troops still cannot hold the team-1 wave that reaches the base around tick 9,500, even with the army held home (`DC_ARMY_HOLD_UNTIL=14000`) |
| A05 | `r17` | LOSS at 809. The lone commander dies walking to a contact |
| A08 | `r32` | LOSS at 3,873 to 4,449. After the mine fix the runner walks trips 1, 3, 5, 6 and 12, and trips 13/14/20 fire (13 troops join). The commander still dies to the trip-12 team-5 drop at (78,11) and team 3, even when held back or stepping away |
| A09 | `t3` | Commander-death LOSS at 3,256. Trip 4 (112..113,3..7) is the only way into trip 2 (blocking it leaves no route), and the escort dies on the way there |
| H11 | `r18` | Not won. The 2026-09-23 tick-17,895 save (7/7 TORT losses, trip 13 live, commander alive) no longer restores on this runtime (`ai: checkpoint differs from complete source caller replay`). The generic bot loses 4 of its 6 starting units by tick 4,000. The dedicated `human11-rescue.ts` gets 5/7 TORT losses before the commander dies at (103,131). Keeping the commander home left the squad to die with 0 kills, and having it trail the squad lost it at 5,905 |

The commander-only missions (A05, A08, A09) and H11 need a strategy written
for that mission. A04 and A10 still need a stronger economy or defense.
