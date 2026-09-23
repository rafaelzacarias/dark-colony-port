# HUMAN02 Independent Pending-To-Ready Verification

## Scope

This independent follow-up addresses only the incomplete restoration proof in
the [original assault report](human02-final-assault-20260922.md). The new
[verification script](../tools/qa/human02-pending-ready-verify.ts) consumes
`/tmp/dc-human02-final-assault-xg3kSr/pending-win.json` at tick 21064 and compares
against the complete `view` in that directory's `checkpoint.json` at tick
21265. It does not rerun the assault from tick 14316, launch agents, or touch
the main browser. Runtime, source assets, the existing driver, and shared QA
fixtures are not edited. The strategy wrapper is not a MissionView checkpoint
and is not advanced or compared as simulation state.

## Method

- Load the actual HUMAN02 browser-adapted mission and require the saved loader
  hash `72fc56880bbeb11d9644ab7a986d35c8722a7eeb282ebd85b83274066c71fec1`.
- Authenticate original SCN bytes and parsed TRO against actual loader output;
  require the six raw file hashes and five recorded runtime/fixture hashes
  from the original compatibility artifact to match.
- Inspect the original public journal at and after the pending boundary. Zero
  public action events are present; otherwise this verifier fails and records
  those commands instead of claiming command-free equivalence.
- Call unmodified `MissionView.restore` with the full pending save. No skipped
  replay, patched guard, checkpoint migration, or injected state is permitted.
- Require deep strict equality of the entire pending checkpoint immediately
  after restoration, then initialize through the usual asset path.
- Reset only the public wall-clock accumulator, call `update(0)`, and advance
  exactly 201 normal 50 ms updates. Check every simulation tick, absence of
  diagnostics, casualty statistic 27, and pending/ready outcome at each step.
- Require first ready WIN at tick 21265 and deep strict equality of the entire
  restored ready MissionView checkpoint with the saved expected checkpoint.
- Hash all runtime source files, shared QA fixtures, the original driver,
  input artifacts, and six raw source files before and after the child run.
  Hash every fetched generated asset and require it unchanged at completion.
- Parent enforces a 1200000 ms child deadline using `SIGKILL`, cleans its
  isolated child process group, and records child liveness and exit status.

## Evidence

Run directory: `/tmp/dc-human02-pending-ready-verify-74yiQk/`.

- `run.log`: isolated child output.
- `verification-journal.jsonl`: restore and continuation phase evidence.
- `public-commands-after-pending.json`: extracted public action events.
- `checkpoint-comparison.json`: full equality result, component comparisons,
  and serialized actual/expected checkpoint hashes, when reached.
- `proof.json`: successful narrow outcome evidence, only after all child
  checks pass.
- `protected-before.json`, `protected-after.json`: protected-file hashes.
- `loaded-asset-hashes.json`: hashes of assets loaded by the normal path.
- `run-summary.json`: authoritative bounded run result and child cleanup.

Strict TypeScript compilation with `--strict --noUnusedLocals
--noUnusedParameters` passed; log:
`/tmp/dc-human02-independent-types-1790137683584.log`. Editor diagnostics for
the new script also passed. The first compile exposed only a local options
typing issue, corrected before execution.

## Judge

**PASS: HUMAN02 original outcome milestone, independently restore-verified.**

The unmodified full restore completed in **390151.026 ms**. The complete pending
checkpoint round-tripped exactly at **tick 21064**. After initialization and
exactly **201** normal updates, the first ready outcome appeared at **tick
21265** as `{resultCode:0,reasonCode:1,ready:true}`. The original casualty
statistic remained **27/27** throughout. No diagnostic occurred and **zero
public commands** were present or issued after pending.

The complete ready checkpoint matched by deep strict equality, including
`sourceIdentity`, `simulation`, `session`, `browserAi`, `economy`,
`combatMovement`, and all view state. Serialized actual and expected ready
checkpoint SHA-256 hashes were both:

`d11d9953ed5f00b7ea8ce1e8285389c8bda9446fadfdf17efe7fb0126f041c34`

The child proof finished in **400371.379 ms**; parent-measured bounded execution
took **400802 ms**, below the **1200000 ms** cap. Exit code was **0**, signal
`null`, with no timeout. All **151 protected files** were unchanged, including
the original input artifacts and source hashes. All **251 loaded generated
assets** were unchanged. The final independent audit rehashed both sets and
confirmed parent PID **75613**, child PID **75616**, and the isolated child
process group were absent:
`/tmp/dc-human02-pending-ready-verify-74yiQk/final-audit-1790138109668.json`.

This closes the prior pending-to-ready restore-proof gap without replaying the
assault from tick 14316. PASS applies only to this HUMAN02 original outcome
milestone in the browser-adapted runtime, not full-campaign acceptance, browser
presentation, or native timing fidelity. Only the two new verification QA and
documentation files were authored; the historical assault report is preserved.