# Scenario City Layout

Verified 2026-09-19 against the original executable and all 108 unchanged SCNs.
The HUMAN02 colony rejection was a width restriction in the runtime, not an
invalid source scenario. A six-pair source line does **not** configure six
buildings: the native loader consumes five pairs and ignores the remaining pair.

## Native Field Contract

The [probe](../tools/research/scenario-city-layout.py) executes
`0x41c0cd..0x41c289`, including the actual integer scanner `0x406780` and
CRT `sscanf` at `0x440db2`. Only the line reader `0x41b8ac` is supplied by the
harness. It serves the unchanged source lines in order. No integer conversions,
scanner destinations, row increments or level writes are stubbed.

| Instructions | Meaning |
| --- | --- |
| `0x41c0d0..0x41c0db` | Read one City line into a 0x400-byte buffer. |
| `0x41c1ca..0x41c1df` | Read one level, then one HP integer from that buffer. |
| `0x41c1c4..0x41c1c8` | Increment slot; stop at five, after exactly ten integers. |
| `0x41c0f0..0x41c13e` | Positive level enables the slot; write HP and level minus one, otherwise zero both. Base x zero also clears both. |
| `0x41c176..0x41c1c4` | Independently set slot 5 level to zero and HP to one if both base coordinates are nonzero, otherwise HP zero (mode 0). |
| `0x41c211..0x41c224` | Read eight new lines, one per unit row. Unused City suffix never becomes a unit row. |
| `0x41c229..0x41c249` | Five `%d` fields target frame offsets `-0x78,-0x74,-0x70,-0x6c,-0x64`. |
| `0x41c24e..0x41c287` | Use race/row type mapping; write columns 2/3 to weapon/armor bytes for the current team. |

For each unit line the probe checks all destination pointers, the input-buffer
pointer, the return count of five conversions, all five resulting signed
integers, and the complete 106-type by 16-team-level-byte table. It observes
exactly nine line-reader calls per team. The two unused fields of HUMAN02's
City rows remain `0 -1` in the buffer after the tenth conversion.

## Slot Mapping

`L` below is the source level; the native upgrade index is `L - 1` for an
enabled slot. These types are independent of the unused sixth pair:

| Slot | Race 0, L=1 / L=2 | Race 1, L=1 / L=2 |
| --- | --- | --- |
| 0 | 16 / 16 | 28 / 28 |
| 1 | 17 / 17 | 29 / 29 |
| 2 | 18 / 19 | 30 / 31 |
| 3 | 20 / 21 | 32 / 33 |
| 4 | 22 / 22 | 34 / 34 |
| 5 | 81 / not source-selected | 81 / not source-selected |

HP -1 for slots 0..4 resolves through the **race-0** type table, even for an
alien team; the constructor selects the actual entity type using the team's
race. Explicit HP is retained. Source level zero clears HP and upgrade level;
HP zero creates no entity even for a positive source level. Slots 0..4 use
base x as their presence gate; TOWR (slot 5) requires both x and y nonzero.
The TOWR source level remains `null`, upgrade level 0, HP 1, with no footprint
or `buildingSlots[team,5]` entry. Reserved IDs remain `team * 15 + slot`.

The native type, position and footprint table checks and constructor comparison
remain in [legacy-colony.test.ts](../tools/qa/legacy-colony.test.ts), now also
covering all HUMAN02 teams and distinct sixth-pair values. Constructor execution
retains that harness's existing bounded scope; this is not a full game boot.

## Corpus And Goldens

| Terrain bank | Source SCNs |
| --- | ---: |
| DESERT | 45 |
| JUNGLE | 42 |
| HTRAIN | 15 |
| ATLANTIS | 6 |

Across 864 team blocks: 776 City lines contain ten integers and 88 contain
twelve. All 6,912 following unit lines contain five integers. The
[goldens](../tools/qa/scenario-city-layout.test.ts) compare every field from
[parseScenario](../tools/extractors/data/scenario.ts) to its original source
line and the executed native scan; all 106 type-level results per team and
all six colony HP/upgrade slots agree with the native report. Source objects
are unchanged. The parser already preserves the nine-line structure and needs
no production edit. No bank-specific exception or rewritten City row is used.

Synthetic native fixtures distinguish all eight unit rows and both races,
exercise levels 0/1/2, default/explicit/zero HP, and use sixth-pair values
`2147483647 -2147483648`. Neither value affects any slot or unit level.
The native loader fixture uses mode 0, zero-initialized type-level bytes and
synthetic type HP `10000 + typeIndex`; source row parsing and original machine
instructions are real. Flat 32-bit segment descriptors are initialized so the
CRT's segment-register instructions retain correct stack addressing in Unicorn.
This does not certify disabled-team policy in other modes or later upgrades.

