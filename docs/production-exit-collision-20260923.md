# AL03 Production Exit Collision

## Reproduction And Root Cause

The original evidence is `/tmp/dc-artifact-al03-win-1790143729589/`: its
`checkpoint.json` stops at simulation tick518, and its `journal.jsonl` contains
six accepted dependency23 purchases at ticks0,100,200,300,400,500, each costing350.
The final diagnostic is `Occupied or ineligible ground cell 46,9`.

[production-exit-al03.test.ts](../tools/qa/production-exit-al03.test.ts) loads the
unaltered original ALIEN03 mission and replays those harvest, selection, pointer
command and purchase inputs through public MissionView APIs. It does not resume
the already-failed checkpoint or remove its diagnostic. It uses the checkpoint's
source hash to verify the freshly loaded mission. The existing
[mission03-playthrough.ts](../tools/qa/mission03-playthrough.ts) explains the
original camera/pointer conversion; its later stop-purchasing workaround is not
used or changed by this regression.

Exact boundary:

- Queue0's source exit is tile `(46,9)`, native256 center `(11904,2432)`.
- Simulation48 is `transport:193:0`, source type8, slot193/generation0.
- Simulation50 is `transport:195:0`, source type8, slot195/generation0.
- The public tick500 purchase commits as ticket `input:browser:501:dispatch:0`.
- Simulation50 leaves the containing exit tile at tick506. At tick507 the host
  writes reservation1022 for key
  `["alien03:browser",0,0,"input:browser:501:dispatch:0"]`.
- Simulation48 follows its existing public movement order back through the exit.
  At tick518 its position is `(47128,9728)` simulation subcells, equivalent to
  `(11782,2432)` native256, containing tile `(46,9)`.
- Browser-adapted session publication precedes the next simulation advance. The
  following update mirrors tick518's actor position, rebuilds host occupancy,
  inserts production reservations first, then rejects slot193 against1022.
  The attempted tick519 therefore stops with the simulation still at518. This
  reproduces the historical report exactly.

This was not two infantry owning the same cell, an artifact type94 collision,
insufficient funds, a stale generation, or a failed unit constructor. A logical
production ticket reservation had been treated as a physical movement obstacle
in the host but was not mirrored into the browser simulation's path occupancy.

## Runtime Fix

- [campaign-session.ts](../src/engine/campaign-session.ts): narrow occupancy
  reconstruction change permits a live browser-adapted actor to occupy its
  actual tile while retaining the production ticket separately. Actual
  actor/actor conflicts and terrain guards still reject. When the actor leaves,
  reconstruction reinstates1022. Checkpoint reconstruction uses the same rule.
- [transport-host.ts](../src/engine/transport-host.ts): validates reservation
  identity, incumbent registry/slot identity, status, health, plane and position.
  Allocation also checks mobile actors' interpolated centered-cell footprint:
  floor/ceil of `(position - 128) / 256` on each axis. A neighboring containing
  tile alone does not establish vacancy. Direct allocation rejects a blocked
  exit without changing any slot, generation, occupant or reservation. Direct
  browser host movement preserves/restores ticket markers under the same rules.
- [campaign-production.ts](../src/engine/campaign-production.ts): completed work
  retains its allocation request and paid queue head while blocked, then
  allocates once when clear. No repeated completion, slot allocation, debit or
  cap refund. Producer cancellation releases its ticket but leaves a real
  incumbent in place.

The allowance requires the browser-adapted world marker and absence of native
combat, native AI tasks and native resource lifecycle owners. Strict/native
reservations remain physical, exclusive blockers. No native-parity claim is
made for the browser scheduling policy. No movement teleport, forced vacancy,
HP/loss adjustment, fog change, source-data edit or gameplay guard bypass was
used. MissionView and the playthrough driver are unchanged.

## Verification

- Before fix: `/tmp/dc-exit-al03-before-r02.log` reproduces the exact diagnostic
  on the update following simulation tick518, with slots193:0/195:0 and ticket
  identity recorded.
- Final actual replay: `/tmp/dc-exit-al03-geometry-r08-finished.log`; original
  receipt `/tmp/dc-exit-al03-geometry-r08.log.exit.json`, code0. Tick700 reached
  without diagnostic. All six original purchases plus a seventh at600 finish.
  At600 the sixth produced infantry receives a normal public movement command
  to clear the exit. No source or checkpoint gameplay values are edited.
- Full MissionView JSON restores at510 and occupied520 produce exact whole
  checkpoint continuation through700. Credits1754 = initial3500 + earned704 -
  purchases2450; cost accumulator2450; player infantry queue empty.
- Original loader mission SHA256 remains
  `c7b092f45420bc1fb761ec1007d05e985cb3554296dc4b22956f5ce993ccd4a4`.
- [production-exit-reservations.test.ts](../tools/qa/production-exit-reservations.test.ts)
  adds12 controlled infantry/collector/air tests across both factions, including
  same-plane blocks, cross-plane coexistence, interpolated footprint overlap,
  unchanged funds at cap, exactly one allocation request/receipt, cancellation
  preserving the incumbent, and serialized continuation. Two further tests
  restore complete CampaignSession saves while FIN-complete production is
  blocked, then verify exact continuation and a single new slot/generation.
- `/tmp/dc-exit-neighbors-r11.log`:147 assertions passed across the new tests and
  nearby host/collector/adapted-unit/destruction tests. The additional production
  test file initially failed to start because old temporary Unicorn packages
  were incomplete; no gameplay assertion failed in that file.
- Isolated temporary QA dependencies at `/tmp/dc-exit-native-deps-r14` resolved
  that environment failure. `/tmp/dc-exit-native-production-r15.log`:19/19;
  `/tmp/dc-exit-native-strict-r15.log`:3/3, including the existing strict
  reservation collision rejection and both source FIN clocks. No project
  package or lockfile changes.
- Total distinct passing checks:170, including the one actual AL03 replay.
  `/tmp/dc-exit-types-final-r12.log.exit.json`: strict TypeScript with unused
  symbol checks, code0. Editor diagnostics clean for all touched TypeScript.

Actual replay uses original assets under Node/QA NullCanvas, not browser pixel
or rendering evidence. No full suite or agents ran.

```sh
DC_AL03_EXIT_REPLAY=/tmp/dc-artifact-al03-win-1790143729589 \
  node --import tsx --test tools/qa/production-exit-al03.test.ts
node --import tsx --test tools/qa/production-exit-reservations.test.ts
```