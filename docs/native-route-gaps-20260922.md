# Registered Route Gap Integration

## Result

The production [registered host](../src/engine/native-registered-host.ts) now
integrates the existing branded pending-move helper and an explicitly enabled
source randomized-endpoint owner. Both actual original source worlds complete
every registered boundary **1..32**, with no excluded actors or phases:

| Source | Independently complete consecutive native boundaries | Exact registered visits |
| --- | ---: | ---: |
| HUMAN02 | 32 | 1,039 |
| ALIEN02 | 32 | 1,592 |

These are **2,631 exact visits in 64 independently complete registered phases**,
not 32 contiguous TypeScript world cycles. The tests seed each phase from the
original native boundary. TRO, construction/allocation, intervening world
services, and the shared whole-cycle scheduler are not implemented by this
change. There is no runtime event-RNG captured rebase or expected-output replay.
The separately integrated native AI-policy suffix is unchanged. `admitted` and
`executableWholeGame` remain false.

The first post-32 HUMAN rejection is phase **33**, slot **170/type 25**, entry
task 8, reaching **unowned task 7**, after 22 exact uncommitted prefix visits.
The whole transaction remains unchanged on repeated failure. No task-7 or
unproved factory profile was added. ALIEN independently matches boundaries
33..40 as well: another 416 visits, **2,008 through 40**. The existing capture
ends at 40; no later ALIEN claim is made.

## Runtime Contract

Keep the existing source ground-route/task9 configuration, real RNAT and troop
MOVE FIN relocations, authenticated WEAPSTAT, and complete current route scratch.
Enable both options on `createNativeRegisteredConfiguration`:

```ts
groundRoute: {
  source,
  taskNine,
  rnatMoveBank,
  troopMoveBanks,
  weaponStat,
  occupiedPath: true,
  randomizedEndpoint: true,
}
```

`randomizedEndpoint` requires `occupiedPath`. Omitting the new option retains
the HUMAN phase-16/29 endpoint gates. The source factory privately extracts the
256 signed RNG words at `0x478e04` from the authenticated executable; no native
trace, precomputed candidates, path, or actor transitions are configuration data.
Current native boundary provenance remains the caller's responsibility.

The pending path uses the exact existing
[pending helper](../src/engine/legacy-native-pending-move.ts), resolving its
state-bound typed command before the ordinary task-6 increment. ALIEN phase 25
slot 194 consumes pending `[1,7]`, passes through task 8, and reaches task 5 with
budget `0 -> 2`, RNG `105 -> 105`, heading 0, and +30 Q8 X. All 52 phase visits
match; later actors continue the shared RNG to 107. The obsolete test-only
transpiled host insertion was removed rather than retaining a second integration.

The endpoint owner in
[ground routing](../src/engine/legacy-native-ground-route.ts) accepts
`LegacyNativeRandomizedEndpointRequest` at boundary `0x4155d5`, with exact slot,
raw address/record, current ground plane, and shared RNG cursor. It is requested
only after the host's original occupied-route scan exhausts its path without a
free endpoint, for an already source-profiled ground actor.

Original behavior is preserved:

- Pop task 6 through the semantics of `0x411f74`, retaining its route mode.
- Pre-increment and wrap the shared cursor for each of two signed `% 3` draws.
  Add `(draw % 3 - 1) * 256` to the Q8 endpoint words, preserving word overflow.
- Apply the original `> 0xf000` high-byte correction and map-Q8 upper correction.
  If the candidate is the current cell, retain the popped task without rebuilding.
- Otherwise call the existing source family-zero radius scan, backward
  circular-bucket search, predecessor distance, and nibble serialization.
  Replace task 6 while preserving its unused eighth payload word.
- Redispatch on the same staged candidate and budget. Repeated occupied results
  consume subsequent source RNG draws; they do not select an arbitrary free cell.

HUMAN16 slot173 retries three times, `67 -> 69 -> 71 -> 73`; HUMAN29 slot157
uses `113 -> 115`, and slot160 uses `115 -> 117 -> 119`. The first HUMAN16
candidate needs the original family-zero radius correction. No RNG reset,
floating-point routing, fake free cell, terrain substitution, or speed change
was introduced. RNAT movement still uses its authenticated GAMESTAT speed 30
and turn step 25, not an inferred troop profile.

