# Native Reference Round 4

Executed 2026-09-19. Final focused TAP run: 09:52:49Z through 09:52:51Z.
**80 tests passed, 0 failed, 0 skipped, 0 cancelled, 0 todo; eight files.**
All three reference environment variables were set to freshly generated reports.
No source edits, shared-audit edits, full suite, browser, or agents. This document
is the only repository file written by this run; scratch drivers/logs are in /tmp.
Git status was unavailable because this directory has no Git metadata.

## Results

| Check | Observed result |
| --- | --- |
| Upgraded ordinary hit probe | Exit 0; 3,456 native health deltas, eight weapon records, 24 target types; all compared by TypeScript |
| Static all-corpus probe | Exit 0; 108 SCNs, 4,377 input rows, 2,013 static rows, 601 nonentity rows; 535 hashed inputs, 101 TROs, 423 actions |
| Static additional cases | 138 constructors, 23 reinforcement groups, four SCN exception cases, 27 removal-status/offset cases, one first-match case; auxiliary evidence included |
| Static coverage | 23 required noncolony types; unsupported types and operands both empty; ground 519, air 42, auxiliary 236, no occupancy 1,216 |
| Inspire lifecycle | Exit 0; six accepted native cases, zero runtime interceptions in every case |
| Separate construction normalpass | Exit 0; four accepted cases, zero lifecycle interceptions; race/counter (0,3), (0,4), (1,3), (1,4) release at updates 1, 186, 1, 246 |
| Focused pure/live comparisons | Exit 0; 80/80 passed, zero skipped |
| Evidence verification | Exit 0; checked report completeness, TAP totals, executable pins, combat tables, and rehashed all 535 static source entries |

Combat and static report-backed tests ran instead of their default skips. Inspire
does not normally report a skip: without its environment variable it uses embedded
goldens. This run supplied the six-case report, asserted all six native cases were
accepted with no interceptions, and compared live activation traces for cases 0..4.
Case 5 independently proves native recovery/reuse, not simulated recovery.

The first seven-file run passed 70 tests. A separate static pure/live run passed
13 tests, including three already run. The final eight-file run is the authoritative
**80 distinct tests**; repeated executions must not be counted as new coverage.

## Reports And Environment

Unique artifact directory: `/tmp/dc-native-reference-round4-20260919-7c39e6b1`.
The wrapper saves each command's stdout as `<label>.json`, stderr as
`<label>.stderr`, exit status as `<label>.exit`, and exact command/CWD/UTC times as
`<label>.meta`. Test stdout is TAP/text despite the `.json` suffix.

Export these in the orchestrator's shell before its own test command:

```sh
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918
export DC_NATIVE_HIT_REPORT=/tmp/dc-native-reference-round4-20260919-7c39e6b1/upgraded.json
export DC_STATIC_NATIVE_TRACE=/tmp/dc-native-reference-round4-20260919-7c39e6b1/static.json
export DC_INSPIRE_NATIVE_TRACE=/tmp/dc-native-reference-round4-20260919-7c39e6b1/inspire.json
```

The dependencies already existed; nothing was installed. The static probe's
resource harness import succeeded without missing-package/resource errors.
These exports were set inside the run wrapper, not persisted into another shell.

Exact successful invocations (wrapper sets absolute CWD and the exports above):

```sh
RUN=/tmp/dc-native-reference-round4-20260919-7c39e6b1/run.zsh
/bin/zsh "$RUN" upgraded python3 /Users/rafael/Downloads/darkcolony/tools/research/live-native-upgraded-hit-20260919.py
/bin/zsh "$RUN" static python3 /Users/rafael/Downloads/darkcolony/tools/research/static-occupancy-20260919.py --probe --constructors --exceptions --reinforcements --include-auxiliary
/bin/zsh "$RUN" inspire python3 /Users/rafael/Downloads/darkcolony/tools/research/inspire-audit-20260919.py --lifecycle-only --json
/bin/zsh "$RUN" construction-normalpass python3 /tmp/dc-native-reference-round4-20260919-7c39e6b1/normalpass.py
/bin/zsh "$RUN" focused-final node --import tsx --test --test-reporter=tap \
  /Users/rafael/Downloads/darkcolony/tools/qa/live-native-combat.test.ts \
  /Users/rafael/Downloads/darkcolony/tools/qa/native-combat-fidelity.test.ts \
  /Users/rafael/Downloads/darkcolony/tools/qa/legacy-static-occupancy.test.ts \
  /Users/rafael/Downloads/darkcolony/tools/qa/static-mission-occupancy.test.ts \
  /Users/rafael/Downloads/darkcolony/tools/qa/inspire-live-integration.test.ts \
  /Users/rafael/Downloads/darkcolony/tools/qa/legacy-inspire.test.ts \
  /Users/rafael/Downloads/darkcolony/tools/qa/legacy-inspire-lifecycle.test.ts \
  /Users/rafael/Downloads/darkcolony/tools/qa/simulation-diplomacy.test.ts
/bin/zsh "$RUN" evidence-summary node /tmp/dc-native-reference-round4-20260919-7c39e6b1/summarize.mjs
```

