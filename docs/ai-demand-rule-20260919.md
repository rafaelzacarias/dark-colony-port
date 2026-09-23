# Native AI Demand and Rules

## Implemented Boundary

`consumeLegacyAiPolicyPipeline` in [legacy-ai-active.ts](../src/engine/legacy-ai-active.ts)
now executes preparation, observation, demand assignment, group census, queue
census and first-zero rule dispatch atomically. It returns `nextGroup: 0`,
`readyWholeCall: false`, `admitted: false`, and `remainingGroups: [0,1,2,3]`.
`consumeLegacyAiDemand` executes the exact `0x457940` stage on an already
prepared policy. Both are exported through [legacy-ai.ts](../src/engine/legacy-ai.ts).
There is no snapshot lookup, source-prefetch fallback, callback injection or
blanket rejection of the rule stage. No shared session, view, main, simulation
or admission gate was edited.

The original sequence is:

1. `0x457568` assigns eligible actors again, using the current links and quotas.
2. `0x459d98` recounts group 0 as category 6. `0x44b6a4` recounts groups 1-3,
   clearing every bucket's nine counters, including disabled buckets.
3. The four current team production queues add their unit categories to nine
   signed dword demand totals. This is queued production, not source purchases.
4. `0x4578d0` reads the original 18 records in order. The first predicate
   returning **zero** executes its action; no later predicate is evaluated.

All four predicate callbacks and three substantive actions are translated:

| Predicate / Action | Behavior |
| --- | --- |
| `0x4564c8` / `0x456550` | Race-indexed dependency lookup, recursive city prerequisites, busy/restricted/completed checks, signed affordability, debit and city packet. |
| `0x45642c` / `0x456448` | Category-6 threshold; ascending source dependency scan, request every available harvester while affordable, stop on the first unaffordable eligible one. |
| `0x456664` / `0x4566ac` | Actual selector-6 census versus current population cap; categories 0,2,3,4,5 demand sum; signed `imul` weights; first strictly smaller candidate below 10000; debit and one unit packet. |
| `0x456868` / `0x456874` | Always-zero predicate and the actual native no-op fallback. |

Native quirks are preserved. Category 6 has weight 10000 and cannot win the
weighted action. Ties keep the earlier dependency. Signed sum/product overflow
is retained. The late upgrade entries still call the *city* helper and test
its byte at `team+0x78+target`: HUMAN candidate rules 12/13 are shadowed by rule
4 when that byte is busy; ALIEN rule 13 is shadowed by rule 12. These are
zero-based indexes. Tests do not rewrite the original table to force reachability.

## Owner Inputs

`LegacyAiDemandInputs` extends the existing assignment inputs. The caller
provides the **current selected native team**, its complete mutable 0xe30 team
record, immutable 110*52 dependency bytes and 110*280 type bytes, and:

- `population`: current native selector-6 census, not an entity-length estimate.
- `populationLimit`: current game+0x528 limit, not a hardcoded 150.
- `cityDependencies`: the 18 signed dwords at executable `0x488ff4` (nine
  human/alien pairs), distinct from the 18*12 rule table inside the policy.

The producer owner supplies these current team fields:

| Team Offset | Input / Mutation |
| --- | --- |
| `+0x14`, `+0x20` | Signed current credits (debited by actions), race. |
| `+0x3c`, `+0x78`, `+0xc4` | Fifteen city health dwords, busy bytes and level dwords. |
| `+0x110` | Four unsigned-word queue lengths. |
| `+0x118 + queue*800` | Current queued unit-type bytes, in owner order. |
| `+0xda4` | 110 dependency restriction bytes. |

`LEGACY_AI_DEMAND_CAPS` and the result's `inputCaps` expose 800 entity slots,
110 dependency records, four queues of at most 800 stored bytes, and 18 rules.
This is native storage capacity, **not** an expansion of the production owner's
existing queue safety limit. Overlapping inputs, unknown table/census callbacks,
invalid capacities, and cyclic dependency/member graphs reject before commit.
There is no implicit SCN-team mapping: a remapped owner supplies its remapped
`team`, current record, census and actor ownership. Team-7 controls cover both
races and the complete assignment/observation/demand pipeline.

