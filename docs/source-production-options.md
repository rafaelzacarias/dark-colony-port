# Source Production Options

2026-09-19. Isolated implementation in
[source-production-options.ts](../src/engine/source-production-options.ts), with
[focused tests](../tools/qa/source-production-options.test.ts) and
[original x86 startup probe](../tools/qa/source-production-startup-native.py).
No main, view, session, shared production, generated asset or scenario edits.
This supplies production options; it does not admit a mission or enable its AI.

## Supported Boot

`loadSourceProductionOptions` accepts `sessionId`, the existing mission's
`faction`, `scenario` and `units`, original SCN bytes as `rawScenario`, and an
explicit configuration:

```ts
const configuration = {
  profile: "user-selected-source-campaign-fresh",
  mode: 0,
  localTeam: 0,
  race: 0,
} as const;
```

Race is 0 for human or 1 for alien and must match the mission/player SCN.
This is explicitly selected configuration state, **not a recovered installed
configuration file**. No such file was supplied or assumed. Native constructor
`0x429952..0x429984` initializes mode/race to zero, but the configuration loader
`0x429f28` can overwrite them. The probe executes that loader's header path with
the selected eight-word header, signature `0x21340002`, and substituted stream
I/O; it stops before loading configuration paths and remaining unrelated fields.
Every corpus SCN team probe consumes this loaded mode, not a guessed allocator
zero. Full native launcher/configuration replay is not claimed.

The SCN bytes must hash to the mission's source digest. All exposed mission
fields must match the full parse. `%Depend` is taken from those original bytes,
not inferred from the narrower mission interface. The loader also validates
the actual generated DEPEND, GAMESTAT and producer FIN JSON bytes by pinned
SHA-256 before decoding them. `loadBytes(url)` can override fetch for tests or
an application's existing asset loader; URLs are under `/assets/generated/`.
No raw-CD web endpoint is assumed: the caller supplies the original SCN bytes.

The returned `source` retains full dependencies and AI slots. `production` is
structurally suitable for `CampaignSessionOptions.production`; `state` is an
initial standalone production snapshot. `choices` includes source dependency,
interface ID, troop type, cost, credits, native eligibility, pending/queued
counts, dispatch/refund flags and owned producer native slot. `missionAdmission`
is always `"not-evaluated"`. Use the existing mission admission separately.

| Unchanged Source | Player Factory | Player Census at First Refresh | Cap | Initial Offer |
| --- | --- | --- | --- | --- |
| HUMAN01 | none | 1 | 150 | none; team 1's colony is not player-owned |
| ALIEN01 | none | 1 | 150 | none |
| HUMAN02 | team 0, base (56,55), native slot 1 | 1 | 150 | TRSC, DEPEND 9, cost 350; credits 0 |
| ALIEN02 | team 0, base (13,69), native slot 1 | 8 | 150 | GRAY, DEPEND 23, cost 350; credits 0 |

Both second missions have two source RENAT records. Neither first mission is
replaced with a training scenario. Mission-2 AI remains blocked independently.
No-factory results have `production`/`state` undefined and empty `choices`.
Second-mission choices are visible but unaffordable at boot; no credits are
invented. Other troop banks, construction, upgrades and queues 1..3 remain
outside production admission, even though all DEPEND IDs/selectors are retained.

## Proven Initialization

The executable is pinned to SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
All **108 original SCNs / 864 teams** execute `0x41bd90..0x41c2b0`, using actual
GAMESTAT records and native integer/CRT scanners. SCN line I/O and alliance
updates are substituted; the production-field writers are not. Team memory
starts poisoned with `0xa5`, and type records reset between scenarios.

- Credits and race come from SCN; cost accumulator `T+0x18` becomes zero.
- City health, levels, five busy bytes and all 106 type upgrade pairs agree
  with the existing colony/upgrade helpers for every team.
- Restrictions clear at `0x41be7d`, then `%Depend` sets its IDs. If either base
  coordinate is zero, the loader additionally restricts IDs **0 and 14**.
- `0x41c289` writes all four queue counts and delays to zero and all four
  ready bytes to **one**, not zero. No fresh work is pending.
