# Campaign World Adapter

This is a pure integration boundary around the mission controller, not a live
campaign implementation or evidence of mission completion. Direct imports are
from `src/engine/campaign-world.ts`; no view, entry point, export barrel, or
transport implementation is changed.

## What Can Be Wired

- `createCampaignWorld` copies SCN declarations and loaded message text. Each
  placement retains its numeric source team, type, coordinates and uninterpreted
  tail. Initial health/maxHealth comes from the matching GAMESTAT unit record,
  never a generic structure HP or a guessed placement-tail interpretation.
  Missing stat health fails. TRO reinforcements are not expanded into entities.
- `campaignStaticTargetOptions(entity, teamFactions)` projects an explicitly
  chosen fresh entity into `simulation.addStaticTarget` options. The caller must
  supply the numeric-team to simulation-faction map. This projection does not
  classify every SCN placement as a static target or implement diplomacy,
  collision, production, reserved structures, or registered census.
- `bindCampaignEntity` associates the returned simulation ID with the declared
  entity, optionally with a supplied raw slot. Duplicate bindings and implicit
  rebinding fail. A raw binding must match the declared team/type. Raw allocation
  is not inferred from SCN row order.
- `campaignVictimLosses` converts actual simulation `DeathEvent` records into
  team-first victim losses. IDs contain mission session, entity key and generation;
  replay at another tick is still the same loss. Unknown victims fail. No attacker
  kill credit, ownership conversion, disappearance, or transport pickup counts as
  a loss. Controller statistics must be explicitly initialized by the caller,
  including aggregate selector 3 and per-type selector 0 for expected victims.
- `planCampaignStep` delegates to `planMissionStep` with the world's reserved
  building slots. It returns the unchanged plan, including `pendingEvaluation`,
  and an inspection-only `pendingTransport` list in command order. The list is
  not an accepted task queue, a receipt, or permission to publish a prefix.
- `stepCampaignWorld` stages deaths, clock, controller planning and adapter
  preparation. On success publish its returned controller and world together.
  On failure retain the originals and retry the same deaths after correcting
  missing inputs. No simulation mutation occurs inside this function.

Death events are cleared by the simulation on the next tick. Buffer them outside
the adapter until a transaction commits. Keep the controller's consumed-loss
ledger across saves. Reinforcement allocation/reuse must supply durable entity
keys/generations and bindings; the adapter does not allocate native slots or
infer delivered commanders. Keep raw slot snapshots current with live movement,
status and type before preparing commands. Health outside explicit death events
is not synchronized automatically. Do not roll back combat that already happened
in the simulation when mission preparation fails.

## Ordered Preparation

`createCampaignWorldAdapter(transport?)` implements the controller's synchronous
`prepare` contract. It stages a deep copy and returns ordered receipts only after
all commands succeed. Input world objects, raw bytes, plans and controller lives
remain untouched on failure. Backend arguments and successful returned data are
copied too. No UI, audio, live simulation methods, timers, or browser operations
are invoked.

| Command | Adapter work |
| --- | --- |
| `msg` | Append loaded text, command ID, current uint32 clock, presentation code, both raw parameters and initial value 31. Missing text fails. Full 16-entry queues and parameter4=255 explicitly fail because rollover/special selection is not verified. No invented expiry or presentation behavior. |
| `exomoney` | Assign the numeric side field; never add money, convert to boolean or write statistics. Initial side values are not inferred from SCN. |
| `waypoint` | Scan all 800 raw slots in order, including inactive slots, and write tile-center waypoint words, order bytes and point count to the first coordinate match. Does not move the entity. Complete raw input is required even for a verified no-match result. |
| `newtype` | Delegate to `applyTriggerNewtype` using all 800 slots and 110 movement bytes. Only the selected type byte changes. Update a bound entity's type without changing its owner, current health or maxHealth. |
| `abduct` | Require an explicit full commander slot and raw status. Status 0/10 produces `verified-inactive-target`; otherwise delegate to transport preparation. No instant removal, health write or loss. |
| `reinforce` | Delegate one ordered five-group payload to transport preparation. No formation expansion or spawning here. |
| `reinforce2` | Require transport preparation to synchronously apply verified FIFO/collision behavior. An asynchronous `scheduled` receipt is rejected. |

For `newtype` and `waypoint`, a raw match can be an inactive slot with no declared
entity projection. This is intentional; filtering to live declared placements
would contradict the verified native selection rules.

## Transport Boundary

`CampaignTransportAdapter.prepare(world, planned)` is an explicit bridge for the
separately authored live transport backend. `world.transportState` is an opaque,
structured-cloneable snapshot owned by that bridge. The bridge must return the
complete staged world and an appropriate disposition:

