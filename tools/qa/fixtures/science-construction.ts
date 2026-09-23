import { MissionView } from "../../../src/mission-view";
import type { SourceConstructionMission } from "../../../src/engine/source-construction-options";
import type { NativeConstructionConfiguration } from "../../../src/engine/native-construction-host";
import { transportHostState } from "../../../src/engine/transport-host";

export const scienceConstructionFixtureLabel = "QA-only source-bound science: seeded human/alien, team 1, 6000 credits, six witness actors; not original mission admission";
export const scienceConstructionObserverFixtureLabel = `${scienceConstructionFixtureLabel}; optional local team 0 observer`;
export const scienceNativeSourceSha256 = "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b";
export type ScienceFixtureLoadBytes = (url: URL) => Promise<Uint8Array> | Uint8Array;
export interface ScienceNativeCase {
  race: 0 | 1;
  profiles: {
    bindings: { unitType: number; constructionState: ScienceNativeState | null; standState: ScienceNativeState }[];
    sources: { source: string; sha256: string }[];
  };
  types: number[];
  beforeTeam: number[];
  aiBefore: { entities: number[]; policy: number[] };
  dependencies: number[];
  cityDependencies: number[];
}
interface ScienceNativeState { name: string; source: string; first: number; last: number; delays: number[] }
export interface ScienceNativeInput { sha256: string; cases: ScienceNativeCase[] }

