# Browser Construction: Central Base Integration

The opt-in fixed-slot v2 runtime/session extension is documented in
[Browser Fixed-Home Construction V2](browser-fixed-construction-20260923.md).
The central-only v1 workflow and saved configuration below remain unchanged;
the subsequent [v2 UI integration](browser-fixed-construction-ui-20260923.md)
supersedes the fresh-main central-only policy described in this historical record.

## Integrated Player Workflow (2026-09-23)

The stage-one owner below is now integrated with CampaignSession, MissionView,
the actual main loader/save workflow, and a separate construction panel.
Scope remains original ALIEN10, team 0, first central base, fixed source home.
No AI construction, relocation, additional building slots, rebuilding, repair,
cancellation, general science/vehicle/air construction, or human construction.

- `loadCampaignMission("alien", 10, "browser-adapted", {completionVisits:120})`
   explicitly enables the profile. The ordinary loader default remains absent.
   Main selects this policy for fresh adapted ALIEN10 only; saved sessions enable
   it only if their saved options already contain it. M02/M03 options and pending
   state remain absent by default. No historical winning-save files were changed.
- Timing is **adapted-not-native**: one visit per committed 50 ms session tick,
   starting on the tick after purchase; 120 visits means 6 seconds of simulation.
   No native constructor, FIN duration or native construction marker is claimed.
- `MissionView.purchaseConstruction(14)` queues one user request, saves it while
   pending, and rejects duplicate/disabled requests. Ordinary ticks never buy.
   Original ALIEN10 visibly reports cost 2000, balance 1500, and 500 PETRA short.
   Neither price nor source money changes. Strict/native admission is unchanged.
- Session stages debit, owner, raw220, slot0/gen0, registry, four-cell occupancy,
   static census and producer state together. MissionView forks session and
   simulation before creating the static target; late projection failure leaves
   the original credits, allocation and pending request intact.
- A source-validated dormant production configuration creates its state on the
   first base purchase without reseeding credits. Slot0 is level0/busy1 at receipt,
   then busy0 at completion. Queue2 collector production becomes eligible only
   when ready; slot1 infantry is not invented. Shared production cost accounting
   includes construction exactly once, while the separate construction ledger
   retains its own paid amount. Incremental income cannot erase the debit.
- Session checkpoints include the optional owner and purchase/damage inputs in
   the existing complete adapted caller journal. Restore requires an independently
   authenticated configuration, exact option equality and full replay equality.
   GAMESTAT, DEPEND records, source PTH/MTG and 50 ms cadence are pinned at admission.
   Serialized configurations alone are not credentials.
- The standalone owner remains strict about external health changes. Its explicit
   journaled-combat integration mode accepts coherent reduced host/entity/raw HP.
   Session damage inputs are monotonic, identity-pinned to slot0/gen0; death uses
   the existing combat-death receipt. Completion never heals, refunds or resurrects
   a destroyed structure. A destroyed receipt cannot purchase a replacement.
- Rendering uses original static source art, exact Q8 position and source
   footprint. No construction animation/native auxiliary actor is fabricated.

### Verification And Limits

- Five focused tests pass in `browser-construction.test.ts` and
   `browser-construction-view.test.ts`: source rejection, insufficient money,
   labelled funded controls, pending save, session and full-view exact continuation,
   typed identity/occupancy, completion, damage/death, no healing, collector spawn,
   late session/view rollback, and M02/M03 option absence.
- 54 neighboring collector/destruction tests pass, including strict production
   rejection. Two native raw220 oracle controls pass using the existing saved
   trace. The broader native construction-view test exceeded its 120-second cap
   with no output; it is not reported as passing.
- Project `npm run typecheck` and strict/noUnused construction-slice TypeScript
   checks pass. No full suite or agents were run by this integration task.
- `tools/qa/browser-construction-browser.mjs` passes in isolated headless Chromium:
   actual main CONTINUE, absent-option save, disabled original menu, funded user
   click, ready-state save, collector enabled. Desktop1280x900/mobile390x844:
   nonblank source canvas, no horizontal text overflow or command overlap.
   Mobile retains the existing whole-game scaling, not a redesigned mobile HUD.
   Report/screenshots: `/var/folders/ql/l6htjzt524z177vst3ntm98h0000gn/T/dc-construction-browser-vn3Plw/`.
- Positive integration controls supply synthetic external income (and matching
   finite reserve depletion for view tests). They are **not earned-income proof**,
   an authentic ALIEN10 opening, or a campaign win. The initial 500-credit gap
   remains unresolved by this task. No other mission was admitted to construction
   merely to obtain an affordable demonstration. Original assets stay unchanged.
- Current M02/M03 loaders pin absence of the new options; historical winning
   saves were not replayed end-to-end in this task.

The following stage-one notes record the original module contract and handoff;
references to missing integration describe that earlier state, superseded above.

## Scope And Status

Standalone owner: [browser-construction.ts](../src/engine/browser-construction.ts).
Only original ALIEN10, local team 0, alien central base, slot 0, first generation.
No existing production, session, view, simulation, host, loader, or source asset edits.
Nothing enables the construction menu yet. This is an integration component, not
a playable ALIEN10 completion or a native construction implementation.