- `reinforce`/active `abduct`: `scheduled` only after verified carrier/task
  allocation has succeeded, preserving pool reservations and full target slots.
- `reinforce2`: `applied` only after all synchronous FIFO/creation operations
  have succeeded, retaining FIFO ownership and existing collision state.

The bridge must be pure and deterministic. It cannot close over and mutate a
live simulation, audio device, UI, shared pool or external queue. Copying arguments
protects those arguments, not arbitrary captured references. Exceptions become
diagnostics, but cannot undo a backend's external side effects. After successful
commit the orchestrator publishes the returned state; it separately drives the
transport lifecycle. There is no import or automatic binding to
`src/engine/legacy-transport.ts`, and this work does not certify that backend.

Without this bridge an active transport command fails with `missing-input`;
earlier message/economy work and proposed lives/bail are not committed. Inspect
`pendingTransport` to identify the required work, not to launch it before commit.
Transport completion is independent of the bail deadline. Poll
`missionBailDeadlineExceeded` even when a later scan fails; equality is not expiry.

## Missing World Inputs

HUMAN01 normal scans require actual reserved structure states for `b(1,0)` through
`b(1,4)`. The SCN `%City` rows, building counts and static-target HP do not establish
those values. No slots default to 0 or 1. With the default empty slot map HUMAN01
fails explicitly at its colony predicate, before startup commits. Supplying
test slot values proves evaluation of supplied inputs, not colony support.
The adapter does not infer updates to these slots from combat deaths.

After planned `exomoney`, `newtype` or synchronous `reinforce2`, the controller can
return `pendingEvaluation` before a later eligible world-dependent condition.
`planCampaignStep` preserves that result; `stepCampaignWorld` refuses commit. It
does not evaluate the remaining condition with stale buildings/census, commit a
prefix, or restart the scan. A resumable per-block transaction is not implemented.
The controller's dependency guard and limitations remain as documented in
`docs/mission-controller.md`; this adapter does not add a general dependency
analyzer or refresh non-loss statistics. Across scans the orchestrator must
supply correctly timed statistics and building state too.

Normal scans still belong on the verified every-eight-update gate, with the
original cycle counter and independent millisecond clock. Trips must come from
successful destination reservations using `tripForReservedMtgDestination`, not
region polling. These functions do not implement either scheduler.

## SCN Team Parser Caveat

The following describes the pre-correction parser and is superseded by
[native SCN field evidence](scenario-team-fields.md). The current extractor
now assigns the value before each trailing comment marker to its field.
Its real-source tests cover the corrected values; colony-slot adapters remain
unimplemented.

The former extractor read the scalar after `%Race` into `race`, the scalar
after `%Money` into `money`, and the scalar after `%AI` into `ai`; the preceding
scalar is retained separately as `preambleValue`. In actual ALIEN01, team 0 has
`preambleValue=1` but parser-labelled `race=0`. Team 1 has parser-labelled
`money=4` and `ai=7`. These names are not proof of native field meanings: the
markers may delimit the preceding rather than following values. Resolving that
requires source-loader evidence. This adapter neither fixes the out-of-scope
parser nor reinterprets those numbers as race, funds, AI, or byte offsets.
The full supplied source object is preserved; ownership uses placement team
numbers, and simulation faction projection requires an explicit map.

## Verification And Limits

```sh
node --import tsx --test tools/qa/campaign-world.test.ts
npm run typecheck
```

Tests load the actual HUMAN01/ALIEN01 SCN, TRO, MSG, HUMAN01 MTG, and extracted
GAMESTAT records without replacing script actions. They cover ordered startup
plans, supplied colony inputs, immutable failure, real trip-7 rearming and beacon
ownership, and eleven actual simulation combat deaths of ALIEN01's declared
team-1 type-82 static targets. Ten losses do not win; the eleventh sets pending
success bail and schedules pickup only with a supplied valid commander slot and
live victory trigger. The commander remains present. Replayed deaths do not
increment counters twice.

Tests explicitly supply controlled raw slot/movement snapshots, colony slot
states, and a commander checkpoint; these are not native loader acceptance.
The transport scheduling fixture only records commands in copied queue state to
test the bridge contract. It does not prove pool allocation, flight, collision,
FIFO consumption, delivery, pickup, or campaign completion. ALIEN01 startup is
planned but cannot commit through that fixture because synchronous `reinforce2`
is deliberately unsupported. No live backend, mission view, main entry point,
browser, or original-game playback was exercised.