## Proof Method

[The native observer](../tools/qa/legacy-native-ground-route-native.py) adds
`--endpoint` observation only: actual `0x4155d5`, post-draw `0x4156b7`, and
original `0x414ce4` entry/return. The original executable bodies execute
continuously through HUMAN32 with **zero runtime core interceptions**; inherited
platform/startup substitutions are unchanged. Disassembly establishes signed
draw arithmetic and caller control flow. No restored partial-machine snapshot
is used for the six natural retries.

[Direct endpoint tests](../tools/qa/legacy-native-ground-route-endpoint.test.ts)
compare all six candidates, every resulting raw220 byte, the shared cursor,
entire `0x990ac` route memory pool, stamp/family/neighbor globals, and **2,951
ordered search/serializer/path writes**. Invalid source identity, slot/address,
RNG, task/pending, ground length, and dynamic/air callers reject without mutation.

[Registered tests](../tools/qa/legacy-native-ground-route-occupied.test.ts)
compare visit count/order, all raw before/after bytes, task, RNG, per-index budget,
registry high water, and every changed game/dependency byte for each visit.
Every complete phase compares all game bytes, three occupancy planes,
dependencies, RNG/CRT, production flag, carrier FIN, and the full route memory
pool/globals. A FIN error after HUMAN slot173 proves that its already-computed
route and RNG73 are rolled back, with identical repeated rejection.
These comparisons do not certify unrelated native heaps or whole-world state.

The original coarse-route, occupied-route, task9, pending-helper, and registered
host contracts remain covered. With task9 but no occupied-path opt-in, ALIEN now
has 31 complete phases/1,540 visits and rejects at32 slot196; HUMAN retains its
prior phase16 occupied gate. Neither constructor admission nor scheduler scope
has been broadened.

## Reproduction

New environment variable: **`DC_ENDPOINT_TRACE`**, requiring the endpoint-enabled
HUMAN **32** capture. Without it the focused endpoint test regenerates that
capture using the existing Python/Unicorn prerequisites. Existing ground,
occupied, and registered trace variables retain their meaning.

```sh
DC_ENDPOINT_TRACE=/tmp/dc-two-route-endpoint-human32-20260922-r06.json \
DC_GROUND_HUMAN_TRACE=/tmp/dc-ground-HUMAN-40-p34.json \
DC_GROUND_ALIEN_TRACE=/tmp/dc-ground-ALIEN-40-p34.json \
DC_OCCUPIED_TRACE=/tmp/dc-occupied-human16-o01.json \
node --import tsx --test tools/qa/legacy-native-ground-route-endpoint.test.ts \
  tools/qa/legacy-native-ground-route-occupied.test.ts \
  tools/qa/legacy-native-pending-move.test.ts
```

New native capture SHA-256:
`0df47163782dfc8e053b44345a4abb3126e0d98008dd121714f24dfb46135fd0`.
Reused HUMAN40 SHA-256:
`a6ce670497885d6e3d8c861e0f62cc6f22892b87d30d2e5bd1795c4f71ba0717`.
Reused ALIEN40 SHA-256:
`38ff5df9524b275e3b252c92433731c6aac567aa73c3e682e41c4148d2790e59`.

Final verification at **2026-09-22 02:03 PDT**: **31 focused tests passed**, no
failures/skips, in `/tmp/dc-two-route-final-tests-20260922-r12.log`. Scoped strict
ES2022 / ES2023,DOM no-unused typechecking passed in
`/tmp/dc-two-route-final-types-20260922-r13.log`; editor diagnostics were clean.
All 30 local links across the six updated documents resolve. The first isolated
ALIEN25 check preceded all endpoint edits; primitive endpoint validation preceded
host integration. Work began at 01:50 PDT and stayed within the one-hour limit.

No agents, browser, full suite, packages, or assets were used or changed. The
workspace has no Git metadata, so the requested small integration steps were
edited and checked separately but could not be recorded as a Git commit.