const fetchBytes: ScienceFixtureLoadBytes = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Science fixture fetch failed: ${response.status} ${url}`);
  return new Uint8Array(await response.arrayBuffer());
};

export async function loadScienceNativeInput(loadBytes: ScienceFixtureLoadBytes = fetchBytes): Promise<ScienceNativeInput> {
  const envelope = JSON.parse(new TextDecoder().decode(await loadBytes(new URL("./science-native-inputs.json", import.meta.url))));
  if (envelope.schema !== "science-native-inputs-v1" || envelope.encoding !== "deflate-base64"
    || envelope.label !== scienceConstructionFixtureLabel || envelope.sourceSha256 !== scienceNativeSourceSha256) {
    throw new Error("Invalid science native fixture metadata");
  }
  const compressed = Uint8Array.from(atob(envelope.payload), character => character.charCodeAt(0));
  const payload = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", payload)), byte => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== envelope.inputSha256) throw new Error("Science native fixture input hash mismatch");
  const nativeInput: ScienceNativeInput = JSON.parse(new TextDecoder().decode(payload));
  if (nativeInput.sha256 !== scienceNativeSourceSha256 || nativeInput.cases.length !== 2
    || nativeInput.cases[0].race !== 0 || nativeInput.cases[1].race !== 1) throw new Error("Invalid science native fixture cases");
  return nativeInput;
}

export async function createScienceConstructionFixture(race: 0 | 1, nativeInput: ScienceNativeInput,
  loadBytes: ScienceFixtureLoadBytes = fetchBytes, options: { observer?: boolean } = {}): Promise<SourceConstructionMission> {
  const golden = nativeInput.cases.find(candidate => candidate.race === race);
  if (!golden || nativeInput.sha256 !== scienceNativeSourceSha256) throw new Error("Missing science native input/source hash");
  const generatedPath = "../../../public/assets/generated/";
  const root = typeof window === "undefined"
    ? new URL(generatedPath, import.meta.url) : new URL("/assets/generated/", window.location.href);
  const json = async (path: string) => JSON.parse(new TextDecoder().decode(await loadBytes(new URL(path, root))));
  const [unitData, dependencyData, original, weaponData, damageData, briefing, map, terrain] = await Promise.all([
    "data/units.json", "data/dependencies.json", "data/scenarios/HUMAN/HUMAN02.json", "data/weapons.json",
    "data/damage-matrix.json", "data/briefings/HUMAN/HUMAN01.json", "maps/HUMAN/HUMAN02.json", "terrain/DESERT.json",
  ].map(json));
  const units = unitData.records, records = dependencyData.records;
  const types = new DataView(Uint8Array.from(golden.types).buffer);
  const teamBytes = [...golden.beforeTeam];
  const bytes = new DataView(Uint8Array.from(teamBytes).buffer);
  const profile = (unitType: number, build = false) => {
    const binding = golden.profiles.bindings.find(item => item.unitType === unitType)!;
    const state = (build ? binding.constructionState : binding.standState)!;
    return { id: state.name, source: state.source,
      sha256: golden.profiles.sources.find(item => item.source === state.source)!.sha256,
      first: state.first, last: state.last, directions: Array.from({ length: 32 }, () => [...state.delays]) };
  };
  const config: NativeConstructionConfiguration = {
    sourceSha256: nativeInput.sha256, team: 1, race, base: { x: 32, y: 32 }, map: { width: 128, height: 128 },
    fixedSlots: Array.from({ length: 15 }, (_, slot) => slot < 2 ? { nativeId: 15 + slot,
      unitType: 16 + race * 12 + slot, health: bytes.getInt32(0x3c + slot * 4, true) }
      : slot === 5 ? { nativeId: 20, unitType: 81, health: 1 } : null),
    footprint: [[33, 32], [34, 32], [33, 33], [34, 33]].map(([x, y]) => ({ x, y, occupant: 1023 })),
    profiles: { stand: profile(20 + race * 12), build: profile(20 + race * 12, true), auxiliary: profile(92 + race) },
  };
  const troop = golden.profiles.bindings.find(binding => binding.unitType === race * 8)!.constructionState!;
  const data: SourceConstructionMission = {
    faction: "human", scenario: { ...original, id: `source-bound-science-fixture-${race}`,
      placementRows: [...Array.from({ length: 6 }, (_, index) => [40 + index, 40, race * 8, 1, units[race * 8].health]),
        ...(options.observer ? [[34, 37, 0, 0, units[0].health]] : [])],
      teams: original.teams.map((team: any) => ({ ...team, race: team.index === 1 ? race : 0, money: 6000, allies: Array(8).fill(1),
        coordinateRows: [[0, 0], team.index === 1 ? [32, 32] : [0, 0]],
        cityRows: [[1, config.fixedSlots[0]!.health, 1, config.fixedSlots[1]!.health, 0, 0, 0, 0, 0, 0],
          ...team.cityRows.slice(1)] })) },
    units, weapons: weaponData.records, damageMatrix: damageData.coefficients,
    triggers: [], messages: [], briefing,
    map: { ...map, width: 128, height: 128 },
    pathGrid: new Uint8Array(16384).fill(1), tags: new Uint8Array(16384), attributes: new Uint16Array(16384),
    tileReferences: new Uint16Array(32768), tileRecordIndices: new Uint16Array(32768),
    terrain, terrainAtlasUrl: "/assets/generated/terrain/DESERT.png",
    sourceProduction: { configuration: { profile: "user-selected-source-campaign-fresh", mode: 0, localTeam: 0, race: 0 },
      initialPopulationCeiling: 150, production: { records, constructionSources: [config],
        units: records.filter((record: any) => record.rawFields[0] === 1).map((record: any) => ({ unitType: record.rawFields[1],
          queue: types.getInt32(record.rawFields[1] * 280 + 0xec, true),
          exitSelector: types.getInt32(record.rawFields[1] * 280 + 0xf0, true), exitOffset: { x: 0, y: -3 } })),
        sourceProfiles: [{ unitType: race * 8 as 0 | 8, bankField: 152, id: troop.name,
          finSha256: golden.profiles.sources.find(entry => entry.source === troop.source)!.sha256,
          directions: Array.from({ length: 32 }, () => [...troop.delays]) }],
        teams: [{ team: 1, race, credits: 6000, costAccumulator: 17, base: config.base, producerDelays: [0, 0, 0, 0],
          slots: Array.from({ length: 5 }, (_, slot) => ({ health: bytes.getInt32(0x3c + slot * 4, true), level: 0, busy: 0 })),
          restrictions: Array.from({ length: 110 }, (_, index) => index).filter(index => teamBytes[0xda4 + index]), upgrades: [] }] } },
  };
  const canvas = { width: 512, height: 452, getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as unknown as HTMLCanvasElement;
  const view = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, data);
  if (view.missionDiagnostic) throw new Error(String(view.missionDiagnostic));
  const world = view.campaignSnapshot!.world;
  const entities = [...golden.aiBefore.entities];
  if (options.observer) {
    const observer = world.entities.find(entity => entity.sourceRow === 6 && entity.team === 0 && entity.unitType === 0);
    if (observer?.rawSlot == null || !world.entityBytes) throw new Error("Missing science fixture observer constructor slot");
    const offset = observer.rawSlot * 220;
    entities.splice(offset, 220, ...world.entityBytes.slice(offset, offset + 220));
  }
  return { ...data, sourceConstruction: { scope: "source-separated-bounded", campaignAi: {
    scope: "source-separated-bounded", sourceId: `${data.scenario.id}:science`, sourceSha256: nativeInput.sha256, team: 1,
    sources: { types: golden.types, weapons: Array(80 * 72).fill(0), dependencies: golden.dependencies,
      cityDependencies: golden.cityDependencies, matrix: data.damageMatrix!, navigation: { width: 128, height: 128,
        families: [...data.pathGrid], nextFamily: Array(65536).fill(0) } },
    initial: { entities, policy: golden.aiBefore.policy, teamBytes,
      forceOrder: 0, population: 6, populationLimit: 10, relations: Array(100).fill(0), visibilityMasks: Array(8).fill(0),
      occupancy: transportHostState(world).ground.map(slot => slot < 0 ? 1023 : slot) },
  } } };
}