- The game constructor `0x40c058..0x40c079` explicitly writes all 800 registry
  words to `0xffff`; the mission population probe also verifies this from poison.

The actual native FIN decoder and bank resolver establish unit `+0x98`:
TRSC uses HUBU.FIN/TRSCBUILD0, timelines 26..47; GRAY uses
ALBU.FIN/GRAYBUILDSTAND0, timelines 303..334. All 32 bank directions resolve to
the same respective timeline. `producerProfiles` decodes generated `field2`
through the existing `finSourceDuration`, validates exact native bytes and
source hashes, and rejects altered banks. Tests also compare generated states
and all duration words to `parseFin` on the original FIN files.

GAMESTAT tokens 21/23 select queue/exit. Tests compare all troop selectors and
signed offsets against `0x41add0 + queue*24 + selector*8`, including sparse
DEPEND IDs 83/84. Base troops use queue 0, selector 0, offset (0,-3).

## Live Census And Cap

`sourceProductionPopulation(world, team)` reproduces the selector-6 rebuild in
`0x4196f4..0x4197b4`: scan slots **152..799**, include entries whose native
registry word is not -1 and whose owner is the requested team 0..7. The host
adapter uses matching registry keys as that registration identity. Buildings,
reserved low slots and neutral owners do not count. Neither health, status,
unit type/faction nor high-water determines eligibility. Registered dying or
status-zero entries still count until unregistered. `0x41a538(EAX=6, EDX=team)`
reads the cached result at `0x4956e0 + team*48 + 24`.

`game+4` is explicitly initialized to **150** by `0x41ba36`; it is a ceiling,
not the actual cap. `0x41e6ac` computes `game+0x528`:

1. Start with 648 dynamic slots, subtract declared RENAT reserve and 100.
2. Subtract status-nonzero dynamic entries owned by teams 0..8 without any
   nonzero City health in slots 0..4. This test does **not** use the registry.
   Owner 9 is handled through RENAT reserve, not subtracted again here.
3. Divide, truncating toward zero, by the number of teams with such buildings
   if nonzero; clamp to current `game+4`.

RENAT reserve is the sum of record `+16` over the active source records;
`0x43fe6c` is executed without interception. Negative caps are outside the
session API and fail closed. The ceiling can later change in the native
performance path (`0x419649` onward); this module does not invent its inputs or
silently persist the boot ceiling as a native permanent setting.

After session creation use **the session's current production state**, not the
loader's initial `state`:

```ts
const choices = sourceProductionUi(snapshot.production, configuration.localTeam);
const productionVisits = sourceProductionVisits(
  snapshot.world, snapshot.production, currentNativePopulationCeiling,
);
```

At fresh boot the verified ceiling is `initialPopulationCeiling` (150).
The visits are sorted in native team order and supply queue 0, exact census and
computed cap. Capture once at the equivalent census/producer phase boundary;
native census is cached, not re-enumerated between each spawn. Existing session
transactions own credits, reservations, clocks and allocation. Its post-income
state supplies current UI credits. This helper does not independently debit,
spawn, advance clocks, bypass ownership checks, or claim full native global
dispatcher timing. Restore ongoing production through the existing session
checkpoint, not this fresh-boot factory.

## Verification

12 focused tests passed, including a fresh original-x86 probe invocation,
all 864 team fields, all FIN directions, source-selected configuration header,
exact census edge cases, cap edge cases and unchanged first/second mission
placement streams. The latter combine executed source placement and verified
City output before executing native census/cap; they are not an uninterrupted
launcher/mission playthrough. The probe asserts census equals the complete
registered dynamic-slot set, preventing zero-filled unused registry entries
from masquerading as units.

```sh
node --import tsx --test tools/qa/source-production-options.test.ts
npm run typecheck
```

`DC_SOURCE_PRODUCTION_TRACE` optionally supplies matching full-corpus native
JSON; otherwise tests execute the probe. `--focused` is a manual four-mission
probe mode, not sufficient for the test's 864-team gate. Existing Capstone and
Unicorn installations under `/tmp` are reused. No agents, browser or full suite
were used. Fresh focused test log: `/tmp/dc-production-final-29.log`.