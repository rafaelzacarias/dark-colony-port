# Original campaign adapted census

Module follow-up: [adapted TRO semantics and exact main handoff](adapted-tro-semantics-20260922.md)
admits all 13 previously rejected scripts under an explicit adapted profile.
Its separate original-session opening census reveals six further type-37
placement gates. The view results and JSON below remain the original historical
measurement, not a claim that main/UI integration has been completed.

## Scope

[Executable census](../tools/qa/campaign-adapted-census.test.ts) and
[complete JSON evidence](campaign-adapted-census-20260922.json).

All 15 HUMAN and 15 ALIEN missions are inventoried from the actual manifests.
Mission 01 uses the strict default; 02..15 use `browser-adapted` and the existing
`source-objectives-v1` strategy. Each admitted mission goes through the real
`loadCampaignMission`, real `new MissionView`, `initialize()`, `update(0)`, and
200 natural 50ms updates. No commands, credits, statistics, selectors, actors,
trigger filters, or shortened trigger conditions are injected. Loader failures
are recorded and the loop continues; they are never bypassed.

Rendering uses the existing source-render fixture and a WebGL stub. PNG headers,
FIN JSON, sprite atlases, indexed planes, palettes, maps, and game tables are real
files. This proves asset access and initialization, not GPU output, native parity,
or campaign victory. No browser, full suite, agents, runtime/package/asset edits.

## Counts

| Side | Original missions | Loader | Initialized | Natural 32 | Natural 200 | Compatibility 32/200 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| HUMAN | 15 | 4 | 4 | 4 | 4 | 4 / 4 |
| ALIEN | 15 | 3 | 3 | 3 | 3 | 2 / 2 |
| Total | 30 | 7 | 7 | 7 | 7 | 6 / 6 |

Compatibility is still bounded to this interval, not a full-game admission.
ALIEN02 advances successfully but contains armed static actors without weapon
execution in the generic view. A green census test means complete coverage,
source integrity, and preserved strict 01 behavior; it does not mean 30 passes.

| Mission | HUMAN first result | ALIEN first result |
| --- | --- | --- |
| 01 | Strict initialized, 32/200 | Strict initialized, 32/200 |
| 02 | Adapted initialized, 32/200 | Adapted initialized, 32/200; static weapon incompatibility |
| 03 | Loader: unproved SCN resource mapping | Loader: unproved SCN resource mapping |
| 04 | Loader: TRO 0 reinforce shape | Loader: unproved SCN resource mapping |
| 05 | Loader: TRO 20 reinforce shape; TRO 1 ally | Loader: TRO 4 vision |
| 06 | Loader: TRO 2 vision; TRO 11..14 ally | Loader: placement 51 type 37 |
| 07 | Loader: placement 38 type 37 | Loader: TRO 11 dfiddle; TRO 12 ally |
| 08 | Loader: placement 45 type 37 | Loader: TRO 9 exomoney; TRO 13 reinforce2; TRO 14 ally; TRO 25 nopickup |
| 09 | Loader: TRO 1 operand == | Loader: TRO 2/3/4 operand t |
| 10 | Loader: unproved SCN resource mapping | Loader: TRO 13 vision |
| 11 | Adapted initialized, 32/200 | Loader: placement 20 type 37 |
| 12 | Loader: operand t; vision; reinforce2 | Loader: TRO 5 reinforce shape |
| 13 | Loader: placement 32 type 37 | Loader: placement 46 type 37 |
| 14 | Adapted initialized, 32/200 | Adapted initialized, 32/200 |
| 15 | Loader: TRO 20 aimsg | Loader: TRO 5 aimsg |

The JSON preserves full first-error messages, action indexes, offending original
blocks, actor identities/types, startup selectors, source money, requests/deaths,
asset requests, warnings, and per-mission timings. No constructor or initialization
error was observed after the seven successful loads.

## Severity 1: Execution Blockers

