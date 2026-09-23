# HUMAN06 Generated Trip Fix

## Result

The unchanged [mission06 driver](../tools/qa/mission06-playthrough.ts) reproduced
`Unknown trip trigger 7` at tick 295 before the fix. The post-fix original-script
browser-adapted run reached pending WIN at 1546 and ready WIN at 1747. Restoring
the pending checkpoint and advancing 201 ticks produced the complete ready
checkpoint exactly, with identical source identities.

- Acceptance directory: `/tmp/dc-h06-trip-acceptance-1790151891256/human/`.
- Stepping: 33025 ms; separate restore/proof: 21236 ms. Limits remain 600/900 s.
- Ready checkpoint SHA-256: `c88b95ad4b18545b3c199b875b2bc55f9885ec19293adee4505beb039e27d44a`.
- Source identity SHA-256: `8abf1409c723168f9a02971ff61330c234ffac95f4f90574f4df58e6ac5f5f96`.
- 290 public commands, 358 shots, 30 deaths; no purchases or injected outcomes.
- Supervisor exit 0, no signal or expired deadline; runtime and fetched asset
  integrity differences both empty. Worker 99504 was reaped.

This is the real loader and public MissionView command/update path under the
existing NullCanvas harness, not browser pixels or whole-native-game parity.
Neither scripts nor assets nor the planner were edited.

## Original Semantics

[The dedicated native probe](../tools/qa/mission06-trips-native.py) reuses the
existing hash-pinned executable and file-service harness. It compiles every byte
of unchanged HUMAN06.TRO through original loader `0x43fb90`, starting with
poisoned trigger storage. Every absent record receives zero condition pointer
and zero lives. It then executes original trip dispatch `0x43e530`.

Original HUMAN06.MTG tags are 1,4,5,6,7,9,10,11,12,13,14. IDs 7,9,10 have no TRO
record. Native dispatch checks lives at `0x43e53c` and mode at `0x43e545` before
calling the condition VM. All three absent tags return without evaluating a
condition or action and without changing trigger records, game or statistics.
Source normal blocks 2 and 3 also return; enabled trip 1 reaches the condition
VM. The positive native probe stops at condition entry, not after WIN actions.

- EXE: `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
- TRO: `c46c6c2bf51fdd81babbce09bd8fcc69c052fcfbd4d0c9d9d6e9ccc8a1577402`.
- MTG: `c467372a526b1eac53acf46983082c7e74151f10399ba32694074d286a42f5a4`.
- Native receipt: `/tmp/dc-h06-trip-native-proof-1790152015664.log`, exit 0.

Reproduce the probe with Python Capstone/Unicorn available, then run
`python3 -B tools/qa/mission06-trips-native.py`. This run installed dependencies
only in `/tmp/dc-h06-native-20260923`, not in the project.

## Runtime Boundary

[mission-controller.ts](../src/engine/mission-controller.ts) owns the enabled
trip predicate. The single necessary integration is in
[campaign-session.ts](../src/engine/campaign-session.ts): only explicit
`browser-adapted` sessions skip internally derived reservation tags with no
enabled matching source trip. Actor/generation/status, destination and MTG
validation still precede this decision. Eligibility uses current lives at
dispatch, so a prior event's rearming is retained.

The default strict session still rejects an unknown trip atomically. The
standalone VM and explicit controller trip API still reject unknown IDs,
including with adapted controller options. No blanket validation bypass was
introduced. No production module, main entry point or campaign-world behavior
was changed.

## Separate A06 Investigation

Original census `0x4196f4..0x4197b4` clears aggregate selector 6 and per-type
selector 1, then counts registered slots 152..799 with team below 8. There is
no class, movement, HP or alive-status filter. Neutral teams 8+ and fixed city
slots below 152 do not contribute. Registered status-10 actors still count until
unregistration. This agrees with the existing `sourceProductionPopulation`.

The saved A06 tick-10247 world has 24 registered team-0 actors and per-type
selector-1 sum 24, but aggregate `statistics["0,6"]` remains zero:

| Type | Count |
| --- | ---: |
| 8 | 7 |
| 13 | 2 |
| 14 | 1 |
| 42 | 7 |
| 89 | 1 |
| 94 | 6 |

Fourteen are living; ten are health-zero/status-10 but still registered. Twelve
registered team-8 actors are excluded. The problem is not a missing alive or
class filter: `CampaignSession.refreshFeedback` rebuilds per-type selector 1
but omits aggregate selector 6. Original A06 block 14 requires `(s(0,6)>19)`.

Evidence: `/tmp/dc-a06-selector6-audit-1790152181474.json`; original census
disassembly: `/tmp/dc-h06-trip-native-1790151871682.log`. The checkpoint input is
`/tmp/dc-m06-alien-recovered-1790150624811/alien/checkpoint.json`.

This separate feedback defect was investigated but not modified. A correction
must refresh the aggregate with the registered census at the same lifecycle
boundaries, retain neutral/city exclusions and casualty registration semantics,
and prove A06 independently. H06 acceptance does not certify A06.

## Checks

- [Dedicated regressions](../tools/qa/mission06-trips.test.ts): 4 passed, none
  skipped; `/tmp/dc-h06-trip-final-controls-1790152116737.log`.
- Controller, trigger VM and existing mission06 tests: 49 passed, 0 failed;
  `/tmp/dc-h06-trip-neighbors-1790152151222.log`. H06 actual artifact check passed;
  only the unproven A06 artifact test skipped.
- Scoped strict TypeScript: exit 0;
  `/tmp/dc-h06-trip-types-1790152178269.log`. Editor diagnostics clean.
- One intermediate test reached tick 300 but correctly reported concurrent edits
  to production-owned files as `RUNTIME_CHANGED`; it is not acceptance evidence.
  The subsequent full WIN run had no integrity differences.

No agents or full suite were launched. Tests and the native probe used unique
logs and bounded isolated processes. The interrupted first acceptance launch
left no worker; the successful supervisor reaped its worker normally.