Pinned SHA-256 values:

- DC.EXE: `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
- HUMAN02.SCN: `bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab`.
- Sorted corpus manifest: `b9bad691618169a72b3f43a75cb77be8776b95881d1addcfcbf7b97b9fe86c88`.

The manifest digest hashes compact `JSON.stringify` of sorted
`{ path, sha256 }` records, with workspace-relative source paths. Each native
report records and tests every individual source hash and the executable hash.

## Runtime Validation

[legacy-colony.ts](../src/engine/legacy-colony.ts) now calls the shared City
validator in [legacy-scenario-levels.ts](../src/engine/legacy-scenario-levels.ts).
Supported source widths are exactly ten or twelve signed32 integers. The first
five levels must be 0..2 and HP must be -1..2147483647. The optional sixth pair
is validated as signed32 data but has no level/HP semantics. Unsupported widths,
fractions, nonfinite values, overflow and invalid consumed fields fail closed.
These are explicit supported-runtime constraints, not a claim that native
scanners reject every malformed or longer input the same way.

The new `sourceScenarioUpgradeLevels` helper requires exactly nine rows,
exactly five signed32 integers per unit row, weapon/armor 0..2, team 0..7,
race 0..1 and type 0..105. It validates every unit row even for a type that
would use initialized zero levels. The immutable result preserves the existing
public shape and origin values. Race mappings remain:

```text
race 0: 0, 2, 3, 6, 43, 5, 1, 4
race 1: 8, 10, 11, 14, 44, 13, 9, 12
```

## Required Owner Integration

**Not applied here:** [legacy-balance.ts](../src/engine/legacy-balance.ts) belongs
to the concurrent combat owner. Its existing public function still rejects
twelve-field City rows until the orchestrator delegates to the new helper.
Keep the existing exported interfaces and function signature, add this import,
and replace only that function's body:

```ts
import { sourceScenarioUpgradeLevels as readScenarioUpgradeLevels } from "./legacy-scenario-levels";

export function sourceScenarioUpgradeLevels(
  team: SourceScenarioUpgradeTeam,
  sourceTypeIndex: number,
): SourceScenarioUpgradeLevels {
  return readScenarioUpgradeLevels(team, sourceTypeIndex);
}
```

Remove the old `SCENARIO_UPGRADE_TYPES` constant once unused. No changes to
combat type-level helpers, Inspire, damage/defense factories or mission callers
are required for this handoff. The new helper imports no combat module.

## Session Result And Limits

The unchanged HUMAN02 source now initializes through `initializeCampaignSession`
in the existing placement fixture: 18 placed entities, two RENAT source records,
and high-water 170. HUMAN01, ALIEN01 and ALIEN02 retain their pinned placement
bytes and high-water values. The stale HUMAN02 rejection assertion in
[scenario-placement.test.ts](../tools/qa/scenario-placement.test.ts) now checks
successful initialization with the same native byte golden as the other cases.

That fixture intentionally supplies an empty trigger program; successful
initialization is **not** complete mission playability or trigger/controller
admission. Live combat registration through the old balance wrapper still needs
the handoff above. Historical colony-rejection statements in
[scenario-placement-runtime.md](scenario-placement-runtime.md) and the
ten-integer restriction in [live-native-combat-20260919.md](live-native-combat-20260919.md)
are superseded for the owned modules by this evidence. Resource lifecycle and
other boundaries in [resource-host-integration.md](resource-host-integration.md)
are not widened.

## Reproduction

Requires local `tsx`, TypeScript, Capstone and Unicorn dependencies. From the
workspace root (use a new report path per run in a concurrent workspace):

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/scenario-city-layout.py > /tmp/scenario-city-native.json
DC_SCENARIO_CITY_NATIVE_TRACE=/tmp/scenario-city-native.json \
  node --import tsx --test --test-concurrency=1 \
  tools/qa/scenario-city-layout.test.ts tools/qa/legacy-colony.test.ts \
  tools/qa/scenario-placement.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 \
  --module ESNext --moduleResolution bundler --allowImportingTsExtensions \
  --skipLibCheck --types node src/engine/legacy-colony.ts \
  src/engine/legacy-scenario-levels.ts tools/qa/scenario-city-layout.test.ts \
  tools/qa/legacy-colony.test.ts tools/qa/scenario-placement.test.ts
```

Without the report environment variable the City test invokes the native probe
itself. Verified: 18 focused tests, the full 108-source native City/unit parser
probe, and strict checking of the touched TypeScript slice. No agents, browser,
full suite, raw-source edits or generated-asset changes were used.