**Untouched ALIEN10 cannot buy this base with its opening credits.** The original
SCN gives team 0 1500, while the original DEPEND price is 2000. No initial player
type-14 collector exists. The module rejects this purchase without changes.
Its successful transaction test explicitly supplies a funded external-world
control; that test is not an earned-income or cheat-free opening playthrough.
No free construction, cheaper price, invented collector, or source change was
introduced to hide the missing 500 credits. The opening's intended native means
of obtaining a base or additional funds remains a required investigation.

## Source Contract

- SCN SHA-256: `8055810eaa2db00c6f07b64e806540f054514dfb616afad886d89f71ed8c00b7`.
- All five player building slots start at zero; home coordinate row is `(119,6)`.
- Alien DEPEND 14: cost 2000, interface 205, fields `[0,0,0,1]`, no prerequisites.
  SCN restrictions do not include 14. Live adapted TRO restrictions are checked
  again at purchase. Human DEPEND 0 has the same cost but is not admitted here.
- Native `0x4380d8` takes slot in EAX, level in EDX, race in EBX; it searches
  building records for those fields. `0x438074` returns an entry's cost.
  [browser-construction-native.py](../tools/qa/browser-construction-native.py)
  executes both original helpers for races 0 and 1 with native-parsed DEPEND:
  both return 2000, with no helper stubs. It pins the original executable hash
  `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
- [projectLegacyColony](../src/engine/legacy-colony.ts) supplies slot mapping,
  Q8 offsets and footprint. Slot 0 is type 28, HP/maxHP 4800, position
  `(29952,1656)` Q8 = `(117,6.46875)`. Its four cells are `(116,6)`, `(117,6)`,
  `(116,7)`, `(117,7)`. Base coordinates are not the sprite position.
- Factory authentication pins complete generated GAMESTAT and DEPEND bytes,
  decoded source PTH family grid and MTG tags, full raw SCN and parsed fields.
  Configuration and nested policy/layout are frozen and privately branded.
  A JSON clone of configuration is not an authentication credential.
- Actual map dimensions are 128x112. All four home footprint cells have false
  infantry eligibility. This is not evidence that infantry can traverse them
  or that native interactive construction would permit them. The adapted
  placement policy explicitly admits only the SCN home footprint, retains the
  terrain mask, and independently rejects occupied/reserved/resource cells.
  Arbitrary relocation and the native base-move command are not implemented.
- Original TRO loses when `c>180` and all five player building health slots
  are zero. `c` is the existing mission cycle counter, not construction visits.

The building receipt documented in [production-runtime-audit.md](production-runtime-audit.md)
sets full HP before animation completion. This owner follows that health model:
the paid building becomes HP 4800 and occupies its cells immediately; it is busy
until the explicitly selected number of adapted visits completes. It does not
invent a cost-derived timer or generalize the science-only native FIN lifecycle.
Native receiver accounting calls the human-race cost helper; both central-base
prices and HP agree here. No broader alien receiver equivalence is claimed.

## API And Transactions

1. `createBrowserConstructionConfiguration({runtimeProfile:"browser-adapted",
   mission, completionVisits, loadBytes?})` authenticates the above source slice.
   `completionVisits` must be explicitly supplied in 1..65535. There is no
   claimed native duration or default production setting.
2. `createBrowserConstruction(configuration, world)` creates a frozen empty
   owner with the current session ID. It requires the existing adapted-world
   marker, complete host storage, empty fixed slot/raw record, and clear source
   home footprint. It rejects native AI/combat/resource/construction task owners.
3. `reduceBrowserConstruction(configuration, state, world, request)` is the
   staging/planning operation. A purchase is
   `{type:"purchase",sequence:1,id:"player:central-base:1",dependency:14,
   home:{x:119,y:6}}`. Visits are `{type:"visit",sequence:previous.sequence+1}`.
   Supply current authoritative credits in `world.exomoney[0]`, never menu state.
4. A successful purchase returns `{state,world,effects}` without changing inputs.
   It debits exactly 2000 once, records `paid=costAccumulator=2000` in the
   construction-specific ledger, creates slot 0/gen 0 and one host `create`
   request, and returns `construction-started` with `busy:1`. The owner emits
   no second debit, refund, unit allocation, or high-water increment.
5. Each visit advances only progress. The final visit emits `construction-ready`
   with `busy:0`; no second actor or host create request appears. Repeating a
   sequence, a second purchase, or a visit after ready throws. Rejected calls
   preserve the original state and world; no partial debit or reservation leaks.
6. Validate all outer session/simulation work before publishing the staged pair
   and consuming effects. If an outer stage fails, discard the candidate. This
   module itself does not commit session state or dispatch UI callbacks.

State is JSON-only:
`{kind,sourceId,sessionId,sequence,receiptId,phase,elapsedVisits,paid,costAccumulator}`.
Phase is `empty`, `building`, or `ready`. Sequence is 0 while empty and otherwise
`elapsedVisits+1`. The source ID includes the authenticated SCN and duration.
There is deliberately no independent credits copy to compete with the world.

The fixed actor key is `browser-construction:0:0:<receiptId>`. Registry, host
generation, entity, bytes, city HP and all four occupied cells agree. Raw fields
include Q8 x/y, type/team at +6/+7, HP at +12, status 1 at +0x2c, empty task-stack
marker 255 at +0x38, and constructor sentinels -2 at +0xd2/+0xd4. Remaining bytes
are zero: this is the browser static representation, **not** native 220-byte
constructor/FIN/task equivalence. No `nativeConstruction` marker is fabricated.
Source original static definitions can have plane `flying`; stationary entities
are still footprint blockers. Only moving aircraft are exempt from that check.

`buildingSlots["0,0"]` becomes 4800 at purchase. Mobile count, kills, casualties,
placement allocator and existing `world.statistics` are unchanged. The existing
mission census excludes fixed city slots from ordinary-unit statistics.

## Checkpoints And Guard Handoff

`restoreBrowserConstruction(freshAuthenticatedConfiguration, jsonOwner, world)`
validates exact owner keys, policy identity, sequence/progress/payment, slot/key/
generation, raw bytes, HP, registry and footprint, then freezes the owner.
It does not serialize or restore the external world. Save the owner alongside
the world's existing typed-array-aware session checkpoint, not JSON.stringify
on a raw CampaignWorld. The tests round-trip owner JSON and continue against
detached external worlds with a newly authenticated configuration.

This structural validation is not historical authentication. Main must journal
construction requests with ordinary income/production/world inputs and replay
them from the original session; a coherent forged world and owner cannot be
disproved from those snapshots alone. Do not accept a saved configuration or
owner counter as evidence of source provenance or elapsed gameplay.

Required existing-runtime changes, intentionally not made in stage one:

1. **Admission and funding:** install the owner only under an explicit adapted
   session profile, excluding native `campaignAi`, construction sources,
   selector owners and other non-world configuration owners as well as the host
   exclusions already checked here. Resolve ALIEN10's actual funding/base-start
   mechanism before claiming a legal original opening win.
2. **Credit owner:** reconcile the debit with the session economy ledger and
   any production/team credits and accounting. Do not let a later income sync
   replace credits from an initial-money formula that ignores construction.
   The new accumulator is construction-local; add it exactly once to any shared
   accounting projection. No economy receipt is accepted or fabricated here.
3. **Static membership/occupancy:** add the new fixed slot to session staticSlots,
   world-to-simulation binding and static target projection in the same staged
   transaction. Update session `rebuildOccupancy` to retain all four owned cells
   for this explicit adapted owner. Today it only preserves native slot-3
   construction specially. Update immutable source-building comparisons and
   restore census guards to recognize only journaled adapted generation 0;
   do not weaken existing native guards or treat the actor as a mobile unit.
4. **Eligibility/production:** project level 0, HP and busy into the live city
   dependency state. HP is present during building, but busy prerequisites must
   remain blocked until ready. Slot 0 supports collector queue 2; it is not the
   infantry factory in slot 1. The current no-owned-factory startup path returns
   no production state. Main must initialize eligible production when appropriate
   without reseeding credits or resetting existing queues/upgrades.
5. **View and saves:** enable constructionMenu/public purchase input, keep pending
   requests through save/restore, consume creation once after commit, and use
   source static art at the Q8 position and exact footprint. Add strict checkpoint
   schema and replay handling for the new owner/effects and readiness. Verify
   rollback on late simulation/projection failure and exact full-session restore.
6. **Lifecycle:** damage, destruction, repair, cancellation, rebuilding, auxiliary
   slots, additional buildings, relocation and human missions are not admitted.
   Current owner validation deliberately rejects external HP/raw identity changes,
   including after ready. Integrate a journaled damage/death handoff before using
   this actor in a combat session; do not continuously overwrite HP from source.

## Verification

[browser-construction.test.ts](../tools/qa/browser-construction.test.ts) loads the
actual ALIEN10 mission and creates the real CampaignSession world. Two focused
tests cover the untouched source contract/insufficient credits and labelled
funded controls: payment, completion, source Q8/HP, occupied/static/resource
footprints, invalid placement/race dependency, duplicate requests, restrictions,
native owner rejection, independent source reauthentication, owner JSON restore
and identical continuation, raw/generation/accounting tampering, and unchanged
SCN/TRO/MAP/MTG/PTH hashes. No source assets are written.

Run only this slice:

```sh
node --import tsx --test tools/qa/browser-construction.test.ts
PYTHONPATH=/tmp/dc-exit-native-deps-r14 python3 -B tools/qa/browser-construction-native.py
```

The native QA needs Unicorn and Capstone; the shown temporary dependency path
was already available on this machine and is not a repository dependency.
Focused tests and strict/noUnused TypeScript validation passed. Native price
probe passed both races. No agents, browser run, full suite, native lifecycle
parity, earned-income positive, or full session/view integration was performed.