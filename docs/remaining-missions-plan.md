# Remaining Mission Acceptance Plan

Planning baseline: 2026-09-23, Git revision `2a0a4da`. This document changes no
gameplay, source assets, test expectations, funding, or existing save files.

> **Update, 2026-09-23 (later):** see
> [release-revalidation-20260923.md](release-revalidation-20260923.md).
>
> In the shipped (`main`) configuration, H06, H11, H14, A05, A09 and A14 failed
> at load until the construction-policy fix. The historical H06 and H14 proofs
> were recorded under the QA configuration only.
>
> Every QA driver now loads through `loadReleaseMission`. A09 remains unwon
> after three more fresh strategy variants.

## Target And Baseline

Deliver both 15-mission campaigns as playable, original-script browser-adapted
experiences, including their advertised special mechanics. Exact native timing
is not required; adaptations must be explicit and must not silently change
mission objectives, starting funds, health, diplomacy or loss precedence.

Ten distinct missions have recorded winning proofs:
**H01, H02, H03, H05, H06, H14, A01, A02, A03, A14**.
These are historical, revision-scoped results, not ten fresh passes of the
current tree. Twenty missions still need completion acceptance. All thirty
must pass the eventual release gate on one frozen revision.

Important evidence precedence:

- [H05 independent ready verification](human05-ready-verification-20260923.md)
  supersedes its earlier unsuccessful attempts: pending26143 -> ready26344,
  complete checkpoint equality after201 updates.
- [H14](mission-h14-bounded-20260923.md) and
  [A14](mission-a14-bounded-20260923.md) have winning proofs; do not repeat an
  outdated claim that all missions13-15 remain untested.
- [A10 research initialization is fixed](research-save-compatibility-p1-20260923.md).
  Its first-hive funding question remains open; these are separate issues.
