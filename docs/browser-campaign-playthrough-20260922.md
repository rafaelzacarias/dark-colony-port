# Source-Aware Adapted Mission 02 Playthrough

This QA driver uses the actual `loadCampaignMission(faction, 2,
"browser-adapted")` loader and an initialized `MissionView`. It is not native
timing parity, manual play, browser presentation acceptance, or a full-game pass.

Current rerun evidence and limits are recorded in
[the bounded M02 rerun report](m02-rerun-20260922.md). Historical failures below
describe earlier runtime hashes, not the current casualty-publication fix.

## Original Objectives

Both full original TRO scripts are retained, with no trip triggers:

| Mission | Exact win condition | Meaning in current runtime | Original losses |
| --- | --- | --- | --- |
| HUMAN02 | trigger 6: `(s(2,3)>26)` | At least 27 team-2 victim losses | All five player building slots zero (reason 2), or any player type-86 loss (reason 3) |
| ALIEN02 | trigger 4: `(s(1,0,86)>5)` | Six team-1 type-86 communication sites destroyed | All five player building slots zero (reason 2) |

Human's original briefing requires guarding communication satellites, destroying
the aliens in the area, and protecting the base until the replacement commander
arrives. Alien's briefing requires destroying communication sites. Destroying an
arbitrary enemy base is not a substitute for either script goal.

`s(0,10)` is a separate team-statistic lookup, not an alias of `b(0,slot)`.
The adapted session seeds it to zero. Human trigger 17 requires both `c>880`
and `s(0,10)==0`, naturally enabling team 2 at cycle 14096. Alien trigger 0
naturally enables team 1 at cycle 1136 and abducts the **team-1** commander,
not the player's team-0 commander. Commander wounds have scripted recovery;
a commander casualty alone must not be relabeled an original mission loss.

## Driver

The browser-ready fixture is
[tools/qa/fixtures/browser-campaign-playthrough.ts](../tools/qa/fixtures/browser-campaign-playthrough.ts).
Create `createBrowserCampaignPlaythrough(initializedView, options)` while the
host update loop is suspended, then await `runner.step()` until
`runner.progress.status` is no longer `RUNNING`. `onEvent` receives plain JSON
action, actor, combat, selector, AI-order, statistics, outcome, and progress rows.
No Node imports or persistent save writes occur in the fixture.

Only player selection, camera positioning, public move/assault/attack clicks,
harvest, and paid infantry production are used. Source-known original objective
positions are allowed; this is explicitly not a human-only-knowledge claim.
Attacks and harvest orders obey unchanged fog checks. Neutral team 8 is excluded
from enemy planning. No damage, health, money, lives, enemy orders, fog, scenario,
or trigger writes are used.

The player starts with original zero money and waits for actual harvester
delivery. Harvest uses a visible active finite original vent and avoids visible
nearby enemies. Purchases use dependencies 9/23, the menu's actual cost, and one
pending/queued unit at a time. The source infantry exit at base plus `(0,-3)`
must be clear before purchase. Both factions assemble troops before assaulting
original objective positions, with army targets adapting to remaining goals,
visible armed statics and casualties (maximum 40). Routes use full static
footprints, and troops already firing at the chosen target retain their orders. Loss intent
exposes the commander without harvesting or buying support; this is a tactic,
not a promised or forced mission loss.

## Node Execution

```sh
DC_M02_REQUIRE_OUTCOME=WIN node tools/qa/browser-campaign-playthrough-run.mjs both 30000 win unique-label
DC_M02_REQUIRE_OUTCOME=LOSS node tools/qa/browser-campaign-playthrough-run.mjs human 30000 loss another-label
node --import tsx --test tools/qa/browser-campaign-playthrough.test.ts
```

The integration tests are opt-in through `DC_M02_FACTION=human|alien|both`.
`DC_M02_TICKS` defaults to 30000 and accepts up to 50000. Each simulation run
has a 900000ms wall-clock deadline, optionally lowered with `DC_M02_DEADLINE_MS`.
Deadline exhaustion is FAIL with an explicit QA diagnostic, not an original
mission LOSS. Progress includes wall-clock time every 1000 ticks. The launcher
also has a process timeout and runs tests without an extra child test process.
`DC_M02_REQUIRE_OUTCOME=WIN` or `LOSS` makes a requested result an assertion;
without it, a completed diagnostic-free experiment is not a victory assertion.
`FAIL` always fails the integration test; `UNKNOWN` means the tick limit was
reached without a ready outcome. `WIN` and `LOSS` require the actual ready
original outcome. No expected-success constant is returned.