## Production Handoff

Actions return `LegacyAiProductionIntent[]` as `productionRequests`, including
source dependency, callback, team, city/level or unit/count, exact cost, credits
before/after, and the seven-byte mode-9/mode-10 packet. The native encoder
callbacks are `0x40c13c` and `0x40c168`.

The stage commits policy, entity links and **the actual team credit debit**;
it does not reserve another purchase or execute a producer lifecycle. Each
intent says `receipt: "pending-owner"`, and the result says
`productionLifecycleExecuted: false`. The orchestrator must retain intents and
the debit in one transaction and must not charge again when handing them to
the production/transport owner. Do not feed them blindly into a reserve API
which performs its own debit. Receipt, refunds, queue insertion, construction
and allocation have not been certified by this reducer. No arbitrary JS
callback is called to pretend these effects happened. All stage RNG draws are
zero; the caller's cursor and force-order byte are unchanged.

## Native Evidence

[ai-demand-20260919.py](../tools/research/ai-demand-20260919.py) executes bounded
original functions for HUMAN02/team 2 and ALIEN02/team 1 at selected seed 0.
It reuses the full source initialization proof's eight team records and entire
entity pool, source PTH/observation inputs from the existing fixture, and the
existing source-backed production dependency loader. The lightweight placement
initializer alone leaves dependencies zero: a failed coverage check caught
that and those earlier all-no-production captures are **not** acceptance evidence.
These are reconstructed bounded input worlds, not historical scheduler replay.

The native action and packet encoders really run. Only transport `0x421648`
is captured at its output boundary; packet length comes from its native length
argument. Receipt and production lifecycle execution are explicitly excluded.
Every capture retains before/after policy, all 800 entities, all eight team
records, RNG, force-order, exact predicate/action order, demand totals and packets.
The tests compare all bytes, not just a changed-byte hash.

Final evidence: **107/107 demand tests**, covering 100 full stage/pipeline
captures and 324 native predicate calls. Includes all 18 predicate records,
reachable first-zero selections and the shadowed negatives, real city/unit
requests, busy/restricted/unaffordable branches, cap equality, four live queues,
weighted overflow/10000 ties/no candidate, remapped owners, and atomic rollback.
The adjacent active tests pass **7/7**. Strict TypeScript checking of the touched
implementation and new test passes. No browser, agents, full suite, or huge
world run was used.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/research/ai-demand-20260919.py > /tmp/dc-ai-demand-native.jsonl
DC_AI_DEMAND_TRACE=/tmp/dc-ai-demand-native.jsonl \
  node --import tsx --test tools/qa/legacy-ai-demand.test.ts
```

The probe requires cached source proof and natural traces; `--source-proof`,
`--human-world`, `--alien-world` override their recorded local paths. The tests
accept `DC_AI_DEMAND_TRACE` to reuse captures without running Unicorn again.
Final local capture: `/tmp/dc-ai-demand-native-0919-f2.jsonl`; comparison log:
`/tmp/dc-ai-demand-tests-0919-f2.log`.

## Precise Remainder

Demand/rule computation and production intent generation are implemented, not
another unimplemented wrapper. **The entire `0x44be40` call is not ready.**
Remaining work is group-0/2/3 decisions and nonshared orders; group-1
retarget/release/create branches (`0x463840`, `0x464074`, `0x463eec`); production
and order receipt plus later task/lifecycle consumption; and owner integration.
The bounded existing group-1 consumer is not a replacement for those branches.

The reused natural seed-0 runs reach target four-group frames 14124 HUMAN and
1160 ALIEN, but their group snapshots start **after demand**. They do not retain
the earlier demand policy/team/census buffers. The new probe records their hashes
and explicitly returns `naturalEvidence.demandInputsCaptured: false`; it does
not invent historical inputs from post-demand snapshots. Historical demand
parity remains unverified under the requested no-world-rerun constraint.
Mode 3 remains blocked.