- **13 TRO rejections:** H04/05/06/09/12/15 and A05/07/08/09/10/12/15.
  [decodeMissionWorldAction](../src/engine/mission-controller.ts#L156) rejects
  non-11/13 reinforce payloads, non-byte exomoney, and unsupported world opcodes.
  [parseCondition](../src/engine/trigger-runtime.ts#L147) rejects `==` and `t`.
  Independent candidates: reinforce serialization, exomoney value domain,
  condition operands, then separate ally/vision/dfiddle/nopickup/aimsg owners.
  Preserve every action and add fixtures from the JSON's exact block/action index;
  accepting an opcode without implementing its effects is not a fix.
- **6 type-37 placement rejections:** H07/08/13 and A06/11/13.
  [initializeCampaignPlacements](../src/engine/campaign-world.ts#L203) requires
  the native coordinate queue/selector-6 state. Candidate: an explicit adapted
  type-37 owner with serializable state, separate from native admission.
  Do not delete POOP placements. RENAT rows are independently inventoried with
  their original row index; no RENAT first-error was observed in this run.
- **4 resource source rejections:** H03/H10/A03/A04.
  [loadSourceResourceOptions](../src/engine/source-resource-options.ts#L147)
  gates source SCN hashes before adapted preparation. Candidate: generic
  source-derived adapted resource initialization, retaining strict/native proof
  guards. Test these four original inputs without editing their source money.

## Severity 2: Behavioral Incompatibility

- **ALIEN02 type 41 (two source actors):**
  [MissionView.#registerEntity](../src/mission-view.ts#L1285) projects stationary
  armed units through `addStaticTarget` without a weapon/attack owner. Generic
  defense data is not weapon support. This is why technical 7/30 is only 6/30
  bounded compatibility. Candidate: a distinct adapted stationary attack path,
  tested with the exact original type/team/slot identities in the JSON.
  Source inventory also flags armed types 42 and 45 in blocked missions.
- **Unsupported selectors:**
  [computeBrowserCampaignAi](../src/engine/browser-campaign-ai.ts#L220) emits
  strategy commands only for selector 3; 0/4 intentionally produce none.
  HUMAN12 declares selector 1 on teams 4/6/7, including future reinforcement
  dependencies recorded in the JSON. It remains failed, not a silent AI pass.
  No selector 1/2 with actors was observed in the seven executed openings.
  Candidate: source-informed adapted defensive strategy for 1/2 with independent
  behavior tests; no claim of native defense scheduler parity.
- Dependencies are parsed and fingerprinted by the AI configuration, but that
  does not establish AI recruitment/production execution. The JSON separates
  potential unit dependencies from actually observed actors and player production.

## Severity 3: Latent Visual Dependencies

[missionVisualSprites](../src/mission-view.ts#L149) and
[missionAnimationArchives](../src/mission-view.ts#L111) determine actual lazy
preloading. The audit follows placement, race counterpart, CITY, full TRO
newtype/reinforce groups, production dependencies, FIN children, RGBA sprites,
and indexed planes. The seven loaded missions have no required-source sprite
coverage omissions. Blocked missions have latent alias gaps:

`18 ROBOPOD`, `19 ROBOPOD2`, `21 SCNCPOD2`, `22 RSCHPOD`, `30 BRDRHIV`,
`31 BRDRHIV2`, `33 MNDHIV2`, `34 RSCHIV`, `37 POOP`, `42 XDEPLOY`, `45 HMINE`.

These exact-name FIN files are absent from both generated assets and the source
manifest graph. Classify as unresolved aliases/special presentation, not as
proof that extraction omitted existing source files. Candidate: small verified
alias families, each with a source FIN-child graph fixture, after the owning
runtime type is admitted. Do not invent placeholder sprites.

Type **52 is ONEF**, faction -1, stationary, weapons all -1. Its exact-name FIN
is also absent from the source manifest; the JSON includes a dedicated audit.
It was not a required placement/TRO/CITY type in these 30 missions, so it is not
an observed census blocker. An unarmed static ruin is not a missing-weapon error.

## Source And Opening Evidence

All 30 SCN/TRO/MAP hashes match both original files and the source manifest.
All original TRO scripts reparse exactly to the complete generated blocks.
For loaded missions, SCN and full TRO hashes remain unchanged after simulation.
Original MAP headers match generated dimensions: 96x84, 112x98, 128x112, or
160x140. There are no 256-sized original campaign maps here. Keep the existing
<=255 admission guard; the companion MTG header also uses byte dimensions.

| Mission | Player actors startup / 32 / 200 | Natural request totals |
| --- | --- | --- |
| H01 | 1 / 1 / 6 | create 5 |
| H02 | 4 / 4 / 9 | create 7 |
| H11 | 6 / 6 / 6 | none |
| H14 | 9 / 9 / 9 | combat-death 1 |
| A01 | 1 / 1 / 6 | create 6 |
| A02 | 11 / 11 / 18 | create 8 |
| A14 | 11 / 11 / 11 | none |

All seven admitted missions start with source money zero. No income is injected.
An empty player mobile set while source delivery is pending would not itself
fail this test. Mission 02 loader/view initialization and natural delivery are
covered; the main UI Next handler and later victory/progression are not exercised
by this Node census. AI threshold changes beyond tick 200 remain unexecuted.

## Reproduction

```sh
node --import tsx --test tools/qa/campaign-adapted-census.test.ts
```

The complete run is about 90 seconds on this workspace, with a 64 MiB fetch-cache
cap (about 30 MiB used) and the existing bounded sprite atlas cache. The runner
used a 280-second outer deadline. Focused strict TypeScript checks pass.
Only the new QA test, this document, and its report JSON were written.