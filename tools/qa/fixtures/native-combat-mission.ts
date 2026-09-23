import { readFileSync } from "node:fs";
import { CampaignSession, initializeCampaignSession, type CampaignSessionOptions } from "../../../src/engine/campaign-session";
import { createSourceNativeCombatOptions } from "../../../src/engine/source-native-combat-host";
import { createSourceNativeCombatProof, createSourceNativeCombatSoundProof } from "../../../src/engine/source-native-combat-options";
import { createSourceNativeTaskOptions, withSourceNativeCombatTasks } from "../../../src/engine/source-native-task-options";
import { createSourceNativeVisibilityHostConfiguration } from "../../../src/engine/source-native-visibility-host";
import type { SourceNativeCombatFrame, SourceNativeCombatMission } from "../../../src/engine/source-native-combat-mission";
import { transportHostState } from "../../../src/engine/transport-host";
import { parseScenario } from "../../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../../extractors/data/tables";
import { parseTriggerScript } from "../../extractors/data/triggers";
import { parseMapBundle } from "../../extractors/maps/map";

export const nativeCombatMissionLabel = "QA-only source-separated combat caller; complete original HUMAN02 SCN, not original TRO admission";

export async function createNativeCombatMissionFixture(death = false,
  visibilityOptions?: { readonly localTeam: number; readonly localMask: number; readonly daylight: number; readonly crtSeed: number },
  withSound = false) {
  if (withSound && !death) throw new TypeError("Sound fixture requires the bounded lethal owner");
  const visibilityCaller = visibilityOptions && Object.freeze({ ...visibilityOptions });
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url));
  const raw = (path: string) => read(`raw_cd/DC/${path}`);
  const json = <Value>(path: string): Value => JSON.parse(read(`public/assets/generated/${path}`).toString());
  const animationRegistry = raw("ANIM.DAT");
  const assets = { executable: raw("DC.EXE"), gameStat: raw("GAMESTAT/GAMESTAT.TXT"), weaponStat: raw("GAMESTAT/WEAPSTAT.TXT"),
    boomStat: raw("GAMESTAT/BOOMSTAT.TXT"), damageMatrix: raw("GAMESTAT/MBULLET.TXT"), scenario: raw("SCENARIO/HUMAN/HUMAN02.SCN"),
    troopFin: raw("ANIMATE/TRSC.FIN"), troopSprite: raw("SPRITES/TRSC.SPR"), animationRegistry,
    registryFins: Object.fromEntries(animationRegistry.toString().trim().split(/\s+/).map(name => [name.toUpperCase(), raw(`ANIMATE/${name.toUpperCase()}`)])),
    map: raw("SCENARIO/HUMAN/HUMAN02.MAP"), mtg: raw("SCENARIO/HUMAN/HUMAN02.MTG"), pth: raw("SCENARIO/HUMAN/HUMAN02.PTH"),
    animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "BARR"].map(stem => [stem, read(`public/assets/generated/animations/${stem}.json`)])) };
  const map = parseMapBundle(assets.map, assets.mtg, assets.pth);
  const source = parseScenario(assets.scenario.toString());
  const scenario = { ...json<SourceNativeCombatMission["scenario"]>("data/scenarios/HUMAN/HUMAN02.json"), ...source };
  const options: CampaignSessionOptions = { sessionId: "source-separated-combat-view", source,
    units: parseUnitStats(assets.gameStat.toString()), weapons: parseWeaponStats(assets.weaponStat.toString()), triggers: [], messages: [],
    map: { width: map.width, height: map.height }, pathGrid: map.pathGrid, tags: map.tagGrid,
    commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }], directionBits: [], fixedStepMilliseconds: 16, orientationSteps: 1,
    resourceScales: "configured-startup" };
  const fresh = initializeCampaignSession(options);
  if (!fresh.ok) throw new Error(JSON.stringify(fresh.diagnostics));
  const configuration = await createSourceNativeTaskOptions({ assets, world: fresh.value.world });
  const host = transportHostState(fresh.value.world), profile = configuration.profiles[0];
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
  if (cell < 0) throw new Error("No real clear source PTH corridor");
  const column = cell % host.width, row = Math.floor(cell / host.width);
  const triggers = parseTriggerScript(`1 norm 1 (c>0)
reinforce2 0 ${column} ${row} 0 1 0 0 0 0 0 0 0 0
reinforce2 5 ${column - 2} ${row} 0 1 0 0 0 0 0 0 0 0
end
${death ? `3 norm 1 (c>48)
reinforce2 5 ${column - 2} ${row} 0 1 0 0 0 0 0 0 0 0
end` : `2 norm 1 (c>5)
reinforce2 0 ${column + 3} ${row} 92 1 0 0 0 0 0 0 0 0
end`}
`);
  const boundedOptions = { ...options, triggers };
  const visibilityAssets = visibilityCaller ? { ...assets, bts: raw("SCENARIO/DESERT.BTS") } : undefined;
  const soundFrame = withSound ? { initialized: true as const, disabled: false,
    listener: { x: column * 256 + 128, y: row * 256 + 128 } } : undefined;
  const recreateProviders = async () => {
    const initial = initializeCampaignSession(boundedOptions);
    if (!initial.ok) throw new Error(JSON.stringify(initial.diagnostics));
    const configuration = await createSourceNativeTaskOptions({ assets, world: initial.value.world });
    const proof = await createSourceNativeCombatProof(assets);
    const visibility = visibilityCaller && await createSourceNativeVisibilityHostConfiguration({
      ...visibilityCaller, assets: visibilityAssets!, tasks: await withSourceNativeCombatTasks(configuration, proof), world: initial.value.world });
    const sound = soundFrame && await createSourceNativeCombatSoundProof({ executable: assets.executable,
      soundTable: raw("SOUND/SOUND2.DAT"), bindings: raw("SOUND/SLIST.DAT") }, {
      policy: "explicit-caller-boundary", state: { descriptor: [4, 0, 0, 28, 90, 153, 154, 0, 0, 0, 0, 0, 0],
        randomSeed: visibilityCaller?.crtSeed ?? 1 }, ...soundFrame });
    return createSourceNativeCombatOptions({ configuration, proof, death, ...(visibility ? { visibility } : {}), ...(sound ? { sound } : {}) });
  };
  const providers = await recreateProviders();
  const tileRecords = read("public/assets/generated/maps/HUMAN/HUMAN02.tile-records.u16");
  const mission: SourceNativeCombatMission = {
    faction: "human", scenario, triggers, messages: [], units: options.units, weapons: options.weapons,
    briefing: json("data/briefings/HUMAN/HUMAN01.json"), map: json("maps/HUMAN/HUMAN02.json"),
    tileReferences: map.tileReferences, attributes: map.attributes, pathGrid: map.pathGrid, tags: map.tagGrid,
    tileRecordIndices: Uint16Array.from({ length: tileRecords.length / 2 }, (_, index) => tileRecords.readUInt16LE(index * 2)),
    terrain: json("terrain/DESERT.json"), terrainAtlasUrl: "/assets/generated/terrain/DESERT.png",
    sourceNativeCombat: { scope: death ? "source-separated-type0-weapon1-bounded-lethal" : "source-separated-type0-weapon1-nonlethal",
      options: { ...boundedOptions, ...providers } },
  };
  return { mission, column, row, recreateProviders, initial: fresh.value.world, soundFrame };
}

