import { readFileSync } from "node:fs";
import { CampaignSession, initializeCampaignSession, type CampaignSessionOptions } from "../../../src/engine/campaign-session";
import { createSourceNativeCombatOptions } from "../../../src/engine/source-native-combat-host";
import { createSourceNativeCombatProof } from "../../../src/engine/source-native-combat-options";
import { createSourceNativeTaskOptions, withSourceNativeCombatTasks } from "../../../src/engine/source-native-task-options";
import { createSourceNativeVisibilityHostConfiguration } from "../../../src/engine/source-native-visibility-host";
import { transportHostState } from "../../../src/engine/transport-host";
import { parseScenario } from "../../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../../extractors/data/tables";
import { parseTriggerScript } from "../../extractors/data/triggers";
import { parseMapBundle } from "../../extractors/maps/map";
import type { FinAnimationData } from "../../../src/render/fin-animation";
import type { SourceNativeCombatMission } from "../../../src/engine/source-native-combat-mission";

export async function createNativeCombatAlienFixture() {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url));
  const raw = (path: string) => read(`raw_cd/DC/${path}`);
  const scenario = (extension: string) => raw(`SCENARIO/ALIEN/ALIEN02.${extension}`);
  const animationRegistry = raw("ANIM.DAT");
  const assets = { executable: raw("DC.EXE"), gameStat: raw("GAMESTAT/GAMESTAT.TXT"), weaponStat: raw("GAMESTAT/WEAPSTAT.TXT"),
    boomStat: raw("GAMESTAT/BOOMSTAT.TXT"), damageMatrix: raw("GAMESTAT/MBULLET.TXT"), scenario: scenario("SCN"),
    troopFin: raw("ANIMATE/GRAY.FIN"), troopSprite: raw("SPRITES/GRAY.SPR"), animationRegistry,
    registryFins: Object.fromEntries(animationRegistry.toString().trim().split(/\s+/).map(name =>
      [name.toUpperCase(), raw(`ANIMATE/${name.toUpperCase()}`)])),
    map: scenario("MAP"), mtg: scenario("MTG"), pth: scenario("PTH"), bts: raw("SCENARIO/DESERT.BTS"),
    animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "BARR"].map(stem =>
      [stem, read(`public/assets/generated/animations/${stem}.json`)])) };
  const map = parseMapBundle(assets.map, assets.mtg, assets.pth);
  const source = parseScenario(assets.scenario.toString());
  const options: CampaignSessionOptions = { sessionId: "bounded-alien-combat", source,
    units: parseUnitStats(assets.gameStat.toString()), weapons: parseWeaponStats(assets.weaponStat.toString()),
    triggers: [], messages: [], map, pathGrid: map.pathGrid, tags: map.tagGrid,
    commanders: [{ team: 0, unitType: 73, sprite: "GRAY" }], directionBits: [], fixedStepMilliseconds: 16,
    orientationSteps: 1, resourceScales: "configured-startup" };
  const fresh = initializeCampaignSession(options);
  if (!fresh.ok) throw new Error(JSON.stringify(fresh.diagnostics));
  const configuration = await createSourceNativeTaskOptions({ assets, world: fresh.value.world });
  const host = transportHostState(fresh.value.world), profile = configuration.profiles.find(profile => profile.typeId === 8)!;
  const cell = host.ground.findIndex((slot, index) => {
    const column = index % host.width, row = Math.floor(index / host.width);
    if (slot !== -1 || column < 12 || column > host.width - 12 || row < 12 || row > host.height - 12) return false;
    for (let offsetY = -8; offsetY <= 8; offsetY++) for (let offsetX = -8; offsetX <= 8; offsetX++) {
      const nearby = index + offsetY * host.width + offsetX;
      if ((profile.ground[nearby] & 1023) !== 1023 || (profile.air[nearby] & 1023) !== 1023) return false;
    }
    return [-2, -1, 0, 1, 2, 3].every(offset => host.groundEligible[index + offset] && profile.families[index] !== 0 &&
      profile.families[index + offset] === profile.families[index] && profile.air[index + offset] >>> 10 === 0);
  });
  if (cell < 0) throw new Error("No actual ALIEN02 same-family source PTH corridor");
  const column = cell % host.width, row = Math.floor(cell / host.width);
  const boundedOptions = { ...options, triggers: parseTriggerScript(`1 norm 1 (c>0)
reinforce2 0 ${column} ${row} 8 1 0 0 0 0 0 0 0 0
reinforce2 1 ${column - 2} ${row} 8 1 0 0 0 0 0 0 0 0
end
`) };
  const recreateProviders = async () => {
    const initial = initializeCampaignSession(boundedOptions);
    if (!initial.ok) throw new Error(JSON.stringify(initial.diagnostics));
    const configuration = await createSourceNativeTaskOptions({ assets, world: initial.value.world });
    const proof = await createSourceNativeCombatProof(assets);
    const tasks = await withSourceNativeCombatTasks(configuration, proof);
    const visibility = await createSourceNativeVisibilityHostConfiguration({ assets, tasks, world: initial.value.world,
      localTeam: 0, localMask: 0x40000000, daylight: 0, crtSeed: 1 });
    return createSourceNativeCombatOptions({ configuration, proof, visibility });
  };
  const providers = await recreateProviders();
  const animation = JSON.parse(assets.animations.GRAY.toString()) as FinAnimationData;
  const json = <Value>(path: string): Value => JSON.parse(read(`public/assets/generated/${path}`).toString());
  const tileRecords = read("public/assets/generated/maps/ALIEN/ALIEN02.tile-records.u16");
  const mission: SourceNativeCombatMission = {
    faction: "alien", scenario: { ...json<SourceNativeCombatMission["scenario"]>("data/scenarios/ALIEN/ALIEN02.json"), ...source },
    triggers: boundedOptions.triggers, messages: [], units: options.units, weapons: options.weapons,
    briefing: json("data/briefings/ALIEN/ALIEN01.json"), map: json("maps/ALIEN/ALIEN02.json"),
    tileReferences: map.tileReferences, attributes: map.attributes, pathGrid: map.pathGrid, tags: map.tagGrid,
    tileRecordIndices: Uint16Array.from({ length: tileRecords.length / 2 }, (_, index) => tileRecords.readUInt16LE(index * 2)),
    terrain: json("terrain/DESERT.json"), terrainAtlasUrl: "/assets/generated/terrain/DESERT.png",
    sourceNativeCombat: { scope: "source-separated-type8-weapon15-nonlethal", options: { ...boundedOptions, ...providers } },
  };
  return { options: mission.sourceNativeCombat!.options, mission, initial: fresh.value.world, column, row, recreateProviders, animation };
}

export function alienVisibilityFrame(session: CampaignSession, sequence: number, selected?: readonly number[]) {
  const bytes = session.snapshot.world.entityBytes!;
  const eligible = Array.from({ length: 800 }, (_, slot) => slot).filter(slot => bytes[slot * 220 + 0x2c]
    && bytes[slot * 220 + 7] < 8 && ![1, 2].includes(bytes[slot * 220 + 0xcb]));
  const producerSlots = selected ?? eligible;
  return { sequence, counter: 0, producerSlots, excludedProducerSlots: eligible.filter(slot => !producerSlots.includes(slot)) };
}