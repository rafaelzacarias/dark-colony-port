# Source-backed MissionView playthrough, 2026-09-19

## Scope

Runner: [tools/qa/source-playthrough.ts](../tools/qa/source-playthrough.ts).
This is deterministic public-command API automation, not manual input, browser
input, native executable execution, or proof of original-game parity.

The results below are the historical no-render baseline. The optional initialized
ALIEN01 win/loss validation, checkpoint continuation and exact current logs are in
[the 2026-09-21 render report](alien-initialized-playthrough-20260921.md).
Post-stationary-gate four-case execution and the optional per-shot movement
audit are tracked in [the stationary-fire QA report](stationary-fire-playthrough-20260921.md).

The runner uses `loadCampaignMission` and the actual `new MissionView(...)`
constructor. The canvas fixture returns no rendering context. Visual asset
initialization, rendering, sound, and browser events are outside this check.
The full unchanged HUMAN01 and ALIEN01 data are admitted, including raw SCN,
all TRO blocks, messages, map layers, original unit and weapon tables,
MBULLET damage matrix, and the fresh source-production configuration.
Both first missions legitimately have no factory production options; their
`sourceProduction` configuration is present, not omitted.

## Integrity And Input Rules

- Assert fixed SHA-256 identities for SCN, TRO, MAP, MTG, PTH, and MBULLET.
- Compare decoded raw SCN bytes to the original file and its published hash.
- Reparse the original SCN, complete TRO, MAP/MTG/PTH, GAMESTAT, WEAPSTAT,
  and MBULLET and compare their values with the loaded mission.
- Hash the complete loaded mission before and after each attempt to detect
  mutations. No trigger filtering or source-stat changes are used.
- Read snapshots and source map information for planning only. The planner
  can know the full map; targeting still goes through the normal visibility
  and pointer-hit gates in `commandAt`.
- Issue `clearSelection`, `selectUnit`, `setCameraCenter`, `setOrderMode`,
  and `commandAt`. Advance time with `update` in 50 ms increments.
- Never call simulation queue/add-unit APIs, alter health or funds, issue
  enemy orders, replace getters, override visibility, or mutate native state.
- Leave existing guard AI, original enemy units, and source combat intact.

## Strategy

Human victory follows source MTG trips 1, 7, and 2: activate the beacons,
receive the original reinforcements, then engage the three team-4 colony
defenders. The win condition is `s(4,3)>2`, a victim-loss counter, not an
invented capture condition. Alien victory seeks reinforcement trips 4
and 8, then the original team-1 static targets. ALIEN01 requires more than
ten type-82 losses. Visible nearby defenders take priority during either
victory strategy. PTH pathfinding supplies intermediate destinations at
most eight path steps away; it does not move units directly.

Loss strategies select only the original commander and repeatedly order
ordinary movement toward existing hostile units. Other player units remain
under the game's normal idle/guard behavior. No synthetic damage is applied.

Each attempt defaults to 8,000 ticks. Every invocation has a hard combined
40,000-tick budget, including replays. Successful intended outcomes are
replayed once from a fresh actual constructor using the recorded commands
at their original ticks, without adaptive planning. Final state, command,
and combat hashes must match.

## Results

All four intended outcomes were achieved with `ready: true`, no mission
diagnostic, and one exact replay each. The initial isolated batch records
both human outcomes and alien defeat; the corrected alien victory is in
a separate trace. The eight successful executions total 33,912 ticks.

| Intended case | Ready result/reason | Tick | Commands | Shots | Deaths | Repeat |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| HUMAN01 victory | 0 / 1 | 4,769 | 77 | 788 | 25 | Exact match |
| HUMAN01 defeat | 1 / 3 | 2,481 | 10 | 268 | 1 | Exact match |
| ALIEN01 victory | 0 / 1 | 7,241 | 94 | 940 | 49 | Exact match |
| ALIEN01 defeat | 1 / 2 | 2,465 | 10 | 267 | 1 | Exact match |

Shot/death counts are total simulation events, not exclusively player kills.
Replay equality covers command hash, complete combat-event hash, and final
snapshot/statistics/outcome/bindings hash, not just the outcome code.

| Case | Final-state SHA-256 |
| --- | --- |
| HUMAN01 victory | `b6aefd864c961e09496aa3b0e12a0abdec737bed7632098127bbafac63b294a5` |
| HUMAN01 defeat | `8ffeec6e321834fc4bfca78f7fd71265662f6b33aaddfa9e33c8a35b574079af` |
| ALIEN01 victory | `bc31195034b013bdef64d2cc6fbb7c70fd7676606d680ac5b0faf6c2a0118f19` |
| ALIEN01 defeat | `e19d3efefdd5c03767671bd7ed6fca3c4d2d0ae988ab255951eca4be77768e47` |

