# Trigger Array Integration

Implemented 2026-09-19 against the native contracts in
[mission02-control-actions-20260919.md](mission02-control-actions-20260919.md).
This is runtime/controller integration, not HUMAN02 or ALIEN02 admission.

## Runtime Contract

- The source parser is unchanged. An omitted lives token remains `flag: null`;
  runtime initialization derives zero. Zero lives skips condition and action
  evaluation. Explicit lives retain the existing supported byte range 0..255.
- `setarray index expression` is a VM mutation, not a world command or no-op.
  Its literal integer index truncates to unsigned 16 bits, then must be 0..799.
  Index 65536 addresses zero; 800 and 65535 fail closed.
- Support auditing parses expressions without evaluating them. Dispatch evaluates
  against the current inputs and staged statistics with team context -1, even
  inside a trip. `c` remains signed int32 counter shifted by four and narrowed
  to int16. Added `+` wraps to signed int16. Other unsupported operators still fail.
- The signed result is stored as a sign-extended dword value in the existing
  `runtime.statistics` map, using canonical key
  `${Math.floor(index / 110)},2,${index % 110}`. No detached array is introduced.
  Index 110 aliases `s(1,2,0)`; index 799 aliases `s(7,2,29)`.
- Three-argument selector-2 reads normalize these aliases; absent canonical cells
  read as zero, representing native reset with sparse storage. Other missing
  statistic namespaces still fail. Reads stay within the eight-team physical
  table; unsafe out-of-table aliases are rejected. Seed/checkpoint values must
  use canonical team/type keys, not duplicate alias keys such as `0,2,110`.
- Actions retain reverse source order, numeric trigger scan order, staged reads,
  same-scan downstream visibility, and clone/rollback semantics. A failed action
  or rejected adapter commit cannot publish provisional lives or array writes.

## API Delta

[mission-controller.ts](../src/engine/mission-controller.ts) exports:

- `isMissionRuntimeAction(action): boolean`: classifies `bail`, `setlifes`, and
  `setarray`. Classification is not argument validation.
- `auditMissionTriggerSupport(blocks): readonly TriggerDiagnostic[]`: audits
  complete unfiltered programs using the VM and existing world-action decoder,
  checks `setlifes` targets, and preserves original action indexes. Unsupported
  `ai`, `newrate`, and unknown actions remain diagnostics, including dead blocks.

Existing runtime/controller state and adapter signatures are unchanged. A
successful plan exposes array mutations in `plan.next.runtime.statistics`;
`commitMissionPlan` returns them in `value.state.runtime.statistics`. They remain
in the action trace but require no fabricated world-command receipt.

Expressions reading world-owned fields after earlier `exomoney`, `newtype`, or
`reinforce2` commands suspend with `next: null` and `pendingEvaluation`, just like
world-dependent conditions. Its existing `condition` string can now contain the
pending action expression. This is not a resumable partial commit. Selector-2
and victim-loss reads remain immediate. General ordered world feedback is still
the host's responsibility; do not evaluate against stale world statistics.

## Orchestrator Handoff

No campaign world/session, game-data, main, mission-view, architecture, generated
data, source TRO, or shared audit file was edited.

1. In [game-data.ts](../src/game-data.ts), replace the duplicated VM/world audit
   split with `auditMissionTriggerSupport(blocks)`, retaining its existing
   `TRO ${entry.triggerId ?? "program"}: ${entry.message}` formatting and all
   unrelated scenario/world prerequisites. Alternatively use
   `isMissionRuntimeAction` in both existing filters, but retain VM argument
   validation; merely skipping `setarray` in the world decoder is insufficient.
2. Preserve committed canonical selector-2 keys during generic statistics
   refresh, checkpoint cloning, and world feedback. Start refresh from
   `committed.state.runtime.statistics`, then overwrite only world-owned fields.
   Do not replace it with a newly zeroed statistics table or overlay pre-plan
   selector-2 values after commit. The session's existing clone-and-refresh of
   selector 1 preserves selector 2; keep that property in the resource-host work.
   Two-argument resource statistics and three-argument selector-2 cells are
   distinct namespaces. Zero absent cells only on a true fresh runtime/reset.
3. Update focused preflight expectations in
   [mission02-audit-20260919.py](../tools/research/mission02-audit-20260919.py):
   remove omitted-lives rejection and both `setarray` rejections. HUMAN02 must
   still reject blocks 8/16 `newrate` and 17 `ai`; ALIEN02 must still reject block
   0 `ai` and 10 `newrate`, until their separate host implementations are proven.
   The control-action probe imports this preflight, so its unchanged wrapper
   has stale goldens even though the native evidence remains valid.
4. Retain complete-source/generated equality and pinned source hashes. Do not
   filter disabled blocks, substitute lives flags, or rewrite originals to pass
   admission. Rerun the focused preflight after the orchestrator changes.

## Verification

```sh
node --import tsx --test tools/qa/trigger-array.test.ts tools/qa/trigger-runtime.test.ts tools/qa/mission-controller.test.ts tools/extractors/data/triggers.test.ts
npm run typecheck
```

The array test checks dispatch-counter goldens, signed dword values, context -1,
zero reset, aliases, index truncation/bounds, reverse action order, same-scan
reads, strict delayed threshold, clone/rollback, pending feedback, and unknown
actions failing closed. Complete original HUMAN02 (20 blocks/42 actions) and
ALIEN02 (12 blocks/25 actions) match generated blocks and the native audit's
pinned SHA-256 hashes, totaling 32 blocks/67 actions without source edits.
No browser, agents, full suite, or full native mission playthrough is required
or claimed by these checks.

Observed results on 2026-09-19:

- All 50 focused tests passed. An isolated strict TypeScript check of the two
  runtime/controller modules and four focused test files passed.
- The unchanged native probe's `instruction_probe`, `source_probe`,
  `header_probe`, `statistic_reset_probe`, and `array_probe` passed. Both complete
  TRO loaders consumed every source byte and verified all 67 reversed action
  links. This invocation intentionally excluded the stale `preflight_probe`
  wrapper; it did not alter its assertions or sources.
- Project `npm run typecheck` was attempted but blocked by concurrent files
  outside this ownership: `CampaignWorld.statistics` inferred as a union with
  undefined properties in [campaign-world.ts](../src/engine/campaign-world.ts),
  and a missing required `statistics` field in
  [transport-host.test.ts](../tools/qa/transport-host.test.ts). Those files were
  left untouched. Rerun project typecheck after the resource-host merge.