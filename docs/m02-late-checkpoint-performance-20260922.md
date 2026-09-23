# M02 Late Checkpoint Performance

## Scope And Finding

Bounded HUMAN02 continuation from the existing legitimate checkpoint
`/tmp/dc-m02-human-win-jhb017/checkpoint.json`, tick 14316. The original source
loader verifies the mission hash. Normal `MissionView.restore` replays and
validates all saved session inputs; the restored checkpoint is compared exactly
with the saved checkpoint. No cold campaign run, injected histories, skipped
frames, relaxed validation, native behavior changes, or QA fixture edits.

The dominant growing cost is the detached full campaign snapshot requested by
the public-playthrough observer and summary. At tick 14436, one
`CampaignSession.snapshot` structured clone serialized 47,554,462 bytes and took
400.783 ms before the change (398.431 ms after). The observer requests this
snapshot every 20 ticks and on additional events; summary also requests it.
Because it includes every historical selector input, repeated full snapshots
produce a quadratic aggregate copying cost as the run grows. The compact browser
frame does not clone that history. The retained production journal had only 120
events at the checkpoint, rather than one event per historical tick.

This work preserves detached snapshots and complete replay inputs. Changing QA
observation to use dedicated bounded projections is a separate fixture-owner
decision, not part of this patch.

## Small Engine Change

In `CampaignSession.#step`, the browser-adapted path now passes the already-owned
staged host to `validateNativeAiTaskAlignment`. Previously the validator's default
argument deep-cloned that host, then checked for unowned native tasks and returned.
All validation still executes. Strict-native still uses the original default
argument. No public object or snapshot becomes shared.

Across the three instrumented late frames, this removes three clones totaling
595,902 serialized bytes and 6.194 ms: 198,634 bytes and approximately 2.065 ms per
tick. No history, frame publication, rollback, or save/replay guard is removed.
The ownership assumption is that the validator remains read-only; its adapted
no-native-owner branch scans slots and rejects unowned tasks without mutation.

## Before And After

Same 120 continuation ticks, ending at 14436, with the existing public-command
strategy and null-canvas source renderer. The first 117 ticks use the CPU sampler;
the last three instrument structured clones. Wall timings below cover the first
117 ticks including QA observation and summary. Update distributions contain 118
calls, including the strategy's initial clock-reset update. Restore and final
checkpoint serialization are outside continuation timing.

| Measurement | Before | After |
| --- | ---: | ---: |
| Update mean | 30.954 ms | 29.159 ms |
| Update p50 | 30.355 ms | 28.370 ms |
| Update p95 | 45.314 ms | 47.427 ms |
| 117-tick wall time | 9186.887 ms | 8974.332 ms |
| Full verified checkpoint restore | 298627.150 ms | 272062.338 ms |

Median update improvement is 6.5%; observed wall improvement is 2.3%. These are
single sequential windows on a shared machine while another agent performs QA.
The fixture was edited concurrently by its owner; complete final output equality
still passed. No controlled p95, restore-speed, full-campaign throughput, browser
rendering, or mission-completion claim is made.

## Verification

- Exact before/after equality of the entire final view checkpoint, retained
  campaign journal, and strategy checkpoint after 120 ticks.
- Five focused tests pass: adapted-frame clone regression, detached projection,
  parent/sibling isolation, failed-frame rollback, JSON replay, full-step versus
  compact-step equality, throwing/shared inputs, and retained history controls.
- Scoped strict TypeScript check and editor diagnostics pass.
- Native behavior is untouched; the full native suite was not run.

Artifacts (temporary, absolute paths):

- Harness: `/tmp/dc-m02-local-perf-20260922.ts`.
- Before stem: `/tmp/dc-m02-local-before-1790133348378`.
- After stem: `/tmp/dc-m02-local-after-1790133790268`.
- Each stem has `.json`, `.log`, `.cpuprofile`, and `.exact.json` evidence.
- Controls: `/tmp/dc-m02-alignment-controls-1790133767634.log`.
- Types: `/tmp/dc-m02-alignment-types-1790134086108.log`.

Focused controls:

```sh
node --import tsx --test --test-name-pattern='^adapted frame controls:|^session sharing:' tools/qa/adapted-frame-performance.test.ts tools/qa/campaign-session-sharing.test.ts
```

## QA Observer Follow-up