Original objective counters also agree: HUMAN01 victory has `s(4,3)=3`
and no commander loss; ALIEN01 victory has `s(1,0,82)=11` and no commander
loss. Defeats have `s(0,0,69)=1` and `s(0,0,73)=1`, respectively.
Both missions retain all nine original TRO blocks. Every explicit
`visible-enemy` command in the saved traces had visibility at its destination.

No source-integration bug was encountered in these completed routes. This
does not establish equivalence of unrelated runtime behavior to the native
executable, or validate graphics, audio, input devices, or other missions.

## Preserved Traces

These are local `/tmp` artifacts, not committed repository fixtures:

- `/tmp/dc-source-four-cases-isolated-0600.jsonl`: 860,242 bytes;
  SHA-256 `71f146ec83c4aea1ad7cb1ff9d813a953c7c4ab211d03f7c445366e5176bcfae`.
  Includes HUMAN01 win/loss, ALIEN01 loss and their exact replays, plus the
  unsuccessful initial alien itinerary. Invocation total: 27,430 ticks.
- `/tmp/dc-source-alien-win-v2-1246.jsonl`: 506,321 bytes;
  SHA-256 `4acde640e51ddade05dd0a5b8812f3b8a53a39ea630532cbc4fa37485bc656d0`.
  Corrected ALIEN01 victory and exact replay; 14,482 ticks; process exit 0.
- `/tmp/dc-source-final-evidence-1250.json`: trace checksums and final source
  objective counters extracted from both files.

The final runner differs from the first batch only in reporting and in the
alien victory itinerary described below. The corrected alien run includes
its harness source hash and a `suite-complete` record. Earlier traces remain
untouched; results from the incomplete attempt are not relabeled as passes.

## Reproduction

From the repository directory:

```sh
node --import tsx tools/qa/source-playthrough.ts --limit=8000 > /tmp/dc-source-playthrough-$(date +%Y%m%d-%H%M%S).jsonl 2>&1
```

Options: `--inspect` performs admission/integrity checks only;
`--case=human-win`, `--case=human-loss`, `--case=alien-win`, or
`--case=alien-loss` selects one case; `--no-repeat` disables the automatic
repeat. `--limit=N` must be an integer from 1 through 40,000.
`--render` enables real-asset initialization with the Node 2D platform fixture;
`--render-every=N` samples later renders every N ticks (default 25, range 1-250).
`--restore-at=N` JSON-roundtrips an in-memory checkpoint and continues in a fresh
view at that tick; no user save storage is accessed.
`--audit-fire-movement` checks every tick and shot for exact stationary XY,
cleared paths and movement reservations, and verifies the audit hash on replay.
The final runner exits nonzero when an attempted intended outcome fails.
The 40,000-tick budget is per invocation, not a cumulative research-session
budget; unsuccessful exploratory attempts are documented separately.

JSONL records include admission hashes, source-known trip coordinates,
selected IDs, world and client command coordinates, cursor/visibility,
simulation ticks, every shot and death, periodic unit states, outcome
transitions, final state hashes, and replay verification.

## Execution Notes

A 4,000-tick HUMAN01 reconnaissance attempt reached the colony approach
without an outcome or runtime diagnostic. It was a bounded incomplete
attempt, not a victory. Trace: `/tmp/dc-source-human-win-v1-0545.jsonl`.

A shared-terminal four-case launch was interrupted around tick 150 and is
not counted as a completed test. Trace:
`/tmp/dc-source-four-cases-v1-0551.jsonl`.

The first alien victory itinerary mistakenly requested trip 7 before any
other goal. That TRO block exists, but its MTG map has no usable destination
cells. The attempt issued zero commands, shots, or deaths and ended at its
8,000-tick cap without an outcome or runtime diagnostic. This was a planner
error, not a runtime pathfinding failure. The sole strategy correction was
changing the alien destination list from `[7, 4, 8]` to `[4, 8]`; the entire
TRO, including block 7, remains unchanged. No runtime fix was made.

The counted run was started synchronously through Node `spawnSync` with
`detached: true`, an explicit repository working directory, ignored stdin,
and an exclusively created trace file. Its simulation process has its own
session, so unrelated terminal Ctrl-C operations do not terminate it.
Terminal output was demonstrably interleaved with another task; only the
runner's exclusive on-disk evidence is used here.

Focused strict TypeScript checking of the runner and its imports passed
with exit status 0. No browser, subagents, native harness, or full test suite
was used. No runtime files were edited.