export function nativeCombatPacket(slot: number, column: number, row: number, order: 2 | 7 = 2): number[] {
  const bytes = new Uint8Array(17), words = new DataView(bytes.buffer);
  words.setUint16(0, 17, true);
  bytes[2] = 5; words.setInt16(3, slot, true); bytes[5] = order;
  bytes[6] = 7; bytes[7] = 1; words.setInt16(8, 1, true);
  words.setUint16(10, column * 256 + 128, true); words.setUint16(12, row * 256 + 128, true);
  words.setInt16(14, slot, true);
  return [...bytes];
}

export function nativeCombatInput(state: CampaignSession["snapshot"], packets?: number[][], registeredSlots?: number[]): SourceNativeCombatFrame {
  const counter = state.cycleCounter + 1, host = transportHostState(state.world);
  return { clockMilliseconds: counter * 16, nativeAiFrame: { counter, task6Budget: 0,
    ...(registeredSlots ? { registeredSlots } : {}) },
    ...(packets ? { nativeAiReceipt: { id: `combat-view:${counter}`, packets,
      expected: host.slots.flatMap(actor => actor?.nativeAiTask ? [{ slot: actor.slot, generation: actor.generation,
        key: actor.key, raw: actor.nativeAiTask.raw }] : []) } } : {}) };
}