The launcher writes a uniquely labeled `/tmp/dc-m02-*.log` and exit JSON.
Each mission additionally writes a unique `/tmp/dc-m02-<faction>-<intent>-*/journal.jsonl`.
SCN bytes/hash, complete parsed TRO, and briefing hash/content are checked
against raw CD files. The complete loaded mission is checked unchanged at exit.

Actual assets initialize with the existing Node source-render canvas stub;
`DC_M02_RENDER_EVERY=0` selects NullCanvas search after initialization. Otherwise
render dispatch runs at the selected cadence (default 1000), and at observed
combat, resource-delivery and carrier events. PNG headers
and dimensions are validated. This does not verify pixels, audio, physical input,
real-time frame pacing, result UI, or campaign progression. No browser, agents,
full suite, engine edits, or user saves are used. Each result writes a QA-only
`checkpoint.json` beside its journal. `DC_M02_VERIFY_RESTORE=1` checks the actual
view checkpoint round-trip. `DC_M02_RESUME=/tmp/.../checkpoint.json` resumes the
saved view and planner up to an absolute tick limit. `DC_M02_REPLAY=/tmp/.../journal.jsonl`
replays public selection/camera/click/harvest/purchase actions from a fresh view,
asserting the recorded tick, result, combat totals, objective and economy. No
simulation command injection or native receipts are used. Original mission hash
must match. Short replay/restore is verified; winning replay still requires an
actual winning trace. The generic stepping/checkpoint API is reusable, but source
goal admission is deliberately restricted to the two authenticated M02 scripts.

Currency audit distinguishes delivered income from income published to the
session: `published - paid purchases == credits`; delivered minus published is
the pending frame-boundary income, not a free grant. This is important for ALIEN's
25-credit delivery batches. Original scripts, goal thresholds and loss assertions
are never changed to make the strategy pass.

## Verification

- Five focused objective/loss/classification/casualty tests pass. Focused TypeScript
  validation is clean after correcting a QA-only briefing type access.
- Corrected 600-tick smoke runs passed for both factions: Human earned 506,
  Alien earned 575, and each accepted a paid purchase. Both correctly reported
  `UNKNOWN`, not success.
- First Human win-intent attempt stopped at tick 1237 with runtime diagnostic
  `Occupied or ineligible ground cell 56,52`. It had earned 1210 and accepted
  three purchases. Journal: `/tmp/dc-m02-human-win-00Iryn/journal.jsonl`.
- A legal tactic revision waits for producer-exit clearance and rallies farther
  away. It reached tick 1500 with 1496 earned, four purchases, and no diagnostic:
  `/tmp/dc-m02-human-win-kP2j6V/journal.jsonl`.
- The final Human win-intent run **FAILS at tick 711** on a lost source casualty
  counter, after 616 earned credits and one 350-credit purchase:
  `/tmp/dc-m02-human-win-4uwpBa/journal.jsonl`.
- The final Human loss-intent run independently **FAILS at tick 711** on the
  same feedback defect, without harvesting or spending:
  `/tmp/dc-m02-human-loss-fWkfM8/journal.jsonl`.
- The final Alien win-intent run **FAILS at tick 2002** with a consumed team-1
  type-0 death but zero `1,3` and `1,0,0`. It earned 2325, accepted six
  350-credit purchases, and retained 225 credits:
  `/tmp/dc-m02-alien-win-cuvSmo/journal.jsonl`. Original trigger 0 naturally
  changed team 1 from mode 4 to 3; the journal observes that event at tick 1140.
  AI orders, movement, and combat are present, not merely decision counters.
- All three final traces report the complete loaded mission unchanged. The
  final focused compile is clean; five unit tests pass. Both win-intent
  integration tests and the Human loss-intent integration test intentionally
  remain red because the actual runtime feedback is broken. Compact final
  evidence: `/tmp/dc-m02-final-p28.json`; test output: `/tmp/dc-m02-p24.log`
  and `/tmp/dc-m02-p25.log`. All owned execution processes have been stopped
  or completed; no hidden background playthrough is left running.