The actual fixture is
[tools/qa/fixtures/browser-campaign-playthrough.ts](../tools/qa/fixtures/browser-campaign-playthrough.ts),
not `tools/qa/browser-campaign-playthrough-fixture.ts`. This subsequent change is
QA-only; no runtime files, public getters, strategy conditions, command order,
20-tick decision cadence, or 50 ms updates were changed.

Each observer invocation now lazily obtains at most one detached full campaign
snapshot. Death accounting, income publication, entity attribution, selector
events, building slots, and progress/lives reporting share that snapshot only
within the invocation. It is not retained across updates or public progress
queries. Resume admission no longer clones an unused initial world, and planning
reuses one existing compact `missionStatistics` projection for its two counters.
Standalone summaries still read the authoritative published-income ledger.

### Bounded Measurement

Both original actual-loader M02 missions ran from initialization through tick
1000, in 20-tick batches with null-canvas rendering. These are bounded observation
windows, not full playthroughs or another late-checkpoint benchmark. Bytes use
Node V8 serialization of each full getter result; milliseconds measure the real
`campaignSnapshot` getter, excluding measurement serialization and independent
oracle reads. Timings are single sequential runs on a shared machine.

| Faction | Full reads before / after | Cloned bytes before / after | Getter ms before / after |
| --- | ---: | ---: | ---: |
| HUMAN02 | 197 / 152 | 393,704,271 / 293,226,699 | 2,561.548 / 1,916.951 |
| ALIEN02 | 196 / 151 | 498,524,187 / 369,942,479 | 3,584.430 / 2,634.270 |

This removes 45 full reads in each window and 25.5% / 25.8% of cloned bytes.
The windows include 43 income events and one progress event per faction;
HUMAN02 also has 117 shots, one death, and one paid purchase. ALIEN02 ends with
1075 delivered versus 1050 published credits: that real posting lag is preserved,
not replaced by delivered income. Both outcomes remain null, status UNKNOWN,
and source objective statistics remain zero. Natural selector changes occur
later and were not exercised by these windows.

### Regression Proof

[tools/qa/browser-campaign-playthrough-observation.test.ts](../tools/qa/browser-campaign-playthrough-observation.test.ts)
compares statistics, published income, progress lives, and selector events with
the legitimate public full snapshot. It enforces per-tick full-read budgets and
checks that resuming the actual strategy checkpoint performs no initial full
read. Default windows are 240 ticks; the opt-in cap is 1000.

The measured runs additionally compare complete emitted events, all batch
summaries, strategy checkpoint, view checkpoint, and retained campaign journal
against outputs captured before the fixture edit. Only progress `elapsedMs` is
excluded because it is wall time. All 18 focused observation and deterministic
strategy/source-contract tests pass; scoped strict TypeScript and editor checks
pass. No full playthroughs, agents, or runtime changes were used.

```sh
node --import tsx --test tools/qa/browser-campaign-playthrough-observation.test.ts tools/qa/browser-campaign-playthrough.test.ts
```

Temporary evidence:

- Before outputs: `/tmp/dc-observation-before-20260922-q02-{human,alien}.json`.
- Before measurements: `/tmp/dc-observation-before-20260922-q02.log`.
- Final equality/budget controls: `/tmp/dc-observation-controls-20260922-q04.log`.
- Strict types: `/tmp/dc-observation-types-20260922-q05.log`.
- Coverage/accounting: `/tmp/dc-observation-coverage-20260922-q06.log`.
- To compare with the captured references, set `DC_M02_OBSERVATION_TICKS=1000`
  and `DC_M02_OBSERVATION_BASELINE=/tmp/dc-observation-before-20260922-q02`.

### Remaining API Gap

This does not eliminate the one growing full-history clone still needed per
observation, plan, or standalone summary. Existing public `browserAiState`
contains strategy decisions, not committed entity identities, selector events,
building slots, trigger lives, or the session's published-income ledger.

A possible integration follow-up is a tiny read-only `campaignObservation`
projection cloned directly from validated committed session state: entity
`key/team/unitType/simulationId/tileX/tileY`, selector events, building slots,
trigger lives, and published earned totals. Existing `missionStatistics` should
remain the source of objective counters. Rare casualty-failure diagnostics can
retain their full snapshot for `consumedLosses`. No such API was added here;
it would need exact field-selection and detachment tests against the legitimate
full snapshot, with no reconstruction from AI observations or delivered income.