- [H11's latest continuation](human11-rescue-20260923.md) is incomplete with a
  surviving commander, not a newly verified terminal loss at tick17895.
- Unreached script actions are not automatically missing runtime features.
  A failed QA strategy does not establish that a mission is unwinnable.

## Worker Availability

Requested coding model: **gpt6-sol**. It is not exposed in this session's
available agent list. Do not invent an agent/model identifier or represent a
different model as gpt6-sol. Before coding begins, enable that worker or obtain
approval for an available substitute. The planning audits used read-only Explore
agents, not coding workers. No custom agent file can make an unavailable model
available by itself.

Use these logical roles once the coding model is available:

| Role | Ownership | Deliverable |
| --- | --- | --- |
| Coordinator | Plan, integration, scope and final verdict | Current ledger and reviewed task assignments |
| Runtime worker | One explicitly assigned engine boundary at a time | Minimal fix, failing regression, passing focused checks |
| Mission worker A | One mission's driver/tests/evidence | Legal public-command playthrough and continuable checkpoints |
| Mission worker B | A different mission with independent QA files | Same, without shared-runtime edits |
| Independent judge | Read-only code and evidence review | PASS or concrete defects with reproduction steps |

Limit heavy playthroughs to two concurrently, reducing to one if memory pressure
or throughput worsens. More read-only planning is possible; more simultaneous
runtime writers are not. A subagent finishing cleanly is not mission acceptance.

## Work Queue: All Twenty Missions

H = Human, A = Alien. CITY clearance means the original specified building slots,
not an invented aggregate kill target. Source TRO/SCN/MTG and briefings must be
reauthenticated when each assignment starts.

| Mission | Original completion/workflow to prove | Next work and current classification |
| --- | --- | --- |
| H04 | Rescue/extract the authored commander, then clear team2 CITY | Strategy: preserve the demonstrated rescue sequence; defend economy and clear turret approach with coordinated forces |
| A04 | Depot trip16, relocation, enemy CITY clearance, artifact/commander rescue and extraction | Strategy: replace the planner's overly broad turret exclusion with reachable approaches and survivable combat; verify the whole chain |
| A05 | Roswell-support scouting, rescue trip17, abduct through trip18, delayed WIN19 | Strategy: retain movement progress, use actual visible threats and source-controlled allies; stop journal rollover from losing completed stages |
| A06 | Clear team2 Citadel CITY; exercise population-gated reinforcements and LUNATEK workflow | Feature audit plus strategy: resolve/implement mind-control deployment if still unsupported, then economy, force growth and assault |
| H07 | Clear teams2/3 CITY while protecting player and allied Aerogen infrastructure | Feature integration plus strategy: research-center discovery, real collector excavation, artifact use and two-hive assault |
| A07 | Complete the original alliance/betrayal branch and required team1/2/7 CITY clearances | Strategy: test branch-specific goals and diplomacy; never issue player orders to allies |
| H08 | Clear teams2/3 CITY without crossing the team7 casualty-loss threshold | Strategy: scout/protect survivors before committing the main army; prove ownership changes only if original mechanics support them |
| A08 | Player trips, source-owned team6 waypoints, ambush/death/recovery branch and final team7 CITY objective | Source-chain validation plus strategy: observe NPC arrivals and real casualty recovery; do not drive NPCs manually |
| H09 | Clear teams1/2 CITY and satisfy exactly12 team4 victim losses | Strategy: track original breeding-pod identities and exact loss accounting alongside the colony assault |
| A09 | Commander trip2, authored timer, trip3, delayed WIN, surviving through readiness | Strategy: escort or clear the approach before the timed crossing; continue legal protection during pending WIN |
| H10 | Clear team2 CITY with the authored SARGE income-interception workflow available | Integration plus strategy: verify centered mining still links interception, fund production from real income, then assault |
| A10 | Establish the intended opening economy/base and clear team1 CITY before applicable loss gates | Opening resolved: native contact pickups (`4140dc`) — the commander collects the 800-credit psy-energy stores, then buys the 2000 Mind-Hive. Remaining: full play to team1 CITY clearance |
| H11 | Seven team1 TORT losses plus the original trip9/12 or trip11/13 ordering, commander survives | Strategy: plan chamber access before exhausting the assault force; any eligible team0 troop can trigger trip13, not only the commander |
| A11 | Clear team1 CITY | Strategy: coordinated infantry/air/economy; message-only trips are not victory gates |
| H12 | Clear teams1/2 CITY and exercise late resources/reinforcements | Longer verified play: council/waypoint triggers and late clock gates need adequate simulation budget, not just startup probes |
| A12 | Clear teams2/7 CITY and exercise late source rates/reinforcements | Longer verified play: build and sustain forces, verify actual original clock gates |
| H13 | Clear teams1/2/3 CITY, preserve player CITY | Strategy: staged multi-base campaign with authored timed resources and commander recovery |
| A13 | Clear teams1/2 CITY, preserve player CITY | Strategy: staged economy and assault; verify recovery and resource activation |
| H15 | Clear teams1/2/4 CITY; support and exercise the briefing's ESGAARD mechanic | Feature audit/implementation plus finale strategy: establish exact source identity/ability, recovery selector and escalation behavior |
| A15 | Clear teams1/2/4 CITY; deliver and deploy the authored PORTALIS type105 | Feature implementation plus finale strategy: source-backed deployment/effects, recovery, escalation and final campaign completion |

Starting reports: [M04](mission04-playthrough-20260922.md),
[A05/A06](alien-05-06-final-20260923.md),
[M07-09](campaign-07-09-status.md), [M10-12](campaign-10-12-status.md),
[M13-15](campaign-13-15-status.md). These contain historical outcomes and must
not override newer dedicated proof reports.

## Execution Order

### Phase 0: Reliable Evidence And Test Harness

1. Create a small, versioned acceptance ledger for all30 missions with separate
   fields for runtime revision, source hashes, outcome proof, mechanic coverage
   and embedded-browser coverage. Keep bulky artifacts ignored/outside Git.
2. Preserve the existing mission-specific drivers. Share only proven common
   needs: supervised stages, checkpoint persistence, public-input recording,
   outcome proof and integrity receipts. Do not build another replacement engine.
3. Stop using full save-history clones for routine observations. Reuse existing
   compact projections or add a narrow immutable observation API, with equality
   tests. Keep complete authoritative history for save authentication/replay.
4. Track script state from committed controller state or monotonically keyed
   events, not the length of a bounded journal. Do not restore an unbounded UI
   message history to solve a QA cursor bug.
5. Measure initialization, stepping, serialization and proof separately. Use an
   external supervisor with hard deadlines and child cleanup. Save useful progress
   before the stepping deadline; a budget stop stays INCOMPLETE, never PASS.
6. Validate one fresh short mission and one long legitimate resume. Do not lower
   restore guards or infer missing runtime policies to make old saves load.

Exit: trustworthy PASS/LOSS/INCOMPLETE/BLOCKED classification, stable checkpoint
resume, no journal rollover blindness, and no orphan workers. No new mission
is counted complete merely for passing this phase.

### Phase 1: Resolve Shared Blockers And Close Short Chains

- Runtime lane: A10 source-economic investigation and deployment-ability inventory
  for LUNATEK, excavated artifacts/ESGAARD and PORTALIS. Confirm identities from
  source/native evidence; do not conflate LUNATEK with SARGE or ESGAARD with a
  commander upgrade. Split each established mechanic into a tested vertical task.
- Mission lanes: A09 and H11 first, followed by A05 and A04. Exploit their already
  understood source chains, but design a materially different tactic before
  repeating a demonstrated loss. Prefer pre-battle healthy checkpoints over
  exhausted saves containing only a near-dead commander.
- If A10 remains unresolved, record the exact external/native boundary and
  continue independent missions. A proposed deliberate scenario adaptation needs
  explicit user approval and its own labeled profile; it cannot count as an
  unchanged-original-source proof.

Exit: each completed assignment independently accepted; unresolved assignments
remain open and do not block unrelated work.

### Phase 2: Economy, Rescue And Colony Campaigns

- Wave A: H04, A06, H07, H10, A11. Use current centered mining, paid construction,
  upgrades and approach routing. Exercise prerequisite mechanics before full play.
- Wave B: A07, H08, A08, H09. Add mission-specific defense, survivor and diplomacy
  plans instead of one universal rush policy.
- Keep home defense, collector protection and assault roles distinct. Infer
  needed gameplay fixes only from reproducible runtime defects, not poor tactics.

### Phase 3: Long Missions And Finales

- H12/A12, then H13/A13: budget for actual source clock gates and sustained income.
- H15/A15 after special-mechanic integration passes. Winning through ordinary
  infantry alone does not certify the missing advertised artifact features.
- Verify finale result/progression handling ends the campaign correctly rather
  than attempting to load mission16.

### Phase 4: Release Acceptance

Freeze a release candidate and run all30 mission completions with recorded legal
inputs and source integrity checks. Historical wins need fresh verification on
this revision; changed expected digests must be investigated, not overwritten.
Separately test normal sequential progression, Retry, Save/Continue and campaign
end in the embedded browser, including the GitHub Pages repository-prefix build.
Full-game PASS requires all30, required mechanics and the browser checks below.

## Worker / Judge / Rework Loop

For every assignment:

1. **Reproduce:** name the exact mission, current revision, failing behavior,
   source requirement and cheapest check that could disprove the hypothesis.
2. **Classify:** runtime defect, missing feature, QA strategy defect, harness
   defect, source uncertainty or evidence-only gap. Assign one owner and files.
3. **Implement:** coding worker makes the smallest grounded change and immediately
   runs the focused regression. A strategy worker changes only QA orders/planning.
4. **Integrate:** coordinator reviews the diff and neighboring tests. Freeze
   runtime changes before any acceptance playthrough imports modules.
5. **Play and prove:** mission worker issues only normal player APIs, records
   commands and source events, captures pending and ready checkpoints, and runs
   guarded replay. If runtime changes are needed, end the attempt and start a
   new explicitly identified revision; do not mix proofs from different builds.
6. **Independent judge:** checks the actual artifacts, code and source contract.
   Returns PASS or a specific failure, not a generic recommendation to try again.
7. **Rework:** recall the owning coding/strategy worker with that failure and its
   reproducer. Add a regression for review-discovered defects. Repeat until PASS
   or a documented genuine blocker needing information or user authorization.

Do not repeat identical losing routes, add funds, suppress loss conditions,
command enemies/allies, reveal fog or edit statistics to manufacture success.
Use source-known mission destinations only for scouting; direct attacks must
obey the actual player API. Pending WIN is still vulnerable to original loss
precedence. Protection orders during that interval are allowed but must appear
in the replay, not be silently omitted from a201-tick idle proof.

Every20 minutes of active execution, report: accepted/revalidated mission count,
actual progress, current blocker, next action and active worker stages. Bound
delegations so a single blocking call does not hide progress for longer than
that interval. Budget exhaustion means reschedule a preserved state, not relax
acceptance or pretend work continues between turns.

## Per-Mission Acceptance Gate

- Original loader, intact SCN/TRO/TXT/MAP/MTG/PTH and generated-asset hashes;
  all authored blocks present and unchanged.
- Natural original **ready WIN**, correct reason and objective state, no
  runtime diagnostic. Initialization, elapsed ticks, pending WIN, ready LOSS
  and a parseable save are insufficient.
- Full pending checkpoint restores exactly; recorded subsequent public commands
  and normal updates reproduce the entire ready checkpoint exactly. Use the
  actual interval, not an assumed universal201 ticks. Proof has its own budget.
- At least one useful pre-win mid-mission checkpoint restores and continues
  deterministically. Legacy imports are explicit and independently authenticated;
  never rewrite a historical save's expected hash or latched diagnostic.
- Required mission features exercised through public controls, not merely enabled
  in a menu. Include construction, upgrades, centered mining, research, excavation,
  theft, rescue/extraction or special deployment where relevant.
- Source failures/loss conditions remain operational in focused controls.
- Runtime, QA policy and assets pinned for the attempt; all children exit and
  deadlines are honored. Preserve provenance for valid historical runs separately.
- Embedded-browser smoke check for that mission: assets visible, responsive
  selection/orders, no blocking error, objectives/result usable, default mute,
  and no layout obstruction. Desktop and mobile layouts must fit; do not infer
  physical touch support or real-time pacing from Node or synthetic events.

## Global Acceptance And Evidence Storage

Browser tests use **only the local embedded browser**. Do not launch external
Chromium windows or standalone/headless browser scripts. Node NullCanvas is
allowed for state verification but is not visual/audio acceptance. If the
embedded browser cannot establish a gate, leave it explicitly unverified.

Keep originals and bulky traces outside Git, with durable artifact storage rather
than relying solely on `/tmp`. Track a small ledger of artifact names, hashes,
retrieval locations, exact reproduction commands and verdicts. Do not publish
proprietary assets without permission. Full replay verifies consistency, not
cryptographic authorship of arbitrary save files.

Release gate also covers build/typecheck, focused shared regressions, sequential
campaign navigation, repository-prefix asset loading, save isolation, muted audio
startup, source-relevant sound/animation/UI behavior, and representative large
battle responsiveness. Establish measured performance budgets from this machine
before setting thresholds; do not promise a frame rate from startup tests.

## First Coding Assignments

Once the requested worker is available:

1. Harness worker: compact observations, durable ledger and reliable staged
   supervisor, verified against H06 and an existing long-save continuation.
2. Source/runtime worker: A10 opening investigation with a concrete next trace,
   plus an independent inventory of missing deployment identities and mechanics.
3. Mission workers: A09 protection through ready WIN and H11 alternate ordering
   or coordinated chamber clearance, on the same frozen runtime.
4. Judge: reject weak evidence, incorrect source assumptions and snapshot guard
   regressions; return findings to the owner before assigning the next missions.

No completion date is asserted: unknown mechanics and runtime defects must be
measured before a credible estimate. This is the execution and acceptance plan,
not a claim that the remaining missions are already implemented or accepted.