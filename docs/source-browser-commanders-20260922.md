# Source-backed browser commander mappings

Follow-up: [source artifact support](browser-artifacts-20260922.md) resolves the historical A04 type94 blocker. The updated controlled A04 test now retains every original action and verifies full spawn/extraction with exact restore; the earlier commander-only evidence below is historical.

## Scope

Runtime change: [source-browser-campaign-options.ts](../src/engine/source-browser-campaign-options.ts) only.
New QA: [source-browser-commanders.test.ts](../tools/qa/source-browser-commanders.test.ts).
No campaign-session, source asset, production, transport, or simulation changes.

The existing mapping prefix remains unchanged: human team 0/type 69/TRSC;
alien team 0/type 73/GRAY and team 1/type 69/TRSC. Additional mappings are
required only for teams selected by authored `abduct` commands. Derivation is
source-driven, not mission-number-specific, and does not map every team by race.

## Source Evidence

[GAMESTAT.TXT](../raw_cd/DC/GAMESTAT/GAMESTAT.TXT) defines commander types
69-72 as TRSC and 73-76 as GRAY. Ordinary infantry also uses those sprites;
sprite matching alone cannot establish a commander role. The implementation uses
[sourceUnitIsCommander](../src/engine/browser-casualty-pickup.ts), then validates
the actual unit definition against the authored team's race.

| Mission | Original source chain | Appended mapping |
| --- | --- | --- |
| HUMAN04 | TRO 6: `reinforce2 1 6 29 72 1 ...`; TRO 7: `abduct 1 1`, enable 8 | team 1/type 72/TRSC |
| ALIEN04 | TRO 10: `reinforce2 4 6 5 69 1 ...`; TRO 11: `abduct 4 1`, WIN | team 4/type 69/TRSC |
| ALIEN05 | TRO 17: `reinforce2 7 85 44 72 1 ...`; TRO 18: `abduct 7 0`, enable 19 | team 7/type 72/TRSC |

Original scripts: [HUMAN04.TRO](../raw_cd/DC/SCENARIO/HUMAN/HUMAN04.TRO),
[ALIEN04.TRO](../raw_cd/DC/SCENARIO/ALIEN/ALIEN04.TRO),
[ALIEN05.TRO](../raw_cd/DC/SCENARIO/ALIEN/ALIEN05.TRO).

Placement evidence follows the existing source race/counterpart rule at
`rawTail[20]`. RENAT rows do not directly establish team ownership. Type-37
coordinate markers and subsequently captured placements, plus `reinforce2`
payloads targeting those queues, do not establish a commander team: queued
types are teamless until collector retrieval. Ordinary `reinforce` remains a
team-owned delivery even at the same coordinate.

The existing structured mission-action decoder validates both reinforcement
forms, including source padding and positive group counts. All authored blocks
are considered, including initially disabled blocks; mutually exclusive branches
are not guessed. More than one candidate type, no candidate, invalid definitions,
missing counterpart metadata, or conflict with a preserved mapping rejects.
Simultaneous duplicate actors of one mapped type still hit the existing session
ambiguity guard. No new runtime guard bypass is introduced.

## Validation

Six tests passed (98.959 seconds in the recorded run):

1. Original rescue mappings and unchanged M01/M02 prefixes: actual generated
   loaders; full options compared with the previous factory, including exact JSON
   serialization for HUMAN01/02 and ALIEN01/02. The only permitted differences
   for rescue missions are the appended commander mappings.
2. All 30 original SCN/TRO role census: every original script's required abduct
   team resolves; exactly the three rows above append mappings. This is an
   options-level census, not an all-mission loader or playthrough claim.
3. Controlled role guards: ordinary TRSC/GRAY lookalikes, zero counts, missing
   definitions, wrong race, missing counterpart, multiple types, malformed
   payloads, preserved-prefix conflicts, and duplicate live actors reject.
   Initial placements, source counterpart conversion, both reinforcement forms,
   and queued ownership exclusions are covered.
4. Controlled predicates HUMAN04 original commander spawn/extraction/WIN chain.
5. Controlled predicates ALIEN04 commander chain, with type 94 excluded and the
   full original block separately rejected with exact rollback.
6. Controlled predicates ALIEN05 original commander spawn/extraction/WIN chain.

These are **controlled predicate tests, not playthroughs**. They preserve source
placements, source command arguments, trigger flags and ordering. HUMAN04 trip
blocks 6/7 become normal predicates `c==6`/`c==7`; its base-destruction WIN
predicate becomes `c>20`. ALIEN04 prerequisites 9/10 become `c==6`/`c==7`,
retaining the authored extraction timer. ALIEN05 trips 17/18 become normal
predicates `c==6`/`c==7`, retaining its authored WIN timer. Production receives
the existing source census visits; no purchases, combat losses, statistics,
placements, or commander identities are fabricated.

| Controlled mission | Spawn identity | Extraction tick | Carrier ID | Result by tick 360 |
| --- | --- | --- | --- | --- |
| HUMAN04 | slot 186/generation 0 | 112 | 2 | noncombat pickup, WIN pending |
| ALIEN04, commander-only chain | slot 259/generation 0 | 176 | 5 | noncombat pickup, WIN pending |
| ALIEN05 | slot 204/generation 0 | 112 | 3 | noncombat pickup, WIN pending |

Assertions cover source create requests, exact slot/generation/registry identity,
carrier team/type/commander slot, downstream WIN lives or immediate WIN,
noncombat removal with status 10, cleared collision and unchanged health/loss
count. Explicit abduct retains registry identity; casualty auto-pickup has a
different unregister lifecycle. Old mappings fail at the extraction transaction.
Each new session restores exactly at extraction, continues to tick 360 with
whole-checkpoint equality, and independently restores the final checkpoint.

Exact commands, from the repository root:

```sh
node --import tsx --test tools/qa/source-browser-commanders.test.ts
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2023,DOM src/engine/source-browser-campaign-options.ts tools/qa/source-browser-commanders.test.ts
```

The recorded execution used the equivalent absolute tsx loader path inside a
signal-isolated child. Test log: `/tmp/dc-rescue-chains-20260922-10.log`.

## Remaining Limits

Unresolved commander-mapping ambiguity missions: **none among the 30 authored
SCN/TRO inputs and their required abduct teams**. This does not prove temporal
uniqueness of every live actor or assign ownership to future teamless queue
contents; the existing runtime ambiguity checks remain necessary.

**ALIEN04 full original block 10 remains blocked** by its second action,
`reinforce2 0 6 6 94 1 ...`. Source type 94 is DOTT / Vision sight, movement
class 7. The current session transport definitions admit only classes 0/1, so
the full block fails `Missing source definition for type 94` at controlled tick
112 and rolls back exactly. The commander-only test omits that one action,
retains every other original action, and does not claim full rescue completion.
Resolving type-94 ownership requires a separately scoped runtime change.

No browser, full suite, natural rescue playthrough, native parity, ready-WIN
deadline, or historical late-M02 checkpoint replay is claimed here. M01/M02
compatibility is demonstrated by unchanged complete serialized source options;
their passed save artifacts were not modified.