- Earlier diagnostic runs were explicitly stopped after discovering the
  shared casualty-counter defect, not silently counted as completed attempts.
  Alien reached at least tick 4400; its tick-4250 progress had 5125 earned,
  seven purchases, five deaths, and zero communication-site losses. Human's
  earlier exposed commander died naturally at tick 734, with no casualty
  statistic/recovery update through tick 3500. Those aborted runs are
  `UNKNOWN`, not original LOSS outcomes. See `/tmp/dc-m02-handoff-p26.json`.
- No WIN, ready original LOSS, Human tick-14096 live activation, checkpoint
  replay of a winning trace, result screen, or campaign progression is claimed.
  Those requirements remain blocked or unverified, not passed.

## Runtime Handoff

### Casualty Counter Overwrite: Root Fix

Both fresh Human tactics naturally kill a team-3 type-8 actor at tick 710.
At tick 711, `controller.consumedLosses` contains its exact source identity
`["human02:browser","transport:172:0",0]`, but `3,3` and `3,0,8` are both
still zero. The runner checks the public statistics one frame after a natural
death and reports `FAIL` when the consumed casualty is missing. It does not
write expected counters into the game.

The controlling code is in
[campaign-session.ts](../src/engine/campaign-session.ts#L664): `applyUnitBatch`
increments controller runtime statistics for a combat death but does not also
update `world.statistics` in its returned world. Later in the same step,
[campaign-session.ts](../src/engine/campaign-session.ts#L1749) consumes browser
economy income using that stale world and replaces the controller's statistics
with `consumed.world.statistics`. The view supplies economy income every
adapted frame, including frames with zero income. This discards new casualty
counts while preserving the consumed-loss receipt, preventing later retries.

This directly blocks the casualty-based original M02 goals and commander
recovery; changing strategy or adding more troops cannot repair it. Main owner
has now changed `applyUnitBatch` to return the newly computed statistics in both
the candidate world and controller. This synchronizes the owning boundary before
income or production receives the world; it does not merge stale totals or
change the economy helper. Even zero-delta income batches now retain deaths.
Consumed victim IDs and counters commit or roll back together.

The minimal regression reproduced `1,3 == 0` despite an already consumed ALIEN02
type-86 death, then passed with the one-line root fix. Six new casualty tests cover
dynamic/static deaths, income deltas and retries, production, TRO namespaces,
rollback and exact JSON replay. All 65 scoped tests and focused strict compilation
pass; see [session economy verification](campaign-session-browser-economy-20260922.md).
HUMAN02's `s(0,0,69)` activates commander recovery, not mission loss; its original
type-86 loss condition remains unchanged.

The unchanged legal runner was restarted with `DC_M02_REQUIRE_OUTCOME=WIN`, both
factions and the full 36000-tick limit. Log: `/tmp/dc-m02-p1-fixed-1790108122.log`;
Human journal: `/tmp/dc-m02-human-win-OomtVk/journal.jsonl`. Interim evidence at
tick 3440 has `3,3 == 2`, `3,0,8 == 2`, `1,3 == 1`, `1,0,86 == 1`, income 3630
and no casualty diagnostic, past the previous tick-711 failure. This is not a
completed outcome or WIN claim. Human's natural tick-14096 activation and exact
post-victory checkpoint/replay are not yet verified by this run.

### Production Exit Collision

The first Human diagnostic is a real public-gameplay failure, not an original
mission loss. The main owner's nearest investigation point is
[campaign-session.ts](../src/engine/campaign-session.ts#L557):
`rebuildOccupancy` first installs production reservation marker 1022 and then
rejects a generic moving actor occupying that cell. Source production normally
waits when an exit is occupied before reservation
([campaign-production.ts](../src/engine/campaign-production.ts#L577)). Generic
movement entering an already reserved exit is the local integration hypothesis.
The trace records legal troop rallies near `(56,52)` during a paid production
cycle. The QA strategy's clearance check is a legal avoidance tactic, not an
engine fix or proof that other player orders cannot reproduce the failure.

### Performance

The first long-run process remained CPU-active after 28 wall-clock minutes,
with roughly 32 CPU minutes. A read-only macOS sample showed substantial
structured-clone serialization/deserialization and a 1.2 GB physical footprint
(1.6 GB peak): `/tmp/dc-m02-alien-stack-p21.txt`. The adapted view stages a
simulation checkpoint/restore and session fork each frame. The sample does not
resolve JavaScript callers, so this is a profiling lead, not a measured exclusive
attribution. Runs were stopped for the confirmed logic blocker; 36000-tick
performance was not established.