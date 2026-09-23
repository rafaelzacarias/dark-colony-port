# Independent Mission 02 Judge

This is the historical bounded-startup judgment. The subsequent
[actual-outcome rerun](m02-endjudge-20260922.md) supersedes it for M02 completion
acceptance; a startup PASS is not a mission-win PASS.

Date: 2026-09-22. Scope: explicitly accepted `browser-adapted` milestone,
not native AI/timing parity and not full-game acceptance.

## Verdict

No confirmed runtime defect in the tested slice. PASS for bounded mission-02
startup, player economy/production, active AI behavior, and in-memory save/replay
for both factions. Complete mission flow and browser campaign progression are
NOT VERIFIED; full-game acceptance is NOT GRANTED.

| Gate | HUMAN02 | ALIEN02 |
| --- | --- | --- |
| Actual loader and asset initialization | PASS | PASS |
| Natural delivery, visible harvest, paid production | PASS | PASS |
| AI behavior | PASS: team 3 movement/attacks; teams 3/4 decisions | PASS: natural team 1 activation and movement |
| Bounded source mission flow | PASS through tick 500 | PASS through tick 1182 |
| Save/replay | PASS | PASS, including post-activation |
| Mission win, result screen, next mission | NOT VERIFIED | NOT VERIFIED |

## Method

- Called `loadCampaignMission(faction, 2, "browser-adapted")` directly, without
  hand-built mission fixtures, trigger filtering, forced counters, starting
  credits, or visibility overrides. Original SCN bytes/hash and parsed full TRO
  matched the loaded data: 20 Human blocks and 12 Alien blocks.
- Initialized real MissionViews using the existing source-render Node fixture.
  All requested FIN timelines/states and hashes matched raw source archives;
  PNG headers/dimensions were checked by the fixture. Human: 14 animation
  archives, 210 fetched URLs, 370 initialization draw calls. Alien: 16 archives,
  176 URLs, 384 draws, including the T-to-TURR sprite alias. No missing assets.
- Drawing was stubbed, then disabled after initialization for bounded stepping.
  This verifies initialization and draw dispatch, NOT raster pixels, WebGL,
  browser input, presentation quality, audio, or wall-clock performance. The
  expected Node renderer was RGBA fallback because WebGL2 was unavailable.
- Advanced public `update` at 50 ms per tick (20 Hz). Selected only the naturally
  delivered team-0 harvester with `replaceSelection`; called public
  `harvestSelected(slot)`, `stopSelected`, and `purchaseProduction(dependency)`.
  Never modified simulation/source state or user saves. No browser, agents,
  runtime edits, git commands, or full-suite runs.

## Economy and Replay

| Observation | HUMAN02 | ALIEN02 |
| --- | --- | --- |
| Initial team-0 money / harvesters | 0 / 0 | 0 / 0 |
| Harvester delivery tick / type | 83 / 6 | 107 / 14 |
| Actual delivered cell | (63,48) | (6,75) |
| Naturally visible active VENT | placement:17, slot 168, (69,48) | placement:38, slot 190, (4,80) |
| Observed extraction rate | 22 | 25 |
| Mid-period save tick / progress | 122 / 7 ticks | 166 / 7 ticks |
| Earned / spent / remaining credits | 352 / 350 / 2 | 350 / 350 / 0 |
| Production dependency / unit type | 9 / 0 (TRSC) | 23 / 8 (GRAY) |
| Purchased actor spawn tick | 461 | 480 |

Alien's observed visible vent was (4,80), not the hypothesized (11,76).
Both harvest orders passed the unchanged natural visibility guard. Reserve
depletion equaled earnings; generic simulation cargo credits stayed zero.
Credits were deposited directly to the team under the advertised adapted
policy, not through a claimed native return-to-base cycle. Exactly one purchased
actor spawned; immediate duplicate purchase was rejected; no duplicate debit or
credit appeared during 25 additional ticks or after restoring spent earnings.

JSON checkpoints restored exactly at startup, before harvesting, and seven ticks
into extraction. Fresh actual-loader configurations restored mid-period saves;
21 subsequent ticks matched entire checkpoints. Post-spend continuation also
matched. Alien additionally matched 21 continuation ticks after AI activation.
No persistent browser save storage was exercised.

## AI and Mission Flow

Human teams 3 and 4 each made 25 decisions through tick 500. Team-3 source actors
arrived at ticks 67 and 75, moved from their delivered positions, and were both
attacking target 4 (team 1) at tick 500. The independent behavior run observed
60 combat events. Team 4 had no observed mobile actors in this window; its
decision count is not evidence of an army acting. Team 2 remained mode 4;
its later natural activation at tick 14096 was deliberately not run.

Alien team 1 had zero decisions and mode 4 at tick 1135. Original trigger 0
executed abduct/reinforce/AI commands at tick 1136, recording mode 4 -> 3.
Actor 45 received a move toward (7,70) at tick 1140, changed position, and was
still moving at tick 1182; team 1 had made three decisions. No combat was
observed in this short Alien window. Neither faction had a mission outcome.

## Evidence and Judge Corrections

- `/tmp/dc-independent-m02-judge-1790103799332.log`: startup, delivery and replay
  passed; judge incorrectly looked up dependency 0/8 instead of unit type 0/8.
- `/tmp/dc-independent-m02-judge-corrected-1790103947688.log`: both economies,
  production and replay passed; Alien reached tick 1182. Its Human AI assertion
  was invalid: strategy keys include generation/simulation ID, and first
  reinforcements did not exist in the tick-0 movement baseline.
- `/tmp/dc-independent-m02-ai-binding-1790104271948.log`: fresh actual-loader
  runs tracked complete binding identities from first appearance each tick.
  Human and Alien behavior assertions passed; final failure count was zero.

The first two logs' failure counts are judge errors, not runtime failures; they
are retained explicitly rather than presented as entirely green test runs.

## Remaining Acceptance Work

Priority for the main browser owner: verify real user progression 01 -> 02 for
both factions, actual canvas/input and source art, visible selection/harvest UI,
production buttons using dependency 9/23, and persistent save/load. This judge
does not establish that hostile Human AI reaches the player within 500 ticks.
Natural later Human activation and complete mission win/loss flows remain open.
All-30-mission completion is outside this milestone and has no PASS claim here.