These are the historical commands, not an instruction to overwrite evidence:
allocate a different unique directory and adapt the wrapper for a fresh rerun.
The temporary normalpass driver loads the unchanged construction script through
`runpy.run_path`, checks the executable hash, then calls `lifecycle(image, counter,
race)` for both races and counters 3/4. Acceptance requires all four cases and
empty `lifecycleInterceptedCalls`; its complete trace is retained separately.

## Hash Pins

All digests are SHA-256. The static report contains the complete per-file source
manifest; its canonical sorted `path<TAB>sha256<LF>` digest is
`497516ed09b15413b1081ea275202ef1c8e7186c7c812dd480ac0d56fffa593f`.

| Original source | SHA-256 |
| --- | --- |
| [DC.EXE](../raw_cd/DC/DC.EXE) | `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b` |
| [GAMESTAT.TXT](../raw_cd/DC/GAMESTAT/GAMESTAT.TXT) | `ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629` |
| [WEAPSTAT.TXT](../raw_cd/DC/GAMESTAT/WEAPSTAT.TXT) | `391e5603108b73cff4a5d2135ae751a0c8aebb934e6f3d6e5e09c5e807e520d0` |
| [MBULLET.TXT](../raw_cd/DC/GAMESTAT/MBULLET.TXT) | `2244665ec4fc4f344b4ad32ec47e209c79a1a240d48f8f43a6035ceab0ae1d22` |
| [BOOMSTAT.TXT](../raw_cd/DC/GAMESTAT/BOOMSTAT.TXT) | `b80addf8e43bacc66c0ab63f4852f0ef13341f3a914d7305743557968baac33a` |
| [DEPEND.TXT](../raw_cd/DC/GAMESTAT/DEPEND.TXT) | `5acff29f0ed0f254f6dae17ddfb8fb1f50f6d99e92a5fe363d638f76abe54fd6` |
| [ANIM.DAT](../raw_cd/DC/ANIM.DAT) | `20e9cf988ed833236ca0687601ab32a2adeaae0d885b39a7507321166bdba3d0` |

| Artifact basename in unique directory | SHA-256 |
| --- | --- |
| upgraded.json | `ecea5d05e6cd9747f3648ae5c91a8f0a2099cf516e762d63ec6fc5bba0a78e19` |
| static.json | `4eb2d1d8e510847d192a7805aaca0eba867e6164671b74440122913adcd9b477` |
| inspire.json | `488c21e1882d3e0cab95f239611118796ca7f600ecffbdfe2ae66ffaf73479bb` |
| construction-normalpass.json | `8b077c176aee0d8a47472cfea6ed53346e297669a699364ac100c1a886bc89c2` |
| focused-final.json (TAP) | `ebfcd29ee785ed1f8fcd8fbc7806e10801f9db5b25f244fa1a22cd688fec5322` |

`evidence-summary.json` also records the four research-script hashes at summary
time. Native reports retain their source/FIN provenance. Shared worktree files
were not locked; summary-time script hashes are not claimed as a before/after
immutability proof for other workers' edits.

## Construction Boundary

**The combined construction gate remains blocked; normalpass does not resolve it.**
The [construction report](construction-lifecycle-20260919.md) documents deliberate
default exit 1, 24/26 accepted original cases, two rejected death components,
eight accepted timed nonlethal cases, and six negative controls. Those are existing
documented results, not new completed combined-gate measurements from this run.

The exact combined command was attempted twice, with labels
`construction-combined` and `construction-combined-retry`:

```sh
/bin/zsh /tmp/dc-native-reference-round4-20260919-7c39e6b1/run.zsh construction-combined python3 /Users/rafael/Downloads/darkcolony/tools/research/construction-lifecycle-20260919.py
/bin/zsh /tmp/dc-native-reference-round4-20260919-7c39e6b1/run.zsh construction-combined-retry python3 /Users/rafael/Downloads/darkcolony/tools/research/construction-lifecycle-20260919.py
```

Both stderr logs contain `KeyboardInterrupt` from the Unicorn callback, with no
completed `.exit` file. Shared-terminal responses also contained unrelated output.
Neither attempt is counted as a pass or as an observed intentional exit 1; partial
combined output is not a reference artifact. The separate normalpass completed
with its own exit 0 and full report. Reachable lethal destruction, interruption
cleanup, and production workflow remain unaccepted.

No full-suite or full-build acceptance is inferred from these focused comparisons.