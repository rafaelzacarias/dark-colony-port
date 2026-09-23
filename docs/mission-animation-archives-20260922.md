# Original Mission FIN Archive Handoff

## Integration

[additionalMissionAnimationArchives](../src/engine/mission-animation-archives.ts)
returns a complete, ordered replacement archive list, or `undefined` for an
unchanged name. It does not return a list to append. The MissionView owner can
import it and put this at the start of `missionAnimationArchives(sprite)`:

```ts
const additional = additionalMissionAnimationArchives(sprite);
if (additional) return additional;
```

This change deliberately does not edit MissionView, generated assets, raw source
files, or existing shared tests. Integration must precede the old early returns
so existing building aliases acquire their missing Build and damage banks.
Existing exact-list expectations for BIOHIV/WARHIVE need to reflect the complete
lists after integration. Unknown names retain the existing fallback. POOP is
deliberately undefined: keep type-37 hidden admission/preload filtering with its
current owner; this helper neither loads nor invents a POOP archive.

## Source Evidence

The original GAMESTAT prefixes are looked up in the original ANIM.DAT manifest,
not converted to same-name FIN filenames. The native lookup mechanism and loader
addresses are documented in
[asset-runtime-dependencies-20260919.md](asset-runtime-dependencies-20260919.md).
The new tests reconstruct the manifest-ordered registry from parsed raw FINs;
they do not claim a new executable replay.

| Types / Prefix | Ordered Archives | Source State Examples |
| --- | --- | --- |
| 16 EXCOPOD | HUBU, BURN, PART4 | EXCOPODSTAND0, EXCOPODDIE0, EXCOPODBUILD0 |
| 17 BRRKPOD | HUBU, BURN2, BURN, PART4 | BRRKPODSTAND0, BRRKPODDIE0, BRRKPODBUILD0 |
| 18 ROBOPOD | HUBU, BURN2, BURN, ROBO | ROBOPODSTAND0, ROBOPODDIE0, ROBOPODBUILD0 |
| 19 ROBOPOD2 | HUBU, BURN2, BURN, DROP4 | ROBOPOD2STAND0, ROBOPOD2DIE0, ROBOPOD2BUILD0 |
| 20 SCNCPOD | HUBU, DROP, BURN, PART3 | SCNCPODSTAND0, SCNCPODDIE0, SCNCPODBUILD0 |
| 21 SCNCPOD2 | HUBU, BURN, DROP3 | SCNCPOD2STAND0, SCNCPOD2DIE0, SCNCPOD2BUILD0 |
| 22 RSCHPOD | HUBU, BURN2, BURN, PART2 | RSCHPODSTAND0, RSCHPODDIE0, RSCHPODBUILD0 |
| 28 BIOHIV | ALBU, BLEED, SAUC | BIOHIVSTAND0, BIOHIVDIE0, BIOHIVBUILD0 |
| 29 WARHIVE | ALBU, BLEED, SAUC | WARHIVESTAND0, WARHIVETALKING, WARHIVEBUILD0 |
| 30 BRDRHIV | ALBU, BLEED, SAUC2 | BRDRHIVSTAND0, BRDRHIVDIE0, BRDRHIVBUILD0 |
| 31 BRDRHIV2 | ALBU, BLOO, BLEED, SAUC2 | BRDRHIV2STAND0, BRDRHIV2DIE0, BRDRHIV2BUILD0 |
| 32 MINDHIV | ALBU, SAUC2, BLEED2, BLEED | MINDHIVSTAND0, MINDHIVDIE0, MINDHIVBUILD0 |
| 33 MNDHIV2 | ALBU, BLOO, BLEED2, SAUC2 | MNDHIV2STAND0, MNDHIV2DIE0, MNDHIV2BUILD0 |
| 34/35 RSCHIV | BLEED2, BLEED, SAUC4 | RSCHIVSTAND0, RSCHIVDIE0, RSCHIVBUILD0 |
| 41 T | TURR | TSTAND0, TSTAND12, TDIE14 |
| 42 XDEPLOY | XENO | XDEPLOYSTAND0, XDEPLOYFIRE0, XDEPLOYDIE0 |
| 45/46 HMINE | ENGI | HMINESTAND0 |
| 51-62 ONEF/TWOF | LIGHT1F / LIGHT2F | ONEFSTAND0 / TWOFSTAND0 |
| 77/78 SARGSTL/PSYCSTL | SARG / PSYC | Directional STAND and DIE states |
| 90 FILL | FUEL | FILLSTAND0, FILLDIE0 |

Both raw GAMESTAT mine rows 45 and 46 literally use HMINE. The loaded source
state is in ENGI, not EXPL, SLOM, or an invented MINED archive. CampaignWorld's
race-counterpart conversion is included in the scenario test. A different
family for type 46 would need additional native evidence; this helper does not
silently substitute alien art.

RSCHIV's living state is in BLEED2, not ALBU. Its Build state comes from SAUC4:
the similarly named SAUC3 is not loaded by ANIM.DAT. MINDHIVBUILD0 remains in
SAUC2. FILL.FIN exists in the extraction but is not manifest-loaded; FUEL owns
the runtime FILL states. Other same-name unit archives gain their source Build,
damage, bullet, or other prefix banks where those live in separate loaded FINs.

Existing body-first ordering (notably HUBU/BURN2, HUBU/DROP, ALBU/SAUC2 and
SAWS/SAUC) is retained. Tests compare first-match timelines against ANIM.DAT
order and reject conflicting duplicate names across every selected list.
No state is renamed, synthesized, or copied between source families.

## Direction And Action Exceptions

EDPLY and SDPL have Stand directions 14/2; SARGSTL has 14/10/6/2;
PSYCSTL, BEAC and BEEK have 2/14. No STAND0 is manufactured for these prefixes.
All other non-hidden prefixes through type 98 have an exact native STAND0.

Absent FIRE is not an archive failure. In particular, T and HMINE have no
native FIRE state despite their weapon metadata. The existing selector's
Attack-to-Stand fallback is retained and compared with the complete native
registry in all eight displayed directions. Die does not gain a synthetic
fallback. Build, TALKING and other non-action states are retained in the merged
archive even though the generic selector exposes only Stand/Move/Attack/Die.

## Verification

[additional-mission-animation-archives.test.ts](../tools/qa/additional-mission-animation-archives.test.ts):

- 78 tests passed, zero skipped; isolated strict TypeScript check passed.
- All 164 parsed generated FIN descriptors match raw FIN states, timelines and
  source hashes. Unloaded or unsupported files are not promoted into runtime.
- Types 0-98 excluding hidden type 37: 73 distinct visual prefixes, complete
  original prefix-state coverage and exact source Stand-direction exceptions.
- 72 selected FIN archives and 112 SPR families: raw source hashes, declared
  sprites, timeline child frames, PNG bounds and indexed-plane hashes verified.
- All eight directions for Stand, Move, Attack and Die match source-registry
  names, fallback flags and timeline contents after merged-index relocation.
- All 108 original SCNs and MAPs parsed; all 108 CampaignWorlds initialized,
  including all 30 campaign worlds. Fifty visible placement types resolve a
  living state, including source types, race counterparts, RENAT entries and
  captured coordinate-queue types. Types 45 and 46 are both covered.

Final checks: `/tmp/dc-fin-alias-final-20260922-r02.log` and its exit record
(`codes: [0, 0]`). This is source/dependency/selector validation, not a new
MissionView render or browser playthrough. The other owner's integration and
updated adapted-mission render census remain pending.