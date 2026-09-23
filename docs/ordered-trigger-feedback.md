# Ordered Trigger Feedback

Implemented 2026-09-19. This closes the campaign-session gate for same-block
world commands followed by VM expressions, and for subsequent block conditions
that need the actual staged host census. It does not admit unsupported actions
or certify complete missions.

## Execution Contract

[mission-controller.ts](../src/engine/mission-controller.ts) exports
`executeMissionTransaction(state, inputs, event, world, adapter, losses?)`.
The adapter prepares each world command and returns feedback containing the
staged world, statistics, and building slots. Success returns the controller,
world, command/receipt lists, action trace, and fired block IDs together.

- Blocks execute in numeric ID order; actions execute in reverse source order.
  Every expression executes once at its original position. There is no replay
  of an already evaluated action prefix after feedback arrives.
- A condition-zero, action-free planning pass reuses input, lives, event and
  victim-loss validation. It does not execute source expressions or effects.
  It neither resets lives nor publishes an intermediate controller.
- Each VM action delegates to the existing `stepTriggerRuntime`. Its synthetic
  decrement is neutralized, retaining self-rearm writes, including zero. The
  actual block decrements once after all actions, including byte wrap 0 to 255.
  Zero lives written inside an active block do not stop its remaining actions.
- Normal conditions have no fabricated trip team. Trip conditions receive the
  actual event team. `setarray` retains the runtime's context -1 in both modes.
  Bail writes and deadline replacement occur at their reverse-order positions.
- Commands carry the full dispatch-time statistics, not narrowed expression
  values. In particular, `newrate` retains its 32-bit scale. IDs are
  `baseRevision:blockId:sourceActionIndex`; diagnostics use original positions.
  Each singleton command must receive exactly one matching receipt with a
  valid disposition before feedback is accepted. Returned receipts preserve
  execution order.
- Both execution and pure-plan commit pass deep-cloned commands to `prepare`,
  including action arguments, decoded payloads, and statistics. Adapter writes
  cannot change the original controller, plan, or executor command/action trace,
  even when preparation rejects the command.
- Both APIs use the same receipt validator. Receipts must be an array of the
  expected length with an own entry at every expected index; holes and inherited
  entries are rejected. Each entry must be a non-array object with its own
  string `commandId` and command-appropriate `disposition`.
- Receipt fields are read once, validated, and copied into detached plain
  records before feedback runs. Throwing entry/field accessors reject receipts
  with an invalid-input diagnostic. Reusing or later mutating an adapter receipt
  or receipt array cannot alter previously accepted output. These are detached
  snapshots with readonly TypeScript types, not runtime-frozen objects.
- The executor clones world, runtime, and inputs. Adapters must restrict effects
  to these staged values; external I/O is not reversible by this API. Callback
  failures reject the transaction, with no partial result for publication.

The pure `planMissionStep` and `commitMissionPlan` APIs remain available.
`pendingEvaluation` is still valid for pure planning and still cannot be
committed by supplying receipts. The executor starts from the original
controller, not from a pending plan's partially evaluated prefix.

## Session Integration

Only `scanEvent` and its imports change in
[campaign-session.ts](../src/engine/campaign-session.ts). The restore validator
is untouched. The session uses the executor for the entire event, preserving
original block modes and event context. Revision now advances once per
successful scan event, rather than once per artificially isolated block.

After every command, `synchronizeRawAndHost` and `refreshFeedback` run on staged
clones. Thus `reinforce2` registration and `newtype` changes reach later census
expressions and conditions immediately. VM statistics accompany every command;
the final refresh also publishes array/bail writes after the last command to
the backing world statistics. Census refresh replaces only its owned fields.

`exomoney` continues to assign its side field. It does not invent or overwrite
an `s(team,selector)` statistic. Production credit synchronization remains at
the existing end-of-trigger boundary inside the enclosing staged session tick.
A late failure discards prior messages, host creations, raw-slot mutations,
VM/lives/bail/revision changes, production changes, and journal additions.

## Focused Gates

- Source-backed same-block message/money, census snapshots, reinforcement,
  newtype, and next-block condition; one creation and no prefix reevaluation.
- Array preservation across commands, final publication, and later host ticks.
- Runtime-equivalent self-rearm values 0/1/3/255, reverse bail order, normal and
  trip contexts, original diagnostic positions, receipt and feedback rejection.
- Native-backed production fixture: successful credit synchronization and
  invalid-final-action rollback of the complete checkpoint and journal.
- Resource fixture: scale 65536 reaches `newrate` unchanged, produces rate 256,
  and yields zero when read through the signed-word expression VM.
- Generic adapter boundary: rejecting metadata mutations leave source/controller/
  plan unchanged; sparse, inherited, malformed, and throwing receipts fail
  closed; accessor fields are read once; reused receipts and feedback mutations
  leave accepted IDs and command/action traces stable. Commit output is detached.

Adapter-boundary regression gate:

```sh
node --import tsx --test tools/qa/ordered-trigger-feedback.test.ts tools/qa/mission-controller.test.ts
npm run typecheck
```

Broader ordered-feedback integration gates:

```sh
node --import tsx --test tools/qa/mission-controller.test.ts tools/qa/trigger-array.test.ts tools/qa/trigger-runtime.test.ts tools/qa/resource-host-integration.test.ts
node --import tsx --test --test-name-pattern='ordered|same-block source|explicit HUMAN01 trip-7|failed session inputs' tools/qa/campaign-session.test.ts tools/qa/campaign-production-session.test.ts
npm run typecheck
```

## Remaining Limits

`ai` and other unverified actions still fail closed. Existing host restrictions
on resource ownership/type transfer, transport semantics, missing statistics,
message rollover and unsupported targets are unchanged. Feedback only includes
the world's implemented statistic/building producers; this is not a new
implementation of every native aggregate selector. Full mission admission,
browser behavior, performance benchmarking, and the full suite are outside
this gate. No parser, source scripts, generated assets, main/view code, or
production restore validation was changed.